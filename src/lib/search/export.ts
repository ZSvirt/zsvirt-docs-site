import 'server-only';

import { createHash } from 'node:crypto';
import type { StructuredData } from 'fumadocs-core/mdx-plugins/remark-structure';
import { apiSource } from '@/lib/api-source';
import { getDocRedirectTarget } from '@/lib/doc-redirects';
import { i18n, type Locale } from '@/lib/i18n';
import { source } from '@/lib/source';
import { compactSearchContent } from './compact.mjs';
import { createSnapshot } from '../../../search-runtime/snapshot.mjs';

const sections: Record<Locale, Record<string, string>> = {
  zh: {
    'quick-start': '快速开始',
    'user-guide': '用户手册',
    'install-zsvirt': '安装部署',
    'terraform-for-zsvirt': 'Terraform 管理',
    'api-reference': 'API 文档',
    faq: 'FAQ',
  },
  en: {
    'quick-start': 'Quick Start',
    'user-guide': 'User Guide',
    'install-zsvirt': 'Installation',
    'terraform-for-zsvirt': 'Terraform',
    'api-reference': 'API Docs',
    faq: 'FAQ',
  },
};

type SearchPage = {
  url: string;
  slugs: string[];
  data: {
    title: string;
    description?: string;
    structuredData: StructuredData | (() => Promise<StructuredData>);
  };
};

async function pageRecord(page: SearchPage, locale: Locale, section: string) {
  const compiled = page.data.structuredData;
  const structuredData = typeof compiled === 'function' ? await compiled() : compiled;
  if (!structuredData) throw new Error(`Missing compiled search content: ${page.url}`);
  const description = page.data.description?.trim();
  return {
    id: `page:${locale}:${createHash('sha256').update(page.url).digest('hex')}`,
    locale,
    url: page.url,
    title: page.data.title,
    ...(description ? { description } : {}),
    breadcrumbs: [sections[locale][section] ?? (locale === 'zh' ? '文档' : 'Documentation')],
    tag: section,
    structuredData: compactSearchContent(structuredData),
  };
}

/** Export the exact collections that the static pages render, including async API MDX. */
export async function exportSearchSnapshot() {
  const records = [];
  for (const locale of i18n.languages) {
    for (const page of source.getPages(locale)) {
      if (getDocRedirectTarget(locale, page.slugs)) continue;
      records.push(await pageRecord(page, locale, page.slugs[0] ?? 'docs'));
    }
    // Load sequentially to bound peak compiler/module memory on this large collection.
    for (const page of apiSource.getPages(locale)) {
      records.push(await pageRecord(page, locale, 'api-reference'));
    }
  }
  return createSnapshot(records);
}
