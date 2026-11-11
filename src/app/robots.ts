import type { MetadataRoute } from 'next';
import { docsOrigin } from '@/lib/document-links';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/_doc-search/', '/docs/search-index.json', '/en/docs/search-index.json'] },
    sitemap: `${docsOrigin}/sitemap.xml`,
  };
}
