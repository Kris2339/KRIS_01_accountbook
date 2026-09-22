export const collections = [
  "transactions",
  "users",
  "paymentMethods",
  "assets",
  "categories",
];
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function stable(value) {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const same = (a, b) => stable(a) === stable(b);
export function normalize(data = {}) {
  return {
    ...data,
    ...Object.fromEntries(
      collections.map((k) => [k, Array.isArray(data[k]) ? data[k] : []]),
    ),
    monthlyBudget: data.monthlyBudget || 0,
    categoryBudgets: data.categoryBudgets || {},
    monthlyBudgets: data.monthlyBudgets || {},
  };
}
export function substantive(data) {
  const result = clone(normalize(data));
  delete result.lastSavedAt;
  return result;
}
// Three-way, field-level merge. Absence relative to a known base means deletion.
// Unknown legacy baseline never infers a deletion from a missing row.
export function merge(base, local, remote) {
  const conflicts = [];
  function value(b, l, r, path, known = true) {
    if (same(l, r)) return l;
    if (known && same(l, b)) return r;
    if (known && same(r, b)) return l;
    if (!known && l === undefined) return r;
    if (!known && r === undefined) return l;
    if (
      l &&
      r &&
      typeof l === "object" &&
      typeof r === "object" &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      const out = {};
      for (const k of new Set([
        ...Object.keys(b || {}),
        ...Object.keys(l),
        ...Object.keys(r),
      ])) {
        const v = value(b?.[k], l[k], r[k], [...path, k], known);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    conflicts.push({ path, local: l, remote: r });
    return l;
  }
  const out = {};
  local = substantive(local);
  remote = substantive(remote);
  base = base ? substantive(base) : null;
  for (const key of new Set([
    ...Object.keys(base || {}),
    ...Object.keys(local),
    ...Object.keys(remote),
  ])) {
    if (collections.includes(key)) {
      const map = (a) => new Map((a || []).map((t) => [String(t.id), t]));
      const bm = map(base?.[key]),
        lm = map(local[key]),
        rm = map(remote[key]);
      out[key] = [];
      for (const id of new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])) {
        const v = value(bm.get(id), lm.get(id), rm.get(id), [key, id], !!base);
        if (v !== undefined) out[key].push(v);
      }
    } else {
      const v = value(base?.[key], local[key], remote[key], [key], !!base);
      if (v !== undefined) out[key] = v;
    }
  }
  return { data: normalize(out), conflicts };
}
export function resolve(data, conflict, choice) {
  const result = clone(data),
    path = conflict.path,
    selected = choice === "remote" ? conflict.remote : conflict.local;
  let parent = result,
    index = 0;
  if (collections.includes(path[0])) {
    const list = result[path[0]],
      at = list.findIndex((t) => String(t.id) === path[1]);
    if (path.length === 2) {
      if (at >= 0) list.splice(at, 1);
      if (selected !== undefined) list.push(clone(selected));
      return result;
    }
    parent = list[at];
    index = 2;
  }
  for (; index < path.length - 1; index++) parent = parent[path[index]] ??= {};
  if (selected === undefined) delete parent[path.at(-1)];
  else parent[path.at(-1)] = clone(selected);
  return result;
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function monthRows(data, month, user = "all") {
  return data.transactions.filter(
    (t) =>
      t.transactionDate?.startsWith(month) &&
      (user === "all" || String(t.userId) === user),
  );
}
export function totals(rows) {
  return rows.reduce(
    (a, t) => {
      if (t.type === "expense" || t.type === "income")
        a[t.type] += Number(t.amount) || 0;
      return a;
    },
    { income: 0, expense: 0 },
  );
}
export function validate(data) {
  function unsafe(value, depth = 0) {
    if (depth > 40) return true;
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).some(
      (k) =>
        ["__proto__", "constructor", "prototype"].includes(k) ||
        unsafe(value[k], depth + 1),
    );
  }
  if (unsafe(data)) return "지원하지 않는 데이터 구조입니다.";
  if (!data || collections.some((k) => !Array.isArray(data[k])))
    return "파일의 기본 항목이 올바르지 않습니다.";
  for (const key of collections) {
    const ids = new Set();
    for (const item of data[key]) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id))
        return "비어 있거나 중복된 ID가 있습니다.";
      ids.add(item.id);
    }
  }
  for (const t of data.transactions) {
    if (
      !["expense", "income", "transfer"].includes(t.type) ||
      !Number.isSafeInteger(t.amount) ||
      t.amount <= 0
    )
      return "거래 종류 또는 금액이 올바르지 않습니다.";
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(t.transactionDate || "") ||
      !Number.isFinite(Date.parse(t.transactionDate)) ||
      new Date(t.transactionDate).toISOString().slice(0, 10) !==
        t.transactionDate
    )
      return "거래 날짜가 올바르지 않습니다.";
    if (
      typeof (t.memo ?? "") !== "string" ||
      (t.memo || "").length > 10000 ||
      typeof (t.merchant ?? "") !== "string" ||
      (t.merchant || "").length > 200
    )
      return "메모는 10,000자, 사용처는 200자 이내로 입력해주세요.";
    for (const [field, key] of [
      ["userId", "users"],
      ["paymentMethodId", "paymentMethods"],
      ["categoryId", "categories"],
      ["assetId", "assets"],
      ["toAssetId", "assets"],
    ]) {
      if (
        t[field] != null &&
        t[field] !== "" &&
        !data[key].some((x) => x.id === t[field])
      )
        return "거래에서 사용하는 항목이 없습니다. 항목을 복원해주세요.";
    }
  }
  if (
    !data.monthlyBudgets ||
    typeof data.monthlyBudgets !== "object" ||
    Array.isArray(data.monthlyBudgets)
  )
    return "월 예산 형식이 올바르지 않습니다.";
  for (const b of Object.values(data.monthlyBudgets)) {
    if (
      !b ||
      !Number.isSafeInteger(b.total) ||
      b.total < 0 ||
      !b.categories ||
      typeof b.categories !== "object" ||
      Array.isArray(b.categories) ||
      Object.values(b.categories).some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      return "예산은 0 이상의 정수로 입력해주세요.";
  }
  return null;
}
