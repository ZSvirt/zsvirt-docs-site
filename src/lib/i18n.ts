import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'zh',
  languages: ['zh', 'en'],
  fallbackLanguage: null,
  hideLocale: 'default-locale',
  parser: 'dir',
});

export type Locale = (typeof i18n.languages)[number];

export function isLocale(value: string): value is Locale {
  return i18n.languages.includes(value as Locale);
}

export function localizedDocsPath(locale: Locale, pathname: string): string {
  if (locale === i18n.defaultLanguage) {
    return pathname.replace(/^\/en(?=\/docs(?:\/|$))/, '') || '/docs';
  }

  if (pathname.startsWith('/en/docs')) {
    return pathname;
  }

  if (pathname.startsWith('/docs')) {
    return `/en${pathname}`;
  }

  return '/en/docs';
}
