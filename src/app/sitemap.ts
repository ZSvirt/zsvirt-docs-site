import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { apiSource } from '@/lib/api-source';
import { documentAlternates } from '@/lib/document-links';
import { getDocRedirectTarget } from '@/lib/doc-redirects';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [source, apiSource].flatMap((collection) =>
    collection.getPages().filter((page) =>
      collection !== source || !getDocRedirectTarget(page.locale === 'en' ? 'en' : 'zh', page.slugs),
    ).map((page) => {
      const { canonical, languages } = documentAlternates(collection, page);
      return { url: canonical, alternates: { languages } };
    }),
  );
}
