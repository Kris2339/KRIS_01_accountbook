import { test, expect } from "@playwright/test";
import { normalize, localDate } from "../../public/core.js";
const today = localDate(),
  month = today.slice(0, 7);
const sample = () =>
  normalize({
    users: [
      { id: "u1", name: "사용자 1" },
      { id: "u2", name: "사용자 2" },
    ],
    paymentMethods: [{ id: "p1", name: "생활 카드" }],
    assets: [{ id: "a1", name: "생활비" }],
    categories: [
      { id: "c1", name: "식비", type: "expense" },
      { id: "c2", name: "카페", type: "expense" },
      { id: "c3", name: "생활", type: "expense" },
    ],
    transactions: Array.from({ length: 12 }, (_, i) => ({
      id: "t" + i,
      type: "expense",
      amount: 12000 + i * 500,
      userId: i % 2 ? "u2" : "u1",
      paymentMethodId: "p1",
      assetId: "a1",
      categoryId: ["c1", "c2", "c3"][i % 3],
      transactionDate: today,
      merchant: ["점심 식사", "동네 카페", "생활용품"][i % 3],
      memo: [
        "점심 식사 · 함께 먹은 메뉴 기록",
        "커피와 디저트\n오후 휴식",
        "세제와 주방용품",
      ][i % 3],
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
    })),
  });
async function put(request, data, revision) {
  return request.put("/api/data", {
    headers: { "x-accountbook-protocol": "2" },
    data: { baseRevision: revision, data, clientId: "test" },
  });
}
async function get(request) {
  return (
    await request.get("/api/data", {
      headers: { "x-accountbook-protocol": "2" },
    })
  ).json();
}
test.beforeEach(async ({ request }) => {
  const r = await get(request);
  const response = await put(request, sample(), r.revision);
  expect(response.ok(), await response.text()).toBeTruthy();
});
async function open(page) {
  await page.goto("/");
  await expect(page.locator(".transaction").first()).toBeVisible();
}
test("mobile memo input, save next resets actual scroll and amount, draft survives reload", async ({
  page,
  request,
}) => {
  await open(page);
  await page.screenshot({
    path: "test-results/mobile-ledger.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await page.locator("#amount").fill("25900");
  await page.locator("#memo").fill("긴 메모\n줄바꿈도 유지\n사용한 물건 기록");
  await page.locator("[name=asset]").selectOption("a1");
  await page
    .locator("#editor .dialog-body")
    .evaluate((e) => (e.scrollTop = 500));
  await page
    .getByRole("button", { name: "저장 후 계속 입력", exact: true })
    .click();
  await expect(page.locator("#amount")).toHaveValue("");
  await expect
    .poll(() =>
      page.locator("#editor .dialog-body").evaluate((e) => e.scrollTop),
    )
    .toBe(0);
  await expect(page.locator("#memo")).toHaveValue("");
  await expect(page.locator("[name=asset]")).toHaveValue("a1");
  await page.locator("#amount").fill("7800");
  await page.locator("#memo").fill("아직 저장하지 않은 초안");
  await page.reload();
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await expect(page.locator("#memo")).toHaveValue("아직 저장하지 않은 초안");
  await page.screenshot({ path: "test-results/mobile-editor.png" });
  await expect
    .poll(async () =>
      (await get(request)).data.transactions.some(
        (t) => t.memo === "긴 메모\n줄바꿈도 유지\n사용한 물건 기록",
      ),
    )
    .toBeTruthy();
});
test("report budget button never overlaps navigation, monthly budget saves, settings icon rename stays", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "리포트", exact: true }).click();
  await page.screenshot({
    path: "test-results/mobile-reports.png",
    fullPage: true,
  });
  const a = await page.locator("#budget-edit").boundingBox(),
    b = await page.locator(".navigation").boundingBox();
  expect(a.y + a.height <= b.y || a.y >= b.y + b.height).toBeTruthy();
  await page.locator("#budget-edit").click();
  await page.locator("[name=total]").fill("500000");
  await page.getByRole("button", { name: "예산 저장", exact: true }).click();
  await expect(
    page.getByText("500,000원 한도", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.screenshot({
    path: "test-results/mobile-settings.png",
    fullPage: true,
  });
  await page.locator("[data-setting=categories]").click();
  await page.locator("[data-entity=c1]").click();
  await page.locator("[name=name]").fill("새 식비 이름");
  await page.locator("[data-icon=gift]").click();
  await page.locator("#save-entity").click();
  await page.locator("[data-entity=c1]").click();
  await expect(page.locator("[data-icon=gift]")).toHaveClass(/active/);
});
test("viewing two details then deleting removes only selected transaction", async ({
  page,
  request,
}) => {
  await open(page);
  await page.locator("[data-transaction=t0]").click();
  await page.locator("[data-close=utility]").click();
  await page.locator("[data-transaction=t1]").click();
  await page.locator("#delete-record").click();
  await page.locator("#confirm-delete").click();
  await expect
    .poll(async () => (await get(request)).data.transactions.length)
    .toBe(11);
  expect(
    (await get(request)).data.transactions.some((t) => t.id === "t0"),
  ).toBeTruthy();
});
test("offline save reload and reconnect keeps addition", async ({
  page,
  context,
  request,
}) => {
  await open(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await page.locator("#amount").fill("3300");
  await page.locator("#memo").fill("오프라인 기록");
  await page.locator("[name=asset]").selectOption("a1");
  await page.locator("#save-record").click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect
    .poll(async () =>
      (await get(request)).data.transactions.some(
        (t) => t.memo === "오프라인 기록",
      ),
    )
    .toBeTruthy();
});
test("851 records save via real D1, stale/legacy writes rejected", async ({
  request,
}) => {
  const r = await get(request),
    data = sample();
  data.transactions = Array.from({ length: 1000 }, (_, i) => ({
    ...data.transactions[0],
    id: "bulk" + i,
  }));
  const response = await put(request, data, r.revision);
  expect(response.status(), await response.text()).toBe(200);
  expect((await get(request)).data.transactions.length).toBe(1000);
  expect((await put(request, sample(), r.revision)).status()).toBe(409);
  expect(
    (
      await request.put("/api/data", {
        data: { baseRevision: r.revision, data: sample() },
      })
    ).status(),
  ).toBe(426);
  expect((await request.get("/api/data")).status()).toBe(426);
});
test("simple memo input, search and desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.locator("#search").fill("주방");
  await expect(page.locator(".transaction")).toHaveCount(4);
  await page.screenshot({
    path: "test-results/desktop-ledger.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await expect(page.locator("#memo")).toBeVisible();
  await expect(page.locator("[name=merchant]")).toHaveCount(0);
  await expect(page.locator("#recent-memo")).toHaveCount(0);
  await expect(page.locator("#memo-count")).toHaveCount(0);
});
test("two simultaneous remote writers are atomic, history survives changes", async ({
  request,
}) => {
  const r = await get(request),
    a = sample(),
    b = sample();
  a.transactions[0].amount = 101;
  b.transactions[0].amount = 202;
  const results = await Promise.all([
    put(request, a, r.revision),
    put(request, b, r.revision),
  ]);
  expect(results.map((x) => x.status()).sort()).toEqual([200, 409]);
  const after = await get(request);
  expect(after.revision).toBe(r.revision + 1);
  expect([101, 202]).toContain(
    after.data.transactions.find((t) => t.id === "t0").amount,
  );
  expect(after.data.transactions.length).toBe(12);
});
test("malformed requests do not change records", async ({ request }) => {
  const r = await get(request),
    data = sample();
  data.transactions[0].amount = -100;
  expect((await put(request, data, r.revision)).status()).toBe(400);
  expect((await get(request)).revision).toBe(r.revision);
});
test("small screen and shortened keyboard viewport preserve save controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await open(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 380 });
  await expect(page.locator("#save-record")).toBeInViewport();
  await expect(page.locator("#save-next")).toBeInViewport();
  await page.locator("#memo").fill("키보드 높이 테스트");
  await page.locator("[data-close=editor]").click();
  await page.getByRole("button", { name: "거래 입력", exact: true }).click();
  await expect(page.locator("#amount")).toBeInViewport();
});

test("calendar is default, no slogan or brand icon, date selects inline records", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".calendar")).toBeVisible();
  await expect(page.locator(".brand")).toHaveText("가계부");
  await expect(page.locator(".brand-mark,.edition")).toHaveCount(0);
  await page.locator(`[data-day="${today}"]`).click();
  await expect(page.locator(".transaction")).toHaveCount(12);
  await page.locator("#clear-filter").click();
  await expect(page.locator(".calendar")).toBeVisible();
});

test("reports contain records and drill down without changing tabs", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "리포트", exact: true }).click();
  await expect(page.locator("#report-records .transaction")).toHaveCount(12);
  await page.locator("[data-category=c1]").click();
  await expect(page).toHaveURL(/#reports$/);
  await expect(page.locator("#report-records .transaction")).toHaveCount(4);
  await page.locator("#clear-filter").click();
  await expect(page.locator("#report-records .transaction")).toHaveCount(12);
  await page.locator("[data-report-asset=a1]").click();
  await expect(page.locator("#report-records .transaction")).toHaveCount(12);
  await page.locator("[data-transaction=t0]").click();
  await expect(page.locator("#utility")).toBeVisible();
});

test("asset is visible and mandatory before saving", async ({
  page,
  request,
}) => {
  await open(page);
  await page.locator("#add").click();
  await page.locator("#amount").fill("5500");
  await expect(page.locator("[name=asset]")).toBeVisible();
  await page.locator("#save-record").click();
  await expect(page.locator("#editor")).toBeVisible();
  expect((await get(request)).data.transactions).toHaveLength(12);
  await page.locator("[name=asset]").selectOption("a1");
  await page.locator("#save-record").click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect
    .poll(async () => (await get(request)).data.transactions.length)
    .toBe(13);
});

test("detail dismisses on backdrop but not on content or inside-to-outside drag", async ({
  page,
}) => {
  await open(page);
  await page.locator("[data-transaction=t0]").click();
  await page.locator("#utility .detail-memo").click();
  await expect(page.locator("#utility")).toBeVisible();
  const r = await page.locator("#utility .detail-memo").boundingBox();
  await page.mouse.move(r.x + 10, r.y + 10);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(page.locator("#utility")).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.locator("#utility")).not.toBeVisible();
});

test("editing legacy merchant preserves it and memo without duplicate input", async ({
  page,
  request,
}) => {
  await open(page);
  await page.locator("[data-transaction=t0]").click();
  await page.locator("#edit-record").click();
  await expect(page.locator("[name=merchant]")).toHaveCount(0);
  await expect(page.locator(".legacy-merchant")).toContainText("점심 식사");
  await page.locator("#memo").fill("메모 수정");
  await page.locator("#save-record").click();
  await expect
    .poll(
      async () =>
        (await get(request)).data.transactions.find((t) => t.id === "t0").memo,
    )
    .toBe("메모 수정");
  expect(
    (await get(request)).data.transactions.find((t) => t.id === "t0").merchant,
  ).toBe("점심 식사");
});
