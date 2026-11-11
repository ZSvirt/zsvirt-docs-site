import { isLocale } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

type ScopedLocalizedDocsLayoutProps = {
  params: Promise<{
    lang: string;
  }>;
  children: ReactNode;
};

export default async function Layout({ params, children }: ScopedLocalizedDocsLayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang) || lang === 'zh') notFound();

  return children;
}
