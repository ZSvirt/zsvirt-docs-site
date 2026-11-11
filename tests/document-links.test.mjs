import assert from 'node:assert/strict';
import test from 'node:test';
import { documentAlternates, documentEditUrl } from '../src/lib/document-links.ts';

test('edit URLs retain source locale, renamed sections and index files', () => {
  assert.equal(documentEditUrl('docs', { path: 'zh/install-zsvirt/index.mdx' }),
    'https://github.com/ZSvirt/zsvirt-docs-site/edit/main/content/docs/zh/install-zsvirt/index.mdx');
  assert.equal(documentEditUrl('api-reference', { path: 'en/vm/create.mdx' }),
    'https://github.com/ZSvirt/zsvirt-docs-site/edit/main/content/api-reference/en/vm/create.mdx');
  assert.throws(() => documentEditUrl('docs', { path: '../private.mdx' }), /Invalid document source path/);
});

test('alternates use loader URLs and advertise only available translations', () => {
  const zh = { path: 'zh/install-zsvirt/index.mdx', url: '/docs/install-zsphere', slugs: ['install-zsvirt'], data: {} };
  const en = { ...zh, path: 'en/install-zsvirt/index.mdx', url: '/en/docs/install-zsphere' };
  const source = { getPage(slugs, locale) { assert.deepEqual(slugs, zh.slugs); return locale === 'zh' ? zh : en; } };
  assert.deepEqual(documentAlternates(source, en), {
    canonical: 'https://docs.zsvirt.io/en/docs/install-zsphere',
    languages: { 'zh-CN': 'https://docs.zsvirt.io/docs/install-zsphere', en: 'https://docs.zsvirt.io/en/docs/install-zsphere' },
  });
  assert.deepEqual(documentAlternates({ getPage: (_, locale) => locale === 'en' ? en : undefined }, en).languages,
    { en: 'https://docs.zsvirt.io/en/docs/install-zsphere' });
});
