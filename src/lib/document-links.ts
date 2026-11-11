export const docsOrigin = 'https://docs.zsvirt.io';
const editBase = 'https://github.com/ZSvirt/zsvirt-docs-site/edit/main/content';

export type DocumentPage = {
  path: string;
  url: string;
  slugs: string[];
  data: { title?: string; description?: string };
};

type DocumentSource = {
  getPage: (slugs: string[] | undefined, locale: string) => DocumentPage | undefined;
};

export function documentEditUrl(collection: 'docs' | 'api-reference', page: Pick<DocumentPage, 'path'>): string {
  // Fumadocs retains the original collection-relative path, including locale and index.mdx.
  const segments = page.path.split('/');
  if (!['zh', 'en'].includes(segments[0]) || segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid document source path: ${page.path}`);
  }
  return `${editBase}/${collection}/${segments.map(encodeURIComponent).join('/')}`;
}

export function documentAlternates(source: DocumentSource, page: DocumentPage) {
  const languages: Record<string, string> = {};
  for (const [locale, language] of [['zh', 'zh-CN'], ['en', 'en']] as const) {
    const translation = source.getPage(page.slugs, locale);
    if (translation) languages[language] = new URL(translation.url, docsOrigin).href;
  }
  return { canonical: new URL(page.url, docsOrigin).href, languages };
}

export function documentMetadata(source: DocumentSource, page: DocumentPage) {
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: documentAlternates(source, page),
  };
}
