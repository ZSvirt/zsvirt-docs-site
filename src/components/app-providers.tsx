'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { translations } from '@/lib/ui-translations';
import { DocsSearchDialog } from '@/components/docs-search-dialog';
import { usePathname } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';
import { useMemo } from 'react';

type ThemeOptions = NonNullable<ComponentProps<typeof RootProvider>['theme']>;

function localeFromPathname(pathname: string): 'zh' | 'en' {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh';
}

export function AppProviders({
  children,
  theme,
}: {
  children: ReactNode;
  theme?: ThemeOptions;
}) {
  const pathname = usePathname() ?? '/';
  const locale = localeFromPathname(pathname);
  const i18n = useMemo(() => i18nProvider(translations, locale), [locale]);

  return (
    <RootProvider theme={theme} i18n={i18n} search={{ SearchDialog: DocsSearchDialog }}>
      {children}
    </RootProvider>
  );
}
