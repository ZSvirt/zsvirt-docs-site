import assert from 'node:assert/strict';
import test from 'node:test';
import { localizedMainSiteUrl } from '../src/lib/main-site-url.ts';

test('localized main-site URLs follow the default-English route contract', () => {
  const origin = new URL(
    process.env.NEXT_PUBLIC_MAIN_SITE_BASE_URL?.trim() || 'https://zsvirt.io',
  ).origin;

  assert.equal(localizedMainSiteUrl('en'), `${origin}/`);
  assert.equal(localizedMainSiteUrl('zh'), `${origin}/zh`);
});
