const COOKIE_NAME = 'hkaccount_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
const LOGIN_WINDOW_SECONDS = 60 * 10;
const MAX_LOGIN_FAILURES = 5;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function secureAsset(response, noStore = false) {
  const secured = new Response(response.body, response);
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('x-frame-options', 'DENY');
  secured.headers.set('referrer-policy', 'no-referrer');
  secured.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  secured.headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  if (noStore) secured.headers.set('cache-control', 'no-store');
  return secured;
}

async function refreshSession(response, env) {
  if (env.LOCAL_DEV === 'true') return response;
  const refreshed = new Response(response.body, response);
  refreshed.headers.set('set-cookie', sessionCookie(await createSessionToken(env.SESSION_SECRET)));
  refreshed.headers.set('cache-control', 'no-store');
  return refreshed;
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function timingSafeStringEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(provided))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected)))
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function signValue(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function createSessionToken(secret) {
  const encoder = new TextEncoder();
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        version: 1,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        nonce: crypto.randomUUID()
      })
    )
  );
  const signature = bytesToBase64Url(await signValue(payload, secret));
  return `${payload}.${signature}`;
}

async function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  try {
    const expectedSignature = await signValue(parts[0], secret);
    const providedSignature = base64UrlToBytes(parts[1]);
    const signaturesMatch =
      expectedSignature.byteLength === providedSignature.byteLength &&
      crypto.subtle.timingSafeEqual(expectedSignature, providedSignature);
    if (!signaturesMatch) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    return (
      payload.version === 1 &&
      Number.isSafeInteger(payload.expiresAt) &&
      payload.expiresAt > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

async function isAuthenticated(request, env) {
  if (env.LOCAL_DEV === 'true') return true;
  return verifySessionToken(getCookie(request, COOKIE_NAME), env.SESSION_SECRET);
}

async function hashClientAddress(request) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function readLoginAttempt(env, addressHash) {
  return env.DB.prepare(
    'SELECT failures, window_started_at, blocked_until FROM auth_attempts WHERE address_hash = ?'
  ).bind(addressHash).first();
}

async function registerLoginFailure(env, addressHash, existing) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isCurrentWindow =
    existing && Number(existing.window_started_at) + LOGIN_WINDOW_SECONDS > nowSeconds;
  const failures = isCurrentWindow ? Number(existing.failures) + 1 : 1;
  const windowStartedAt = isCurrentWindow ? Number(existing.window_started_at) : nowSeconds;
  const blockedUntil = failures >= MAX_LOGIN_FAILURES ? nowSeconds + LOGIN_WINDOW_SECONDS : null;

  await env.DB.prepare(
    `INSERT INTO auth_attempts (address_hash, failures, window_started_at, blocked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(address_hash) DO UPDATE SET
       failures = excluded.failures,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until`
  ).bind(addressHash, failures, windowStartedAt, blockedUntil).run();

  return { failures, blockedUntil };
}

async function handleAuthApi(request, env, url) {
  if (url.pathname === '/api/auth/status' && request.method === 'GET') {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    return json(
      { ok: true },
      200,
      { 'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }
    );
  }

  if (url.pathname !== '/api/auth/login' || request.method !== 'POST') {
    return json({ error: 'Not found' }, 404);
  }

  if (!env.APP_PIN || !env.SESSION_SECRET) {
    console.error(JSON.stringify({ event: 'auth_secrets_missing' }));
    return json({ error: '로그인 설정이 완료되지 않았습니다.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1024) return json({ error: '요청이 너무 큽니다.' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '올바른 요청이 아닙니다.' }, 400);
  }

  const addressHash = await hashClientAddress(request);
  const existing = await readLoginAttempt(env, addressHash);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (existing?.blocked_until && Number(existing.blocked_until) > nowSeconds) {
    return json(
      {
        error: '입력 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        retryAfter: Number(existing.blocked_until) - nowSeconds
      },
      429,
      { 'retry-after': String(Number(existing.blocked_until) - nowSeconds) }
    );
  }

  const valid = await timingSafeStringEqual(body.pin || '', env.APP_PIN);
  if (!valid) {
    const failure = await registerLoginFailure(env, addressHash, existing);
    const remaining = Math.max(0, MAX_LOGIN_FAILURES - failure.failures);
    return json(
      {
        error: failure.blockedUntil
          ? '입력 횟수가 너무 많습니다. 10분 후 다시 시도해 주세요.'
          : '번호가 맞지 않습니다.',
        remaining
      },
      failure.blockedUntil ? 429 : 401
    );
  }

  await env.DB.prepare('DELETE FROM auth_attempts WHERE address_hash = ?').bind(addressHash).run();
  const token = await createSessionToken(env.SESSION_SECRET);
  return json(
    { ok: true },
    200,
    {
      'set-cookie': sessionCookie(token)
    }
  );
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validateHouseholdData(data) {
  if (!data || typeof data !== 'object') return 'data 객체가 필요합니다.';

  for (const key of ['users', 'paymentMethods', 'assets', 'categories', 'transactions']) {
    if (!Array.isArray(data[key])) return `${key} 배열이 필요합니다.`;
  }

  if (data.transactions.length > 850) {
    return '현재 동기화 한도는 거래 850건입니다. 전체 내보내기로 백업한 뒤 관리자에게 문의해 주세요.';
  }

  const ids = new Set();
  for (const transaction of data.transactions) {
    if (!transaction || typeof transaction !== 'object' || !String(transaction.id || '').trim()) {
      return '모든 거래에는 id가 필요합니다.';
    }
    const id = String(transaction.id);
    if (ids.has(id)) return `중복 거래 id가 있습니다: ${id}`;
    ids.add(id);
  }

  return null;
}

async function readHousehold(env) {
  const [stateRow, transactionResult] = await Promise.all([
    env.DB.prepare(
      'SELECT revision, initialized, settings_json, updated_at, updated_by FROM household_state WHERE id = 1'
    ).first(),
    env.DB.prepare(
      'SELECT data_json FROM transactions WHERE deleted_at IS NULL ORDER BY transaction_date ASC, id ASC'
    ).all()
  ]);

  if (!stateRow) throw new Error('household_state is not initialized');

  const settings = safeJsonParse(stateRow.settings_json, {});
  const transactions = transactionResult.results
    .map((row) => safeJsonParse(row.data_json, null))
    .filter(Boolean);

  return {
    initialized: stateRow.initialized === 1,
    revision: stateRow.revision,
    updatedAt: stateRow.updated_at,
    updatedBy: stateRow.updated_by,
    data: {
      users: Array.isArray(settings.users) ? settings.users : [],
      paymentMethods: Array.isArray(settings.paymentMethods) ? settings.paymentMethods : [],
      assets: Array.isArray(settings.assets) ? settings.assets : [],
      categories: Array.isArray(settings.categories) ? settings.categories : [],
      transactions,
      monthlyBudget: Number(settings.monthlyBudget || 0),
      categoryBudgets:
        settings.categoryBudgets && typeof settings.categoryBudgets === 'object'
          ? settings.categoryBudgets
          : {},
      lastSavedAt: settings.lastSavedAt || stateRow.updated_at
    }
  };
}

async function saveHousehold(request, env) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 2_000_000) return json({ error: '요청 데이터가 너무 큽니다.' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '올바른 JSON 요청이 아닙니다.' }, 400);
  }

  const baseRevision = Number(body.baseRevision);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    return json({ error: '올바른 baseRevision이 필요합니다.' }, 400);
  }

  const validationError = validateHouseholdData(body.data);
  if (validationError) return json({ error: validationError }, 400);

  const current = await env.DB.prepare(
    'SELECT revision FROM household_state WHERE id = 1'
  ).first('revision');

  if (current !== baseRevision) {
    return json(
      {
        error: '다른 기기에서 먼저 저장했습니다.',
        conflict: true,
        server: await readHousehold(env)
      },
      409
    );
  }

  const now = new Date().toISOString();
  const nextRevision = baseRevision + 1;
  const settings = {
    users: body.data.users,
    paymentMethods: body.data.paymentMethods,
    assets: body.data.assets,
    categories: body.data.categories,
    monthlyBudget: Number(body.data.monthlyBudget || 0),
    categoryBudgets: body.data.categoryBudgets || {},
    lastSavedAt: now
  };

  const statements = [
    env.DB.prepare(
      'INSERT INTO revisions (revision, saved_at, saved_by, transaction_count) VALUES (?, ?, ?, ?)'
    ).bind(nextRevision, now, 'household', body.data.transactions.length),
    env.DB.prepare(
      'UPDATE household_state SET revision = ?, initialized = 1, settings_json = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?'
    ).bind(nextRevision, JSON.stringify(settings), now, 'household', baseRevision),
    env.DB.prepare(
      'UPDATE transactions SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE deleted_at IS NULL'
    ).bind(now, now, 'household')
  ];

  for (const transaction of body.data.transactions) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO transactions (id, transaction_date, data_json, updated_at, updated_by, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           transaction_date = excluded.transaction_date,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           deleted_at = NULL`
      ).bind(
        String(transaction.id),
        String(transaction.transactionDate || ''),
        JSON.stringify(transaction),
        now,
        'household'
      )
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error(JSON.stringify({ event: 'household_save_failed', message: String(error) }));
    const latest = await readHousehold(env);
    if (latest.revision !== baseRevision) {
      return json({ error: '다른 기기에서 먼저 저장했습니다.', conflict: true, server: latest }, 409);
    }
    throw error;
  }

  console.log(
    JSON.stringify({
      event: 'household_saved',
      revision: nextRevision,
      transactions: body.data.transactions.length
    })
  );
  return json({ ok: true, revision: nextRevision, updatedAt: now });
}

async function handleApi(request, env, url) {
  if (url.pathname.startsWith('/api/auth/')) return handleAuthApi(request, env, url);

  if (!(await isAuthenticated(request, env))) {
    return json({ error: '로그인이 필요합니다.' }, 401);
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, storage: 'd1' });
  }
  if (url.pathname === '/api/data' && request.method === 'GET') {
    return json(await readHousehold(env));
  }
  if (url.pathname === '/api/data' && request.method === 'PUT') {
    return saveHousehold(request, env);
  }
  return json({ error: 'Not found' }, 404);
}

async function fetchAsset(request, env, path, noStore = false) {
  const assetUrl = new URL(path, request.url);
  const assetRequest = new Request(assetUrl, {
    method: 'GET',
    headers: request.headers
  });
  return secureAsset(await env.MY_ASSETS.fetch(assetRequest), noStore);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);

      const authenticated = await isAuthenticated(request, env);
      if (!authenticated) {
        if (url.pathname === '/login.html') return fetchAsset(request, env, '/login.html', true);
        return Response.redirect(new URL('/login.html', request.url), 303);
      }
      if (url.pathname === '/login.html') return Response.redirect(new URL('/', request.url), 303);

      const asset = secureAsset(await env.MY_ASSETS.fetch(request));
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return refreshSession(asset, env);
      }
      return asset;
    } catch (error) {
      console.error(JSON.stringify({ event: 'unhandled_error', message: String(error), path: url.pathname }));
      return url.pathname.startsWith('/api/')
        ? json({ error: '서버 오류가 발생했습니다.' }, 500)
        : new Response('File not found', { status: 404 });
    }
  }
};
