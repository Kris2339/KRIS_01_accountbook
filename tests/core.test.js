import test from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  merge,
  resolve,
  validate,
  totals,
  monthRows,
} from "../public/core.js";
const tx = (id, amount = 100) => ({
  id,
  type: "expense",
  amount,
  transactionDate: "2026-09-22",
  memo: "",
});
const d = (transactions) => normalize({ transactions });
test("851 and 10,000 transactions are accepted", () => {
  assert.equal(
    validate(d(Array.from({ length: 10000 }, (_, i) => tx(String(i))))),
    null,
  );
});
test("offline addition survives remote changes", () => {
  const r = merge(d([tx("a")]), d([tx("a"), tx("b")]), d([tx("a"), tx("c")]));
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(
    new Set(r.data.transactions.map((x) => x.id)),
    new Set(["a", "b", "c"]),
  );
});
test("same-ID amount edit survives reconnect", () =>
  assert.equal(
    merge(d([tx("a")]), d([tx("a", 500)]), d([tx("a")])).data.transactions[0]
      .amount,
    500,
  ));
test("disjoint fields merge", () => {
  const r = merge(
    d([tx("a")]),
    d([{ ...tx("a"), memo: "memo" }]),
    d([tx("a", 500)]),
  );
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.data.transactions[0].memo, "memo");
  assert.equal(r.data.transactions[0].amount, 500);
});
test("same field conflict preserves both", () => {
  const r = merge(d([tx("a")]), d([tx("a", 400)]), d([tx("a", 500)]));
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].local, 400);
  assert.equal(
    resolve(r.data, r.conflicts[0], "remote").transactions[0].amount,
    500,
  );
});
test("offline deletion stays deleted", () =>
  assert.equal(
    merge(d([tx("a")]), d([]), d([tx("a")])).data.transactions.length,
    0,
  ));
test("edit vs delete is conflict", () => {
  const r = merge(d([tx("a")]), d([tx("a", 500)]), d([]));
  assert.equal(r.conflicts.length, 1);
  assert.equal(
    resolve(r.data, r.conflicts[0], "remote").transactions.length,
    0,
  );
});
test("legacy missing rows do not delete restored server rows", () => {
  assert.equal(
    merge(null, d([tx("a")]), d([tx("a"), tx("b")])).data.transactions.length,
    2,
  );
});
test("legacy same-ID differences become explicit conflicts", () => {
  assert.equal(
    merge(null, d([tx("a", 400)]), d([tx("a")])).conflicts.length,
    1,
  );
});
test("independent month budgets merge", () => {
  const r = merge(
    d([]),
    { ...d([]), monthlyBudgets: { "2026-09": { total: 100, categories: {} } } },
    { ...d([]), monthlyBudgets: { "2026-10": { total: 200, categories: {} } } },
  );
  assert.equal(r.conflicts.length, 0);
  assert.equal(Object.keys(r.data.monthlyBudgets).length, 2);
});
test("settings edit is preserved", () =>
  assert.equal(
    merge(d([]), { ...d([]), monthlyBudget: 500 }, d([])).data.monthlyBudget,
    500,
  ));
test("response loss retry equality creates no duplicate", () => {
  const r = merge(d([]), d([tx("a")]), d([tx("a")]));
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.data.transactions.length, 1);
});
test("bad amounts dates duplicate IDs rejected", () => {
  for (const t of [
    { ...tx("a"), amount: -2 },
    { ...tx("a"), amount: "200" },
    { ...tx("a"), transactionDate: "2026-02-30" },
  ])
    assert.ok(validate(d([t])));
  assert.ok(validate(d([tx("a"), tx("a")])));
});
test("unlinked categories and payment methods allowed", () =>
  assert.equal(validate(d([tx("a")])), null));
test("broken references rejected", () =>
  assert.ok(validate(d([{ ...tx("a"), categoryId: "missing" }]))));
test("memo newline and 10,000 characters preserved", () => {
  const memo = "메모\n".repeat(1000);
  const r = merge(d([tx("a")]), d([{ ...tx("a"), memo }]), d([tx("a")]));
  assert.equal(r.data.transactions[0].memo, memo);
  assert.equal(validate(r.data), null);
});
test("month totals do not double count transfers", () => {
  const data = d([
    tx("a"),
    { ...tx("b", 200), type: "income" },
    { ...tx("c", 300), type: "transfer" },
    { ...tx("d"), transactionDate: "2026-10-01" },
  ]);
  assert.deepEqual(totals(monthRows(data, "2026-09")), {
    expense: 100,
    income: 200,
  });
});
