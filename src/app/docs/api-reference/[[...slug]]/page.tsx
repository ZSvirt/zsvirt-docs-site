import { DocEditLink } from '@/components/doc-edit-link';
import { documentEditUrl, documentMetadata } from '@/lib/document-links';
import { getMDXComponents } from '@/components/mdx';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { apiSource } from '@/lib/api-source';
import {
  generateChineseApiStaticParams,
} from '@/lib/api-static-params';
import { loadDocContent } from '@/lib/load-doc-content';
import { docsLayoutOptions } from '@/lib/layout.shared';
import { getScopedPageTree } from '@/lib/scoped-tree';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type ApiDocsPageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

export default async function Page(props: ApiDocsPageProps) {
  const { slug } = await props.params;
  const page = apiSource.getPage(slug, 'zh');
  if (!page) notFound();

  const { body: MDX, toc } = await loadDocContent(page);
  const enPage = apiSource.getPage(slug, 'en');
  const enHref = enPage
    ? `/en/docs/api-reference/${slug?.join('/') ?? ''}`.replace(/\/$/, '')
    : '/en/docs/api-reference';

  return (
    <DocsLayout tree={getScopedPageTree('zh', slug, apiSource, '/docs/api-reference')} {...docsLayoutOptions('zh')}>
      <LocaleSwitcher locale="zh" enHref={enHref} />
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
        <DocEditLink locale="zh" href={documentEditUrl('api-reference', page)}>在 GitHub 上编辑此页</DocEditLink>
      </DocsPage>
    </DocsLayout>
  );
}

export function generateStaticParams() {
  return generateChineseApiStaticParams();
}

export async function generateMetadata(props: ApiDocsPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const page = apiSource.getPage(slug, 'zh');
  if (!page) notFound();

  return documentMetadata(apiSource, page);
}
