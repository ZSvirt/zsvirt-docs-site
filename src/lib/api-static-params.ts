import { i18n } from '@/lib/i18n';
import { apiSource } from '@/lib/api-source';

function normalizeSlug(slug: string[] | undefined): string[] {
  return slug ?? [];
}

function slugKey(slug: string[]): string {
  return slug.join('/');
}

export function generateChineseApiStaticParams(): { slug: string[] }[] {
  const seen = new Set<string>();
  const params: { slug: string[] }[] = [];

  for (const param of apiSource.generateParams()) {
    if (param.lang !== i18n.defaultLanguage) continue;

    const slug = normalizeSlug(param.slug);
    const key = slugKey(slug);
    if (seen.has(key)) continue;

    seen.add(key);
    params.push({ slug });
  }

  if (!seen.has('')) {
    params.unshift({ slug: [] });
  }

  return params;
}

export function generateLocalizedApiStaticParams(): { lang: string; slug: string[] }[] {
  const seen = new Set<string>();
  const params: { lang: string; slug: string[] }[] = [];

  for (const param of apiSource.generateParams()) {
    if (param.lang === i18n.defaultLanguage) continue;

    const slug = normalizeSlug(param.slug);
    const key = `${param.lang}:${slugKey(slug)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    params.push({ lang: param.lang, slug });
  }

  return params;
}
