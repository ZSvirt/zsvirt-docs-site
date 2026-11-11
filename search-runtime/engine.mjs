import { create, insertMultiple, search } from '@orama/orama';
import { createContentHighlighter } from 'fumadocs-core/search';
import { createTokenizer as createMandarinTokenizer } from '@orama/tokenizers/mandarin';
import { toMarkdown } from 'mdast-util-to-markdown';
import { markdownText } from './markdown-text.mjs';

const schema = {
  title: 'string',
  heading: 'string',
  content: 'string',
  endpoint: 'string',
  page_id: 'string',
  type: 'string',
  url: 'string',
  breadcrumbs: 'string[]',
  format: 'enum',
};
const MAX_SNIPPET_LENGTH = 400;

function excerpt(content, query, tokenizer) {
  const text = content.replace(/\s+/gu, ' ').trim();
  if (text.length <= MAX_SNIPPET_LENGTH) return text;
  const lower = text.toLocaleLowerCase();
  const phrase = query.toLocaleLowerCase();
  let match = lower.indexOf(phrase);
  if (match < 0) {
    for (const token of tokenizer.tokenize(query)) {
      const index = lower.indexOf(token.toLocaleLowerCase());
      if (index >= 0 && (match < 0 || index < match)) match = index;
    }
  }
  const start = Math.max(0, Math.min(Math.max(0, match - 100), text.length - MAX_SNIPPET_LENGTH));
  const segment = text.slice(start, start + MAX_SNIPPET_LENGTH);
  return `${start ? '…' : ''}${segment}${start + MAX_SNIPPET_LENGTH < text.length ? '…' : ''}`;
}

function displayContent(content, query, tokenizer, highlighter, format) {
  const text = format === 'markdown' ? markdownText(content) : content;
  const snippet = excerpt(text, query, tokenizer);
  const children = highlighter.highlight(snippet).flatMap((part) => part.styles?.highlight ? [
    { type: 'html', value: '<mark>' },
    { type: 'text', value: part.content },
    { type: 'html', value: '</mark>' },
  ] : [{ type: 'text', value: part.content }]);
  // The dialog parses raw HTML. Markdown serialization escapes every source
  // character in text nodes; only our fixed highlight tags are HTML nodes.
  return toMarkdown({ type: 'root', children: [{ type: 'paragraph', children }] }).trimEnd();
}

function endpointsFromContent(content) {
  const lines = content.split('\n').map((line) => line.trim());
  const endpoints = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const method = lines[index].match(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/(?:zstack\/)?v1\/\S+)$/i);
    if (!method) continue;
    const publicPath = lines[index + 1]?.match(/^\/v1\/\S+$/)?.[0];
    endpoints.add(publicPath ?? method[1].replace(/^\/zstack(?=\/v1\/)/, ''));
  }
  return [...endpoints].join(' ');
}

function documentsFrom(records) {
  const documents = [];
  for (const record of records) {
    const shared = { page_id: record.id, breadcrumbs: record.breadcrumbs ?? [], format: 'markdown' };
    documents.push({ ...shared, id: record.id, type: 'page', title: record.title, heading: '', content: '', endpoint: '', url: record.url, format: 'plain' });
    let childIndex = 0;
    if (record.description) {
      documents.push({ ...shared, id: `${record.id}-${childIndex++}`, type: 'text', title: '', heading: '', content: record.description, endpoint: '', url: record.url, format: 'plain' });
    }
    for (const heading of record.structuredData.headings) {
      documents.push({ ...shared, id: `${record.id}-${childIndex++}`, type: 'heading', title: '', heading: heading.content, content: '', endpoint: '', url: `${record.url}#${heading.id}` });
    }
    for (const content of record.structuredData.contents) {
      documents.push({
        ...shared, id: `${record.id}-${childIndex++}`, type: 'text', title: '', heading: '',
        content: content.content,
        endpoint: record.url.includes('/api-reference/') ? endpointsFromContent(content.content) : '',
        url: content.heading ? `${record.url}#${content.heading}` : record.url,
      });
    }
  }
  return documents;
}

function phraseMatchRank(document, query) {
  const phrase = query.toLocaleLowerCase();
  const title = document.title.toLocaleLowerCase();
  const heading = document.heading.toLocaleLowerCase();
  if (title === phrase) return 6;
  if (heading === phrase) return 5;
  if (phrase.startsWith('/v1/')) {
    const endpoints = document.endpoint.toLocaleLowerCase().split(' ');
    if (endpoints.includes(phrase)) return 4;
  }
  if (title.includes(phrase)) return 3;
  if (heading.includes(phrase)) return 2;
  if (phrase.startsWith('/v1/')) {
    const endpoints = document.endpoint.toLocaleLowerCase().split(' ');
    if (endpoints.some((endpoint) => endpoint.includes(phrase))) return 1;
  }
  return 0;
}

export async function createSearchEngine(records, locale) {
  const options = { schema };
  if (locale === 'zh') options.components = { tokenizer: await createMandarinTokenizer() };
  else if (locale === 'en') options.language = 'english';
  else throw new Error(`Unsupported search locale: ${locale}`);
  const database = create(options);
  await insertMultiple(database, documentsFrom(records));
  const pages = new Map(records.map((record) => [record.id, record]));

  return {
    async search(query, { limit = 20 } = {}) {
      const highlighter = createContentHighlighter(query);
      const result = await search(database, {
        term: query,
        // Orama 3.1.18 threshold:0 still uses Radix prefix matches; this is
        // keyword filtering, not a strict distinct-term AND guarantee.
        threshold: 0,
        properties: ['title', 'heading', 'endpoint', 'content'],
        boost: { title: 60, heading: 8, endpoint: 40, content: 1 },
        sortBy: (a, b) => phraseMatchRank(b[2], query) - phraseMatchRank(a[2], query) || b[1] - a[1],
        groupBy: { properties: ['page_id'], maxResult: 2 },
        limit,
      });
      const items = [];
      // Orama groups retain first occurrence from its already sorted hits.
      for (const group of result.groups ?? []) {
        const page = pages.get(group.values[0]);
        if (!page) throw new Error('Search result refers to a missing page');
        items.push({ id: page.id, type: 'page', content: displayContent(page.title, query, database.tokenizer, highlighter, 'plain'), breadcrumbs: page.breadcrumbs ?? [], url: page.url });
        if (items.length >= limit) break;
        for (const hit of group.result) {
          if (hit.document.type === 'page') continue;
          items.push({
            id: hit.document.id,
            type: hit.document.type,
            content: displayContent(hit.document.type === 'heading' ? hit.document.heading : hit.document.content, query, database.tokenizer, highlighter, hit.document.format),
            url: hit.document.url,
          });
          if (items.length >= limit) break;
        }
        if (items.length >= limit) break;
      }
      return items;
    },
  };
}
