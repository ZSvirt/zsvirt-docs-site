import { documentEditUrl, documentMetadata } from '@/lib/document-links';
import { getMDXComponents } from '@/components/mdx';
import { DocRedirect } from '@/components/doc-redirect';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getDocRedirectTarget } from '@/lib/doc-redirects';
import { isLocale } from '@/lib/i18n';
import { docsLayoutOptions } from '@/lib/layout.shared';
import { generateLocalizedDocStaticParams } from '@/lib/docs-static-params';
import { getScopedPageTree } from '@/lib/scoped-tree';
import { source, toSourceDocSlug } from '@/lib/source';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type LocalizedDocsPageProps = {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
};

export default async function Page(props: LocalizedDocsPageProps) {
  const { lang, slug } = await props.params;
  if (!isLocale(lang) || lang === 'zh') notFound();

  const sourceSlug = toSourceDocSlug(slug);
  const page = source.getPage(sourceSlug, lang);

  const redirectTarget = getDocRedirectTarget(lang, slug);
  if (redirectTarget) {
    const zhPage = source.getPage(sourceSlug, 'zh');
    const zhHref = zhPage ? `/docs/${slug?.join('/') ?? ''}`.replace(/\/$/, '') : '/docs';

    return (
      <DocsLayout tree={getScopedPageTree(lang, slug)} {...docsLayoutOptions(lang)}>
        <LocaleSwitcher locale={lang} zhHref={zhHref} />
        <DocRedirect href={redirectTarget} />
      </DocsLayout>
    );
  }

  if (!page) notFound();

  const MDX = page.data.body;
  const zhPage = source.getPage(sourceSlug, 'zh');
  const zhHref = zhPage ? `/docs/${slug?.join('/') ?? ''}`.replace(/\/$/, '') : '/docs';

  return (
    <DocsLayout tree={getScopedPageTree(lang, slug)} {...docsLayoutOptions(lang)}>
      <LocaleSwitcher locale={lang} zhHref={zhHref} />
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
        <a href={documentEditUrl('docs', page)}>{'Edit this page on GitHub'}</a>
      </DocsPage>
    </DocsLayout>
  );
}

export function generateStaticParams() {
  return generateLocalizedDocStaticParams();
}

export async function generateMetadata(props: LocalizedDocsPageProps): Promise<Metadata> {
  const { lang, slug } = await props.params;
  if (!isLocale(lang) || lang === 'zh') notFound();

  const page = source.getPage(toSourceDocSlug(slug), lang);
  if (!page) {
    if (getDocRedirectTarget(lang, slug)) {
      return { title: 'Redirecting…' };
    }
    notFound();
  }

  return documentMetadata(source, page);
}
