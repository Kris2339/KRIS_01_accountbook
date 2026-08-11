const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function secureAsset(response) {
  const secured = new Response(response.body, response);
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('x-frame-options', 'DENY');
  secured.headers.set('referrer-policy', 'no-referrer');
  secured.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  secured.headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  return secured;
}

function allowedEmails(env) {
  return new Set(
    String(env.ALLOWED_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAuthenticatedEmail(request, env) {
  if (env.LOCAL_DEV === 'true') return 'local-dev@accountbook.invalid';

  const email = request.headers
    .get('cf-access-authenticated-user-email')
    ?.trim()
    .toLowerCase();
  const allowed = allowedEmails(env);

  if (!email || allowed.size === 0 || !allowed.has(email)) return null;
  return email;
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

async function saveHousehold(request, env, email) {
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
    // revision is a primary key. Concurrent writes from the same base revision
    // cause one entire D1 batch to roll back instead of silently overwriting data.
    env.DB.prepare(
      'INSERT INTO revisions (revision, saved_at, saved_by, transaction_count) VALUES (?, ?, ?, ?)'
    ).bind(nextRevision, now, email, body.data.transactions.length),
    env.DB.prepare(
      'UPDATE household_state SET revision = ?, initialized = 1, settings_json = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?'
    ).bind(nextRevision, JSON.stringify(settings), now, email, baseRevision),
    env.DB.prepare(
      'UPDATE transactions SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE deleted_at IS NULL'
    ).bind(now, now, email)
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
        email
      )
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error(JSON.stringify({ event: 'household_save_failed', message: String(error), email }));
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
      transactions: body.data.transactions.length,
      email
    })
  );
  return json({ ok: true, revision: nextRevision, updatedAt: now });
}

async function handleApi(request, env) {
  const email = getAuthenticatedEmail(request, env);
  if (!email) {
    return json(
      { error: 'Cloudflare Access 로그인이 필요하거나 허용된 사용자가 아닙니다.' },
      401
    );
  }

  const url = new URL(request.url);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, storage: 'd1' });
  }
  if (url.pathname === '/api/data' && request.method === 'GET') {
    return json(await readHousehold(env));
  }
  if (url.pathname === '/api/data' && request.method === 'PUT') {
    return saveHousehold(request, env, email);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return secureAsset(await env.MY_ASSETS.fetch(request));
    } catch (error) {
      console.error(JSON.stringify({ event: 'unhandled_error', message: String(error), path: url.pathname }));
      return url.pathname.startsWith('/api/')
        ? json({ error: '서버 오류가 발생했습니다.' }, 500)
        : new Response('File not found', { status: 404 });
    }
  }
};
