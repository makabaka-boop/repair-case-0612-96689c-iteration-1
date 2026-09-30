import { expect, test } from '@playwright/test';

/** 构造 20 万读数 + 20 万查询的对抗批次：大区间与单点交替，末区间为全数组。 */
function buildAdversarialBatch(): { json: string; first: { left: number; right: number } } {
  const n = 200_000;
  const q = 200_000;

  let seed = 20260916 >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const values = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    values[i] = (i % 1000 === 0) ? 424242 : Math.floor(rand() * 30000) - 15000;
  }

  const queries = new Array<{ left: number; right: number }>(q);
  for (let i = 0; i < q - 1; i++) {
    if ((i & 1) === 0) {
      const l = Math.floor(rand() * 1000);
      queries[i] = { left: l, right: n - 1 - Math.floor(rand() * 1000) };
    } else {
      const p = Math.floor(rand() * n);
      queries[i] = { left: p, right: p };
    }
  }
  // 全数组区间：哨兵值 424242 出现 200 次，是可核对的唯一末行答案
  queries[q - 1] = { left: 0, right: n - 1 };

  return { json: JSON.stringify({ values, queries }), first: queries[0] };
}

test.describe('区间众数巡检 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('粘贴小样本并核对并列裁决与结果表', async ({ page }) => {
    const input = page.getByTestId('json-input');
    const payload = JSON.stringify({
      values: [5, -5, 5, -5, 0],
      queries: [
        { left: 0, right: 4 }, // 5 与 -5 各 2 次 → -5
        { left: 0, right: 2 }, // 5 两次 → 5
        { left: 4, right: 4 }, // 0
      ],
    });
    await input.click();
    await page.keyboard.insertText(payload);
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('status-panel')).toBeVisible();
    const rows = page.locator('.result-table tbody tr:not([aria-hidden="true"])');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('-5');
    await expect(rows.nth(0)).toContainText('2');
    await expect(rows.nth(1)).toContainText('5');
    await expect(rows.nth(2)).toContainText('0');

    // 末行核对
    await expect(page.getByTestId('last-row')).toContainText('众数 0');
    await expect(page.getByTestId('last-row')).toContainText('频次 1');
  });

  test('示例按钮可填入并完成计算', async ({ page }) => {
    await page.getByTestId('example-button').click();
    await expect(page.getByTestId('json-input')).toContainText('"values"');
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('status-panel')).toBeVisible();
    await expect(page.getByTestId('last-row')).toContainText('众数 0');
  });

  test('非法输入：定位首个错误、清空旧结果、不输出部分答案', async ({ page }) => {
    // 先得到一份有效结果
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(
      JSON.stringify({
        values: [1, 1, 2],
        queries: [{ left: 0, right: 2 }],
      }),
    );
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();

    // 改为非法输入（非整数）
    const input = page.getByTestId('json-input');
    await input.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      JSON.stringify({ values: [1, 2.5, 3], queries: [{ left: 0, right: 2 }] }),
    );
    await page.getByTestId('run-button').click();

    const errorBox = page.getByTestId('error-box');
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText('$.values[1]');
    await expect(errorBox).toContainText('小数');
    // 旧结果已清空
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.getByTestId('status-panel')).toHaveCount(0);

    // 非法区间也被拒绝
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      JSON.stringify({ values: [1, 2], queries: [{ left: 1, right: 0 }] }),
    );
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('error-box')).toContainText('$.queries[0].left');
  });

  test('未知字段与越界区间报错', async ({ page }) => {
    const input = page.getByTestId('json-input');
    await input.click();
    await page.keyboard.insertText(
      JSON.stringify({
        values: [1, 2],
        queries: [{ left: 0, right: 5 }],
      }),
    );
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('error-box')).toContainText('$.queries[0].right');

    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      '{"values":[1],"queries":[{"left":0,"right":0}],"extra":true}',
    );
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('error-box')).toContainText('$.extra');
  });

  test('20 万读数与 20 万查询：保持顺序、可浏览且末行可核对', async ({ page }) => {
    test.setTimeout(180_000);
    const batch = buildAdversarialBatch();
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(batch.json);
    await page.getByTestId('run-button').click();

    const status = page.getByTestId('status-panel');
    await status.waitFor({ timeout: 120_000 });
    await expect(status).toContainText('200000 条');
    await expect(status).toContainText('200000 个');

    // 末行：哨兵值 424242 每 1000 个出现一次（i=0,1000,…,199000），共 200 次
    const lastRow = page.getByTestId('last-row');
    await expect(lastRow).toContainText('第 200000 个');
    await expect(lastRow).toContainText('[0, 199999]');
    await expect(lastRow).toContainText('众数 424242');
    await expect(lastRow).toContainText('频次 200');

    // 结果浏览：滚动到末行后能看到第 200000 行
    await page.getByRole('button', { name: '滚动到末行' }).click();
    await expect(page.locator('.result-table tbody tr:not([aria-hidden="true"])', { hasText: '200000' })).toBeVisible();

    // 首行仍可浏览（滚回顶部，验证虚拟表不丢内容）
    const scroller = page.locator('.table-scroll');
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.locator('.col-index', { hasText: '1' }).first()).toBeVisible();
    await expect(page.locator('.result-table tbody tr:not([aria-hidden="true"]) .col-range').first()).toContainText(
      `[${batch.first.left}, ${batch.first.right}]`,
    );
  });
});
