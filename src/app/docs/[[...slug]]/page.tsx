import { DocEditLink } from '@/components/doc-edit-link';
import { documentEditUrl, documentMetadata } from '@/lib/document-links';
import { getMDXComponents } from '@/components/mdx';
import { DocRedirect } from '@/components/doc-redirect';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getDocRedirectTarget } from '@/lib/doc-redirects';
import { docsLayoutOptions } from '@/lib/layout.shared';
import { generateChineseDocStaticParams } from '@/lib/docs-static-params';
import { getScopedPageTree } from '@/lib/scoped-tree';
import { source, toSourceDocSlug } from '@/lib/source';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type DocsPageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

export default async function Page(props: DocsPageProps) {
  const params = await props.params;
  const { slug } = params;
  const sourceSlug = toSourceDocSlug(slug);
  const page = source.getPage(sourceSlug, 'zh');

  const redirectTarget = getDocRedirectTarget('zh', slug);
  if (redirectTarget) {
    const enPage = source.getPage(sourceSlug, 'en');
    const enHref = enPage ? `/en/docs/${slug?.join('/') ?? ''}`.replace(/\/$/, '') : '/en/docs';

    return (
      <DocsLayout tree={getScopedPageTree('zh', slug)} {...docsLayoutOptions('zh')}>
        <LocaleSwitcher locale="zh" enHref={enHref} />
        <DocRedirect href={redirectTarget} />
      </DocsLayout>
    );
  }

  if (!page) notFound();

  const MDX = page.data.body;
  const enPage = source.getPage(sourceSlug, 'en');
  const enHref = enPage ? `/en/docs/${slug?.join('/') ?? ''}`.replace(/\/$/, '') : '/en/docs';

  return (
    <DocsLayout tree={getScopedPageTree('zh', slug)} {...docsLayoutOptions('zh')}>
      <LocaleSwitcher locale="zh" enHref={enHref} />
      <DocsPage
        className={slug?.length ? undefined : 'docs-index-page'}
        toc={page.data.toc}
        full={slug?.length ? page.data.full : true}
        tableOfContent={{ enabled: Boolean(slug?.length) }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
        <DocEditLink locale="zh" href={documentEditUrl('docs', page)}>在 GitHub 上编辑此页</DocEditLink>
      </DocsPage>
    </DocsLayout>
  );
}

export function generateStaticParams() {
  return generateChineseDocStaticParams();
}

export async function generateMetadata(props: DocsPageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(toSourceDocSlug(params.slug), 'zh');
  if (!page) {
    if (getDocRedirectTarget('zh', params.slug)) {
      return { title: 'Redirecting…' };
    }
    notFound();
  }

  return documentMetadata(source, page);
}
