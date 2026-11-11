import { docs } from 'collections/server';
import { i18n } from '@/lib/i18n';
import { createGetUrl, loader } from 'fumadocs-core/source';

const PUBLIC_SECTION_SLUGS: Record<string, string> = {
  'install-zsvirt': 'install-zsphere',
  'terraform-for-zsvirt': 'terraform-for-zsphere',
};
const SOURCE_SECTION_SLUGS = Object.fromEntries(
  Object.entries(PUBLIC_SECTION_SLUGS).map(([sourceSlug, publicSlug]) => [
    publicSlug,
    sourceSlug,
  ]),
);

function replaceSectionSlug(
  slugs: string[] | undefined,
  sections: Record<string, string>,
): string[] {
  const [first, ...rest] = slugs ?? [];
  return first ? [sections[first] ?? first, ...rest] : [];
}

export function toPublicDocSlug(slugs: string[] | undefined): string[] {
  return replaceSectionSlug(slugs, PUBLIC_SECTION_SLUGS);
}

export function toSourceDocSlug(slugs: string[] | undefined): string[] {
  return replaceSectionSlug(slugs, SOURCE_SECTION_SLUGS);
}

const getUrl = createGetUrl('/docs', i18n);

export const source = loader({
  baseUrl: '/docs',
  i18n,
  url: (slugs, locale) => getUrl(toPublicDocSlug(slugs), locale),
  source: docs.toFumadocsSource(),
});
