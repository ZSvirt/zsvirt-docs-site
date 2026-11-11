import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = new URL(process.env.DOC_SITE_URL ?? 'http://127.0.0.1:4322');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Site E2E must target a local server');
const canonicalOrigin = 'https://docs.zsvirt.io';
const editPrefix = 'https://github.com/ZSvirt/zsvirt-docs-site/edit/main/';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const analytics = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/google-analytics|googletagmanager/.test(url.hostname) || url.pathname === '/api/track') {
      analytics.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const path of ['/', '/docs', '/en/docs', '/docs/install-zsphere', '/en/docs/install-zsphere', '/docs/api-reference/compute/vm/create-vm-instance', '/en/docs/api-reference/compute/vm/create-vm-instance']) {
    const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, path);
    assert.equal(new URL(page.url()).origin, base.origin, 'Documentation must remain on its own origin');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${canonicalOrigin}${path === '/' ? '/docs' : path}`);
    for (const language of ['zh-CN', 'en']) {
      const href = await page.locator(`link[rel="alternate"][hreflang="${language}"]`).getAttribute('href');
      assert.equal(new URL(href).origin, canonicalOrigin);
    }
    const edit = page.locator(`a[href^="${editPrefix}"]`);
    await expect(edit).toBeVisible();
    const sourcePath = decodeURIComponent((await edit.getAttribute('href')).slice(editPrefix.length));
    await access(new URL(`../${sourcePath}`, import.meta.url));
    assert.ok(sourcePath.includes(path.startsWith('/en/') ? '/en/' : '/zh/'));
    if (path.includes('install-zsphere')) assert.ok(sourcePath.endsWith('/install-zsvirt/index.mdx'));
  }
  assert.deepEqual(analytics, [], 'Public documentation must not send analytics');
  assert.deepEqual(errors, []);
  const robots = await fetch(new URL('/robots.txt', base));
  assert.equal(robots.status, 200);
  assert.ok((await robots.text()).includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
  const sitemap = await fetch(new URL('/sitemap.xml', base));
  assert.equal(sitemap.status, 200);
  const xml = await sitemap.text();
  for (const path of ['/docs/install-zsphere', '/en/docs/install-zsphere', '/docs/api-reference/compute/vm/create-vm-instance']) {
    assert.ok(xml.includes(`<loc>${canonicalOrigin}${path}</loc>`), path);
  }
  console.info('Standalone documentation entry, metadata, source links and privacy checks passed.');
} finally {
  await browser.close();
}
