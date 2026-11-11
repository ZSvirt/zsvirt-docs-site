import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const base = new URL(process.env.DOC_SITE_URL ?? 'http://127.0.0.1:4322');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Search E2E must target a local server');
const output = fileURLToPath(new URL('../test-results/search/', import.meta.url));
await mkdir(output, { recursive: true });
const report = { api: [], browser: [], unexpectedIndexDownloads: [] };

for (const [locale, query, expected] of [
  ['zh', '新建虚拟机', '/docs/api-reference/compute/vm/create-vm-instance'],
  ['zh', 'QueryBackupStorage', '/docs/api-reference/compute/image-storage/image-storage/query-backup-storage'],
  ['zh', '/v1/backup-storage', '/docs/api-reference/compute/image-storage/image-storage/query-backup-storage'],
  ['zh', 'zsphere_image_storage', '/docs/terraform-for-zsphere/resources/image_storage'],
  ['en', 'QueryBackupStorage', '/en/docs/api-reference/compute/image-storage/image-storage/query-backup-storage'],
]) {
  const url = new URL('/api/search', base);
  url.search = new URLSearchParams({ query, locale });
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const results = await response.json();
  assert.ok(results.length > 0 && results.length <= 20);
  assert.ok(results.every((item) => locale === 'en' ? item.url.startsWith('/en/docs/') : item.url.startsWith('/docs/')));
  const pages = results.filter((item) => item.type === 'page');
  assert.ok(pages.slice(0, 5).some((item) => item.url === expected), `${locale} ${query}: expected a relevant page in the first five, got ${pages.map((item) => item.url)}`);
  report.api.push({ locale, query, expected, resultCount: results.length, pageRank: pages.findIndex((item) => item.url === expected) + 1 });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 1024, 768, 390]) {
    for (const locale of ['zh', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: locale === 'zh' ? 'light' : 'dark' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/docs/search-index.json') report.unexpectedIndexDownloads.push(request.url());
      });
      const prefix = locale === 'zh' ? '' : '/en';
      await page.goto(new URL(`${prefix}/docs/quick-start`, base).href, { waitUntil: 'networkidle' });
      const trigger = page.locator(width >= 1024 ? '.zsphere-docs-search-desktop' : '.zsphere-docs-search-mobile');
      await expect(trigger).toBeVisible();
      const triggerBox = await trigger.boundingBox();
      assert.ok(triggerBox.x >= 0 && triggerBox.x + triggerBox.width <= width + 1);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const input = dialog.getByRole('textbox');
      await input.fill('QueryBackupStorage');
      const title = locale === 'zh' ? '查询镜像存储' : 'Query Backup Storage';
      await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await dialog.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      const resultText = await dialog.innerText();
      assert.ok(!resultText.includes('<mark>') && !resultText.includes('&quot;') && !resultText.includes('```'), 'result snippets must display plain code and real highlighting');
      assert.ok(await dialog.locator('.zsphere-docs-search-results p').evaluateAll((paragraphs) => paragraphs.every((paragraph) => paragraph.scrollWidth <= paragraph.clientWidth + 1)), 'technical identifiers must wrap within narrow results');
      const box = await dialog.boundingBox();
      assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `Dialog overflows at ${width}`);
      await page.screenshot({ path: `${output}/${locale}-${width}.png`, fullPage: false });
      await dialog.getByText(title, { exact: true }).first().click();
      await page.waitForURL(`**${prefix}/docs/api-reference/compute/image-storage/image-storage/query-backup-storage`, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

      // Header search must also work on API pages and clear on a provider hotkey close.
      await page.keyboard.press('Control+k');
      await expect(dialog).toBeVisible();
      await input.fill('QueryBackupStorage');
      await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible();
      await page.keyboard.press('Control+k');
      await expect(dialog).toBeHidden();
      await page.keyboard.press('Meta+k');
      await expect(dialog).toBeVisible();
      await expect(input).toHaveValue('');
      await input.fill('zzzzzxqvnonexistentsearch');
      await expect(dialog.getByText(locale === 'zh' ? '未找到结果' : 'No results found', { exact: true })).toBeVisible();

      if (locale === 'zh') {
        await input.fill('初始密码');
        const loginSnippet = dialog.locator('button').filter({ hasText: '默认账户名' }).first();
        await expect(loginSnippet).toBeVisible();
        await expect(loginSnippet).toContainText('默认账户名：admin，默认初始密码：password。');
        assert.ok(!(await loginSnippet.innerText()).includes('**'), 'prose emphasis must not leak as literal Markdown');
        await expect(loginSnippet.locator('.underline').filter({ hasText: '初始密码' })).toBeVisible();
        await expect.poll(() => dialog.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(300);
        await dialog.evaluate(async (element) => {
          await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
        });
        await page.screenshot({ path: `${output}/zh-markdown-${width}.png`, fullPage: false });
      }

      if (width === 1440 && locale === 'zh') {
        const pattern = '**/api/search?**';
        await page.route(pattern, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SEARCH_UNAVAILABLE"}}' }));
        await input.fill('QueryBackupStorage');
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(dialog.getByText('未找到结果', { exact: true })).toHaveCount(0);
        await page.unroute(pattern);
        await dialog.getByRole('button', { name: '重试', exact: true }).click();
        await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible();

        // A blackholed request must leave loading and show the same retryable error.
        await page.route(pattern, () => {});
        await input.fill('timeoutsearchprobe');
        await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 14_000 });
        await page.unroute(pattern);
      }
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, [], `${locale}/${width} browser errors`);
      report.browser.push({ width, locale, theme: locale === 'zh' ? 'light' : 'dark', navigation: 'passed', shortcuts: 'passed', empty: 'passed' });
      await context.close();
    }
  }
  assert.deepEqual(report.unexpectedIndexDownloads, [], 'The browser must only fetch search results');
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ event: 'doc_search_e2e_passed', apiCases: report.api.length, browserCases: report.browser.length, output }));
} finally {
  await browser.close();
}
