import { i18n } from '@/lib/i18n';
import { source, toPublicDocSlug } from '@/lib/source';

function normalizeSlug(slug: string[] | undefined): string[] {
  return slug ?? [];
}

function slugKey(slug: string[]): string {
  return slug.join('/');
}

export function generateChineseDocStaticParams(): { slug: string[] }[] {
  const seen = new Set<string>();
  const params: { slug: string[] }[] = [];

  for (const param of source.generateParams()) {
    if (param.lang !== i18n.defaultLanguage) continue;

    const slug = toPublicDocSlug(normalizeSlug(param.slug));
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

export function generateLocalizedDocStaticParams(): { lang: string; slug: string[] }[] {
  const seen = new Set<string>();
  const params: { lang: string; slug: string[] }[] = [];

  for (const param of source.generateParams()) {
    if (param.lang === i18n.defaultLanguage) continue;

    const slug = toPublicDocSlug(normalizeSlug(param.slug));
    const key = `${param.lang}:${slugKey(slug)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    params.push({ lang: param.lang, slug });

  }

  return params;
}
