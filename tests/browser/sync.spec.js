import { test, expect } from "@playwright/test";
import { normalize } from "../../public/core.js";
const base = normalize({
  transactions: [
    {
      id: "original",
      type: "expense",
      amount: 100,
      transactionDate: "2026-09-22",
      memo: "",
    },
  ],
});
test.beforeEach(async ({ request, page }) => {
  const r = await (
    await request.get("/api/data", {
      headers: { "x-accountbook-protocol": "2" },
    })
  ).json();
  expect(
    (
      await request.put("/api/data", {
        headers: { "x-accountbook-protocol": "2" },
        data: { baseRevision: r.revision, data: base },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#sync")).toHaveText("동기화 완료");
});
test("new edit made during PUT remains pending until its own acknowledgement", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    const remote = structuredClone(s.state);
    let release, started;
    const waiting = new Promise((r) => (started = r));
    const sent = [];
    let revision = remote.revision,
      data = remote.base;
    s.api = async (method = "GET", p) => {
      if (method === "GET") return { initialized: true, revision, data };
      sent.push(p.data);
      if (sent.length === 1) {
        started();
        await new Promise((r) => (release = r));
      }
      data = p.data;
      revision++;
      return { revision };
    };
    await s.edit((d) =>
      d.transactions.push({
        id: "during-first",
        type: "expense",
        amount: 200,
        transactionDate: "2026-09-22",
        memo: "",
      }),
    );
    const running = s.sync();
    await waiting;
    await s.edit((d) =>
      d.transactions.push({
        id: "during-response",
        type: "expense",
        amount: 300,
        transactionDate: "2026-09-22",
        memo: "",
      }),
    );
    release();
    await running;
    return {
      sentCounts: sent.map((p) => p.transactions.length),
      pending: s.pending,
      total: s.data.transactions.length,
    };
  });
  expect(result).toEqual({ sentCounts: [2, 3], pending: false, total: 3 });
});
test("lost successful response recovers by GET without duplicate or data loss", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    let data = s.state.base,
      revision = s.state.revision,
      calls = 0;
    s.api = async (method = "GET", p) => {
      if (method === "GET") return { initialized: true, revision, data };
      calls++;
      data = p.data;
      revision++;
      throw Error("response lost");
    };
    await s.edit((d) =>
      d.transactions.push({
        id: "once",
        type: "expense",
        amount: 200,
        transactionDate: "2026-09-22",
        memo: "",
      }),
    );
    await s.sync();
    const pending = s.pending;
    await s.sync();
    return {
      calls,
      pending,
      after: s.pending,
      count: s.data.transactions.length,
    };
  });
  expect(r).toEqual({ calls: 1, pending: true, after: false, count: 2 });
});
test("conflict persists through a fresh store and does not overwrite local", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    const data = structuredClone(s.state.base);
    data.transactions[0].amount = 800;
    await s.edit((d) => (d.transactions[0].amount = 700));
    s.api = async () => ({
      initialized: true,
      revision: s.state.revision + 1,
      data,
    });
    await s.sync();
    const reload = new LedgerStore();
    await reload.init();
    return {
      amount: reload.data.transactions[0].amount,
      conflicts: reload.state.conflicts.length,
      pending: reload.pending,
    };
  });
  expect(r).toEqual({ amount: 700, conflicts: 1, pending: true });
});
test("independent stores sharing a browser cannot overwrite each other locally", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const a = new LedgerStore(),
      b = new LedgerStore();
    await a.init();
    await b.init();
    await Promise.all([
      a.edit((d) =>
        d.transactions.push({
          id: "a",
          type: "expense",
          amount: 200,
          transactionDate: "2026-09-22",
          memo: "",
        }),
      ),
      b.edit((d) =>
        d.transactions.push({
          id: "b",
          type: "expense",
          amount: 300,
          transactionDate: "2026-09-22",
          memo: "",
        }),
      ),
    ]);
    await a.refresh();
    return a.data.transactions.map((t) => t.id).sort();
  });
  expect(r).toEqual(["a", "b", "original"]);
});
test("storage failure never reports successful local save", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    s.write = async () => {
      throw Error("QuotaExceededError");
    };
    let message = "";
    try {
      await s.edit((d) => (d.transactions[0].amount = 1000));
    } catch (e) {
      message = e.message;
    }
    return { message, amount: s.data.transactions[0].amount };
  });
  expect(r).toEqual({ message: "QuotaExceededError", amount: 100 });
});
test("reconnect does not reverse newer committed revision", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    const before = s.state.revision;
    s.api = async () => ({
      initialized: true,
      revision: before - 1,
      data: { ...s.data, transactions: [] },
    });
    await s.sync();
    return { revision: s.state.revision, count: s.data.transactions.length };
  });
  expect(r.count).toBe(1);
});
