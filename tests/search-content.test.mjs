import assert from 'node:assert/strict';
import test from 'node:test';
import { compile } from '@mdx-js/mdx';
import { remarkHeading } from 'fumadocs-core/mdx-plugins/remark-heading';
import { remarkSearchStructure } from '../src/lib/search/remark-search.mjs';
import { compactSearchContent, MAX_SEARCH_BLOCK_LENGTH } from '../src/lib/search/compact.mjs';

test('compiled MDX search keeps code identifiers, API endpoints and real heading IDs', async () => {
  const file = await compile(`<APIPage method="GET" path="/v1/backup-storage" altPaths={["/v1/backup-storage/{uuid}"]}>

## 查询镜像存储

使用 \`QueryBackupStorage\` 查询。

\`\`\`typescript
const command = "QueryBackupStorage";
\`\`\`

</APIPage>`, { remarkPlugins: [remarkHeading, remarkSearchStructure] });
  const data = file.data.structuredData;
  assert.equal(data.headings.length, 1);
  assert.equal(data.headings[0].id, '查询镜像存储');
  const text = data.contents.map((item) => item.content).join('\n');
  assert.match(text, /GET \/zstack\/v1\/backup-storage/);
  assert.match(text, /\/v1\/backup-storage\/\{uuid\}/);
  assert.match(text, /const command = "QueryBackupStorage"/);
  assert.match(text, /```typescript/, 'compiled search data preserves code boundaries for semantic snippet parsing');
  assert.ok(data.contents.some((item) => item.heading === data.headings[0].id && item.content.includes('QueryBackupStorage')));
});

test('dynamic API endpoint expressions fail the content build instead of vanishing from search', async () => {
  await assert.rejects(compile('<APIPage path={someRuntimeVariable} />', {
    remarkPlugins: [remarkHeading, remarkSearchStructure],
  }), /static APIPage path/);
});

test('chapter compaction preserves every text block in order and does not merge different anchors', () => {
  const input = {
    headings: [{ id: 'one', content: 'One' }, { id: 'two', content: 'Two' }],
    contents: [
      { content: 'Overview' },
      { heading: 'one', content: 'Field' },
      { heading: 'one', content: 'Meaning' },
      { heading: 'two', content: 'Notes' },
      { heading: 'two', content: 'x'.repeat(MAX_SEARCH_BLOCK_LENGTH + 1) },
    ],
  };
  const before = structuredClone(input);
  const output = compactSearchContent(input);
  assert.equal(output.contents.map((block) => block.content).join('\n'), input.contents.map((block) => block.content).join('\n'));
  assert.deepEqual(output.headings, input.headings);
  assert.equal(output.contents.length, 4);
  assert.equal(output.contents[1].heading, 'one');
  assert.equal(output.contents[2].heading, 'two');
  assert.deepEqual(input, before);
});
