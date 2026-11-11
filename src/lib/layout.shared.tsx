import type { BaseLayoutProps, LayoutTab } from 'fumadocs-ui/layouts/shared';
import type { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { DocsHeader, HeaderOnlyThemeSwitch } from '@/components/docs-header';
import type { Locale } from '@/lib/i18n';
import { localizedMainSiteUrl } from '@/lib/main-site-url';

export type DocsLayoutOptions = Omit<BaseLayoutProps, 'slots'> &
  Pick<DocsLayoutProps, 'tabs' | 'tabMode' | 'slots'>;

export { translations } from '@/lib/ui-translations';

function QuickStartTabLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 text-fd-primary"
        aria-hidden="true"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
      {children}
    </span>
  );
}

function getDocNavTabs(locale: Locale): LayoutTab[] {
  if (locale === 'zh') {
    return [
      {
        title: <QuickStartTabLabel>快速开始</QuickStartTabLabel>,
        url: '/docs/quick-start',
      },
      { title: '用户手册', url: '/docs/user-guide' },
      { title: '安装部署', url: '/docs/install-zsphere' },
      { title: 'Terraform 管理', url: '/docs/terraform-for-zsphere' },
      { title: 'API 文档', url: '/docs/api-reference' },
      { title: 'FAQ', url: '/docs/faq' },
    ];
  }

  return [
    {
      title: <QuickStartTabLabel>Quick Start</QuickStartTabLabel>,
      url: '/en/docs/quick-start',
    },
    { title: 'User Guide', url: '/en/docs/user-guide' },
    { title: 'Installation', url: '/en/docs/install-zsphere' },
    { title: 'Terraform', url: '/en/docs/terraform-for-zsphere' },
    { title: 'API Docs', url: '/en/docs/api-reference' },
    { title: 'FAQ', url: '/en/docs/faq' },
  ];
}

export function baseOptions(locale: Locale = 'zh'): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="doc-nav-brand" aria-label="ZSvirt">
          <img
            className="doc-nav-brand-logo"
            src="/brand/logo-horizen.svg"
            alt="ZSvirt"
            width={143}
            height={40}
          />
        </span>
      ),
      url: localizedMainSiteUrl(locale),
    },
    githubUrl: 'https://github.com/ZSvirt/zsvirt-docs-site',
  };
}

export function docsLayoutOptions(locale: Locale = 'zh'): DocsLayoutOptions {
  return {
    ...baseOptions(locale),
    tabs: getDocNavTabs(locale),
    tabMode: 'auto',
    slots: {
      header: DocsHeader,
      themeSwitch: HeaderOnlyThemeSwitch,
    },
  };
}
