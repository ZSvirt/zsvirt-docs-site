import type { Locale } from '@/lib/i18n';

const defaultMainSiteBaseUrl = 'https://zsvirt.io';
const configuredMainSiteBaseUrl = process.env.NEXT_PUBLIC_MAIN_SITE_BASE_URL?.trim() || defaultMainSiteBaseUrl;

function validateMainSiteBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_MAIN_SITE_BASE_URL must be an absolute http(s) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_MAIN_SITE_BASE_URL must use http or https.');
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_MAIN_SITE_BASE_URL must contain only an origin, without a path, query, or hash.');
  }

  return url.origin;
}

const mainSiteBaseUrl = validateMainSiteBaseUrl(configuredMainSiteBaseUrl);

export function mainSiteUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${mainSiteBaseUrl}${normalizedPath}`;
}

export function localizedMainSiteUrl(locale: Locale): string {
  return mainSiteUrl(locale === 'zh' ? '/zh' : '/');
}
