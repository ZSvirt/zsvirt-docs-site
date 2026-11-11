import type { Locale } from '@/lib/i18n';

const DOC_REDIRECTS: Record<Locale, Record<string, string>> = {
  zh: {
    'vmware-migration-guide': '/docs/user-guide/operations/migration-service',
  },
  en: {
    'vmware-migration-guide': '/en/docs/user-guide/operations/migration-service',
  },
};

export function getDocRedirectTarget(locale: Locale, slug?: string[]): string | undefined {
  if (!slug?.length) return undefined;

  const key = slug.join('/');
  const exact = DOC_REDIRECTS[locale][key];
  if (exact) return exact;

  return undefined;
}
