import { test, expect } from "@playwright/test";
import { normalize, localDate } from "../../public/core.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const headers = { "x-accountbook-protocol": "2" };
const today = localDate();
const sample = () =>
  normalize({
    users: [
      { id: "1", name: "사용자1" },
      { id: "2", name: "사용자2" },
    ],
    categories: [{ id: "c", name: "식비", type: "expense" }],
    paymentMethods: [{ id: "p", name: "카드", userIds: ["1", "2"] }],
    assets: [{ id: "a", name: "생활비", budget: 500000 }],
    monthlyBudgets: { "2026-09": { total: 700000, categories: {} } },
    transactions: Array.from({ length: 872 }, (_, i) => ({
      id: "t" + i,
      type: "expense",
      amount: 1000,
      userId: "1",
      categoryId: "c",
      paymentMethodId: "p",
      assetId: "a",
      transactionDate: today,
      memo: "기록" + i,
    })),
  });
const get = async (request) =>
  (await request.get("/api/data", { headers })).json();
test.beforeEach(async ({ request }) => {
  const r = await get(request);
  expect(
    (
      await request.put("/api/data", {
        headers,
        data: { baseRevision: r.revision, data: sample() },
      })
    ).ok(),
  ).toBeTruthy();
});
async function open(page) {
  await page.goto("/");
  await expect(page.locator("#globalSyncPill")).toHaveText("저장 완료");
}
test("pre-redesign markup and styles are restored exactly", async ({
  page,
}) => {
  const original = execFileSync(
    "git",
    [
      "-c",
      "safe.directory=C:/Git/Orolaa/accountbook",
      "show",
      "2a8c7f7:public/index.html",
    ],
    { encoding: "utf8", maxBuffer: 2000000 },
  );
  const current = readFileSync("public/index.html", "utf8");
  expect(current.split("  <script>")[0].replaceAll("\r\n", "\n").replace('  <link rel="stylesheet" href="/settings-management.css?v=3">\n', '')).toBe(
    original.split("  <script>")[0].replaceAll("\r\n", "\n").replace('          <div class="settings-hint">각 결제수단을 사용할 사람을 선택할 수 있어요.</div>\n', '').replace(
      '      position: sticky;\n      bottom: calc(92px + env(safe-area-inset-bottom));\n      z-index: 8;',
      '      position: static;',
    ),
  );
  await open(page);
  await expect(page.locator("#calendar-content")).toHaveClass(/active/);
  await expect(page.locator(".bottom-nav .nav-item")).toHaveCount(4);
  await page.screenshot({ path: "test-results/classic-calendar.png" });
});
test("original input saves record 873 and retains hidden newer settings", async ({
  page,
  request,
}) => {
  await open(page);
  await page.locator("#addTransactionBtn").click();
  await page.locator("#amountInput").fill("24000");
  await page.locator("#memoInput").fill("원래 입력");
  await page.screenshot({ path: "test-results/classic-input.png" });
  await page.locator("#saveTransaction").click();
  await expect(page.locator("#transactionModal")).not.toHaveClass(/active/);
  await expect
    .poll(async () => (await get(request)).data.transactions.length)
    .toBe(873);
  expect((await get(request)).data.monthlyBudgets["2026-09"].total).toBe(
    700000,
  );
});
test("offline classic save survives reload and reconnect", async ({
  page,
  context,
  request,
}) => {
  await open(page);
  await context.setOffline(true);
  await page.locator("#addTransactionBtn").click();
  await page.locator("#amountInput").fill("3300");
  await page.locator("#memoInput").fill("오프라인 복귀");
  await page.locator("#saveTransaction").click();
  await expect
    .poll(() => page.evaluate(() => state.transactions.length))
    .toBe(873);
  await context.setOffline(false);
  await page.reload();
  await expect
    .poll(async () =>
      (await get(request)).data.transactions.some(
        (t) => t.memo === "오프라인 복귀",
      ),
    )
    .toBe(true);
});
test("newer IndexedDB data is kept despite stale original localStorage", async ({
  page,
  context,
  request,
}) => {
  await open(page);
  await context.setOffline(true);
  await page.evaluate(async () => {
    const { LedgerStore } = await import("/sync.js");
    const s = new LedgerStore();
    await s.init();
    await s.edit((d) =>
      d.transactions.push({
        ...d.transactions[0],
        id: "pending-v2",
        memo: "개편 중 미전송",
      }),
    );
    localStorage.setItem(
      "household_data",
      JSON.stringify({ transactions: [] }),
    );
  });
  await context.setOffline(false);
  await page.reload();
  await expect
    .poll(async () =>
      (await get(request)).data.transactions.some((t) => t.id === "pending-v2"),
    )
    .toBe(true);
});
test("rapid original saves cannot drop the second queued change", async ({
  page,
  request,
}) => {
  await open(page);
  await page.evaluate(() => {
    state.transactions.push({ ...state.transactions[0], id: "rapid1" });
    saveData();
    state.transactions.push({ ...state.transactions[0], id: "rapid2" });
    saveData();
  });
  await expect
    .poll(async () => (await get(request)).data.transactions.length)
    .toBe(874);
});
