import { expect, test } from '@playwright/test';
import { buildAdversarialBatch } from './helpers';

/** 数据行选择器：排除虚拟列表上下的 aria-hidden 占位行。 */
const dataRows = '.result-table tbody tr:not([aria-hidden="true"])';

test.describe('双峰复核 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('小样本：并列取读数升序、单一读数次席为空，表格追加两列', async ({ page }) => {
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(
      JSON.stringify({
        values: [5, -5, 5, -5, 0],
        queries: [
          { left: 0, right: 4 }, // 5 与 -5 各 2 次 → 首席 -5，次席 5
          { left: 0, right: 2 }, // 5 两次、-5 一次 → 首席 5，次席 -5
          { left: 4, right: 4 }, // 仅 0 → 次席为空
        ],
      }),
    );
    await page.getByTestId('bimodal-toggle').locator('input').check();
    await page.getByTestId('run-button').click();

    await page.getByTestId('status-panel').waitFor();

    // 表头追加次席两列
    const headers = page.locator('.result-head th');
    await expect(headers).toHaveCount(6);
    await expect(headers.nth(4)).toHaveText('次席读数');
    await expect(headers.nth(5)).toHaveText('次席频次');

    const rows = page.locator(dataRows);
    await expect(rows).toHaveCount(3);

    // 第 1 行：-5/2 首席，5/2 次席（频次并列，读数升序）
    await expect(rows.nth(0).locator('.col-mode').nth(0)).toHaveText('-5');
    await expect(rows.nth(0).locator('.col-count').nth(0)).toHaveText('2');
    await expect(rows.nth(0).locator('[data-testid="second-value-0"]')).toHaveText('5');
    await expect(rows.nth(0).locator('[data-testid="second-count-0"]')).toHaveText('2');

    // 第 2 行：5/2 首席，-5/1 次席
    await expect(rows.nth(1).locator('.col-mode').nth(0)).toHaveText('5');
    await expect(rows.nth(1).locator('[data-testid="second-value-1"]')).toHaveText('-5');
    await expect(rows.nth(1).locator('[data-testid="second-count-1"]')).toHaveText('1');

    // 第 3 行：窗口只有一种读数，次席明确为空
    const lastSecond = rows.nth(2).locator('[data-testid="second-value-2"]');
    await expect(lastSecond).toHaveText('—');
    await expect(lastSecond).toHaveAttribute('data-empty', 'true');

    // 末行状态栏
    await expect(page.getByTestId('last-second')).toHaveAttribute('data-empty', 'true');
    await expect(page.getByTestId('last-second')).toContainText('次席为空');
  });

  test('导出下载的是本次查询快照，含 bimodal 标记与逐行答案', async ({ page }) => {
    const payload = {
      values: [3, 1, 3, 1, 2],
      queries: [
        { left: 0, right: 4 }, // 1、3 各 2 次 → 1,3
        { left: 0, right: 0 }, // 仅 3 → second null
      ],
    };
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(JSON.stringify(payload));
    await page.getByTestId('bimodal-toggle').locator('input').check();
    await page.getByTestId('run-button').click();
    await page.getByTestId('status-panel').waitFor();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('bimodal');

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(exported.bimodal).toBe(true);
    expect(exported.queries).toEqual(payload.queries);
    expect(exported.answers).toEqual([
      {
        first: { value: 1, count: 2 },
        second: { value: 3, count: 2 },
      },
      {
        first: { value: 3, count: 1 },
        second: null,
      },
    ]);
  });

  test('未启用复核：页面与旧众数契约不变（四列、无次席、无导出按钮）', async ({ page }) => {
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(
      JSON.stringify({
        values: [1, 1, 2],
        queries: [{ left: 0, right: 2 }],
      }),
    );
    // 复选框默认不勾选，直接计算
    await page.getByTestId('run-button').click();
    await page.getByTestId('status-panel').waitFor();

    await expect(page.locator('.result-head th')).toHaveCount(4);
    await expect(page.locator('[data-testid^="second-value-"]')).toHaveCount(0);
    await expect(page.getByTestId('export-button')).toHaveCount(0);
    await expect(page.getByTestId('last-second')).toHaveCount(0);
    await expect(page.locator(dataRows)).toHaveCount(1);
  });

  test('关闭开关重算：次席列消失，恢复旧众数页面', async ({ page }) => {
    const payload = {
      values: [4, 4, 5],
      queries: [{ left: 0, right: 2 }],
    };
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(JSON.stringify(payload));

    await page.getByTestId('bimodal-toggle').locator('input').check();
    await page.getByTestId('run-button').click();
    await page.getByTestId('status-panel').waitFor();
    await expect(page.locator('.result-head th')).toHaveCount(6);
    await expect(page.getByTestId('export-button')).toBeVisible();

    await page.getByTestId('bimodal-toggle').locator('input').uncheck();
    await page.getByTestId('run-button').click();
    await page.getByTestId('status-panel').waitFor();
    await expect(page.locator('.result-head th')).toHaveCount(4);
    await expect(page.getByTestId('export-button')).toHaveCount(0);
    await expect(page.getByTestId('last-second')).toHaveCount(0);
  });

  test('20 万长表双峰：首末行预言核对，且换批不残留上一批第二名', async ({ page }) => {
    test.setTimeout(240_000);

    // ---- 先算一小批双峰结果（次席标记为容易识别的 -777001/-777002）----
    await page.getByTestId('json-input').click();
    await page.keyboard.insertText(
      JSON.stringify({
        values: [-777001, -777002, -777001, -777002],
        queries: [{ left: 0, right: 3 }],
      }),
    );
    await page.getByTestId('bimodal-toggle').locator('input').check();
    await page.getByTestId('run-button').click();
    await page.getByTestId('status-panel').waitFor();
    // 两者各 2 次：读数升序首席 -777002、次席 -777001
    await expect(page.getByTestId('last-second')).toContainText('-777001');

    // ---- 换批：发起 20 万长表的新一轮计算 ----
    const batch = buildAdversarialBatch();
    await page.getByTestId('json-input').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(batch.json);
    await page.getByTestId('run-button').click();

    // 点击后旧快照立即清空：新一轮结果到达前绝不能短暂展示上一批的第二名
    await expect(page.getByTestId('status-panel')).toHaveCount(0);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.getByTestId('last-second')).toHaveCount(0);

    const status = page.getByTestId('status-panel');
    await status.waitFor({ timeout: 180_000 });
    await expect(status).toContainText('200000 条');

    // 末行（全数组）：首名 424242/200，次席由预言机给出
    const lastRow = page.getByTestId('last-row');
    await expect(lastRow).toContainText('第 200000 个');
    await expect(lastRow).toContainText('众数 424242');
    await expect(lastRow).toContainText('频次 200');
    const lastSecond = page.getByTestId('last-second');
    await expect(lastSecond).toHaveAttribute('data-empty', 'false');
    await expect(lastSecond).toContainText(String(batch.lastExpected.second!.value));
    await expect(lastSecond).toContainText(`频次 ${batch.lastExpected.second!.count}`);

    // 末行表格行：滚动到底，核对首名/次席两列
    await page.getByRole('button', { name: '滚动到末行' }).click();
    const lastDataRow = page.locator(dataRows).filter({ hasText: '200000' });
    await expect(lastDataRow).toBeVisible();
    await expect(lastDataRow.locator('.col-mode').nth(0)).toHaveText(
      String(batch.lastExpected.first.value),
    );
    await expect(lastDataRow.locator('.col-second').nth(0)).toHaveText(
      String(batch.lastExpected.second!.value),
    );

    // 首行：滚回顶部，用预言机核对首查询的首名/次席
    await page.locator('.table-scroll').evaluate((el) => el.scrollTo({ top: 0 }));
    const firstRow = page.locator(dataRows).first();
    await expect(firstRow.locator('.col-index')).toHaveText('1');
    await expect(firstRow.locator('.col-range')).toContainText(
      `[${batch.queries[0].left}, ${batch.queries[0].right}]`,
    );
    await expect(firstRow.locator('.col-mode').nth(0)).toHaveText(
      String(batch.firstExpected.first.value),
    );
    await expect(firstRow.locator('.col-count').nth(0)).toHaveText(
      String(batch.firstExpected.first.count),
    );
    if (batch.firstExpected.second) {
      await expect(firstRow.locator('.col-second').nth(0)).toHaveText(
        String(batch.firstExpected.second.value),
      );
      await expect(firstRow.locator('.col-second').nth(1)).toHaveText(
        String(batch.firstExpected.second.count),
      );
    }

    // 换批隔离：任何可见次席单元格都不得残留上一批标记值
    const staleCells = page.locator(`[data-testid^="second-value-"]`, { hasText: '-777' });
    await expect(staleCells).toHaveCount(0);
  });
});
