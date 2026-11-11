import { documentEditUrl, documentMetadata } from '@/lib/document-links';
import { getMDXComponents } from '@/components/mdx';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { apiSource } from '@/lib/api-source';
import { generateLocalizedApiStaticParams } from '@/lib/api-static-params';
import { isLocale } from '@/lib/i18n';
import { loadDocContent } from '@/lib/load-doc-content';
import { docsLayoutOptions } from '@/lib/layout.shared';
import { getScopedPageTree } from '@/lib/scoped-tree';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type LocalizedApiDocsPageProps = {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
};

export default async function Page(props: LocalizedApiDocsPageProps) {
  const { lang, slug } = await props.params;
  if (!isLocale(lang) || lang === 'zh') notFound();

  const page = apiSource.getPage(slug, lang);
  if (!page) notFound();

  const { body: MDX, toc } = await loadDocContent(page);
  const zhPage = apiSource.getPage(slug, 'zh');
  const zhHref = zhPage
    ? `/docs/api-reference/${slug?.join('/') ?? ''}`.replace(/\/$/, '')
    : '/docs/api-reference';

  return (
    <DocsLayout tree={getScopedPageTree(lang, slug, apiSource, '/docs/api-reference')} {...docsLayoutOptions(lang)}>
      <LocaleSwitcher locale={lang} zhHref={zhHref} />
      <DocsPage
        className="api-docs-page"
        toc={toc}
        full
        tableOfContent={{ enabled: false }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(apiSource, page),
            })}
          />
        </DocsBody>
        <a href={documentEditUrl('api-reference', page)}>{'Edit this page on GitHub'}</a>
      </DocsPage>
    </DocsLayout>
  );
}

export function generateStaticParams() {
  return generateLocalizedApiStaticParams();
}

export async function generateMetadata(props: LocalizedApiDocsPageProps): Promise<Metadata> {
  const { lang, slug } = await props.params;
  if (!isLocale(lang) || lang === 'zh') notFound();

  const page = apiSource.getPage(slug, lang);
  if (!page) notFound();

  return documentMetadata(apiSource, page);
}
