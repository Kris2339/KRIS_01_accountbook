import { test, expect } from '@playwright/test';
import { normalize } from '../../public/core.js';
const headers = { 'x-accountbook-protocol': '2' };
test.beforeEach(async ({ page, request }) => {
  const prior = await (await request.get('/api/data', { headers })).json();
  const data = { users: [{ id: '1', name: '국환' }, { id: '2', name: '혜지' }],
    paymentMethods: [{ id: 'p', name: '카드', displayOrder: 1, userIds: ['1', '2'] }],
    assets: [{ id: 'a', name: '생활비', displayOrder: 1 }, { id: 'b', name: '데이트', displayOrder: 2 }],
    categories: [{ id: 'c', name: '식비', icon: '🍴', type: 'expense', displayOrder: 1 }, { id: 'd', name: '급여', type: 'income', displayOrder: 1 }], transactions: [] };
  const result = await request.put('/api/data', { headers, data: { baseRevision: prior.revision, data: normalize(data) } });
  expect(result.ok(), await result.text()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
  await page.locator('.nav-item[data-tab="settings"]').click();
});
test('collapsed sections are compact and each manager edits without changing other fields', async ({ page }) => {
  for (const section of await page.locator('.settings-disclosure').all()) {
    expect((await section.boundingBox()).height).toBeLessThanOrEqual(64);
  }
  for (const [id, title, type] of [['paymentMethodsList', '결제수단 관리', 'paymentMethods'], ['assetsSettingsList', '예산 관리', 'assets'], ['categoriesList', '카테고리 관리', 'categories']]) {
    await page.getByText(title, { exact: true }).click();
    const list = page.locator('#' + id);
    await expect(list.getByText('삭제', { exact: true })).toHaveCount(0);
    await expect(list.locator('.managed-order')).toHaveCount(0);
    const row = list.locator('.managed-setting').first();
    await row.getByRole('button', { name: /수정/ }).click();
    await row.getByRole('textbox', { name: '이름' }).fill('취소할 이름');
    await row.getByRole('button', { name: '취소', exact: true }).click();
    await expect(row).not.toContainText('취소할 이름');
    await row.getByRole('button', { name: /수정/ }).click();
    await row.getByRole('textbox', { name: '이름' }).fill(title + ' 변경');
    await row.getByRole('button', { name: '이름 저장' }).click();
    await expect(row.locator('.item-name')).toHaveText(new RegExp(title + ' 변경'));
    await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
    expect(await page.evaluate(type => state[type].some(x => x.name.endsWith(' 변경')), type)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/settings-compact.png', fullPage: true });
});
test('category rename preserves its icon after reload; delete is confirmed and can be undone', async ({ page }) => {
  await page.getByText('카테고리 관리', { exact: true }).click();
  const row = page.locator('#categoriesList .managed-setting').filter({ hasText: '식비' });
  const icon = await page.evaluate(() => state.categories.find(x => x.id === 'c').icon);
  await row.getByRole('button', { name: /수정/ }).click();
  await row.getByRole('textbox').fill('새 분류');
  await row.getByRole('button', { name: '이름 저장' }).click();
  await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
  await page.reload();
  await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
  expect(await page.evaluate(() => state.categories.find(x => x.id === 'c').icon)).toBe(icon);
  await page.locator('.nav-item[data-tab="settings"]').click();
  await page.getByText('카테고리 관리', { exact: true }).click();
  const renamed = page.locator('#categoriesList .managed-setting').filter({ hasText: '새 분류' });
  await renamed.getByRole('button', { name: /수정/ }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await renamed.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(renamed).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await renamed.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await page.evaluate(() => undoLastDelete());
  await expect(renamed).toHaveCount(1);
  await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
});
test('user selection retains one user, drafts survive updates, and ordering stays within category type', async ({ page }) => {
  await page.getByText('결제수단 관리', { exact: true }).click();
  const row = page.locator('#paymentMethodsList .managed-setting').first();
  await row.getByRole('button', { name: /수정/ }).click();
  await row.getByRole('textbox').fill('새 카드');
  await row.getByRole('button', { name: '✓ 혜지', exact: true }).click();
  await expect(row.getByRole('textbox')).toHaveValue('새 카드');
  await row.getByRole('button', { name: '✓ 국환', exact: true }).click();
  await expect(row.getByRole('button', { name: '✓ 국환', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('예산 관리', { exact: true }).click();
  const assets = page.locator('#assetsSettingsList');
  await assets.locator('..').getByRole('button', { name: '순서 변경', exact: true }).click();
  await assets.getByRole('button', { name: '생활비 아래로', exact: true }).click();
  await expect(assets.locator('.item-name').first()).toHaveText('데이트');
  await assets.locator('..').getByRole('button', { name: '순서 변경 완료' }).click();
  await expect(assets.locator('.managed-order')).toHaveCount(0);
  await page.getByText('카테고리 관리', { exact: true }).click();
  const categories = page.locator('#categoriesList');
  await categories.locator('..').getByRole('button', { name: '순서 변경', exact: true }).click();
  for (const move of await categories.locator('.managed-order button').all()) await expect(move).toBeDisabled();
});

test('all managers keep compact rows and aligned edit controls across viewport sizes', async ({ page }) => {
  for (const title of ['결제수단 관리', '예산 관리', '카테고리 관리']) await page.getByText(title, { exact: true }).click();
  await expect(page.getByText('각 결제수단을 사용할 사람을 선택할 수 있어요.')).toHaveCount(0);
  for (const width of [360, 390, 800, 1588]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ['paymentMethodsList', 'assetsSettingsList', 'categoriesList']) {
      const list = page.locator('#' + id);
      const row = list.locator('.managed-setting').first();
      const box = await row.boundingBox();
      expect(box.height, `${id} at ${width}px`).toBeLessThanOrEqual(id === 'paymentMethodsList' && width < 600 ? 88 : 66);
      const section = list.locator('..');
      const summary = await section.locator('summary').boundingBox();
      expect(box.y - summary.y - summary.height).toBeLessThanOrEqual(9);
      await row.getByRole('button', { name: /수정/ }).click();
      const buttons = row.locator('.managed-editor-actions button');
      const metrics = await buttons.evaluateAll(nodes => nodes.map(el => {
        const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
        return { top: r.top, bottom: r.bottom, height: r.height, radius: style.borderRadius };
      }));
      expect(new Set(metrics.map(x => x.height)).size).toBe(1);
      expect(new Set(metrics.map(x => x.top)).size).toBe(1);
      expect(new Set(metrics.map(x => x.radius)).size).toBe(1);
      expect(metrics[0].height).toBe(44);
      const inputBox = await row.getByRole('textbox').boundingBox();
      if (width >= 600) expect(Math.abs(inputBox.y - metrics[0].top)).toBeLessThan(1);
      else expect(metrics[0].top - inputBox.y - inputBox.height).toBeLessThanOrEqual(9);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (id === 'paymentMethodsList') await section.screenshot({ path: `test-results/settings-aligned-${width}.png` });
      await row.getByRole('button', { name: '취소', exact: true }).click();
    }
  }
});
