import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownText } from '../search-runtime/markdown-text.mjs';
import { createSearchEngine } from '../search-runtime/engine.mjs';

test('Markdown summaries read formatting, links, lists and GFM instead of displaying their syntax', () => {
  const text = markdownText('默认账户名：**admin**，默认初始密码：**password**。点击**登录**。\n\n[安装说明](https://example.com/install) 与 *说明*、~~旧设置~~。\n\n- 第一步\n- 第二步\n\n| 字段 | 含义 |\n| --- | --- |\n| api_key | 密钥 |');
  assert.ok(text.includes('默认账户名：admin，默认初始密码：password。点击登录。'));
  assert.ok(text.includes('安装说明 与 说明、旧设置。'));
  assert.ok(text.includes('第一步\n第二步'));
  assert.ok(text.includes('api_key\n密钥'));
  assert.ok(!text.includes('**') && !text.includes('~~') && !text.includes('https://example.com') && !text.includes('|'));
});

test('code syntax and escaped literal punctuation survive Markdown interpretation', () => {
  const code = 'const api_key = "**literal**_value";\nconst html = "<img src=x onerror=alert(1)>";';
  const text = markdownText('API `api_key`；\\*literal\\*。\n\n```js\n' + code + '\n```');
  assert.ok(text.includes('API api_key；*literal*。'));
  assert.ok(text.includes(code));
  assert.ok(!text.includes('```'));
});

test('search parses formatting before excerpting while preserving safe highlighting and plain titles', async () => {
  const engine = await createSearchEngine([{
    id: 'zh:login', locale: 'zh', url: '/docs/login', title: 'Literal ** title',
    structuredData: { headings: [], contents: [{ content: `${'前文。'.repeat(180)}默认账户名：**admin**，默认初始密码：**password**。点击**登录**。` }] },
  }], 'zh');
  const results = await engine.search('初始密码');
  const item = results.find((result) => result.type === 'text');
  assert.ok(item.content.includes('<mark>初始密码</mark>'));
  const displayedText = markdownText(item.content).replaceAll('<mark>', '').replaceAll('</mark>', '');
  assert.ok(displayedText.includes('默认账户名：admin，默认初始密码：password。点击登录。'));
  assert.ok(!displayedText.includes('**'));
  assert.ok(displayedText.length <= 402);
  assert.ok(markdownText(results[0].content).includes('Literal ** title'), 'frontmatter titles are plain text');
});
