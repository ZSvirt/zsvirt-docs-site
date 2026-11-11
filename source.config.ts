import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkSearchStructure } from './src/lib/search/remark-search.mjs';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const apiReference = defineDocs({
  dir: 'content/api-reference',
  docs: {
    schema: pageSchema,
    async: true,
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkStructureOptions: false,
    remarkPlugins: [remarkSearchStructure],
    valueToExport: ['structuredData'],
  },
});
