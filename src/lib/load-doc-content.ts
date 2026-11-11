import type { TableOfContents } from 'fumadocs-core/toc';
import type { ComponentType } from 'react';

type LoadedDocContent = {
  body: ComponentType<Record<string, unknown>>;
  toc: TableOfContents;
};

type DocPageData = {
  body?: ComponentType<Record<string, unknown>>;
  toc?: TableOfContents;
  load?: () => Promise<LoadedDocContent>;
};

export async function loadDocContent(page: { data: DocPageData }): Promise<LoadedDocContent> {
  if (typeof page.data.load === 'function') {
    return page.data.load();
  }

  if (!page.data.body || !page.data.toc) {
    throw new Error('Doc page is missing body or toc.');
  }

  return {
    body: page.data.body,
    toc: page.data.toc,
  };
}
