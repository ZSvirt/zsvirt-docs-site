'use client';

import type { ComponentProps, MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDocsLayout } from 'fumadocs-ui/layouts/docs';
import { isLayoutTabActive } from 'fumadocs-ui/layouts/shared';
import { FullSearchTrigger, SearchTrigger } from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { localizedMainSiteUrl } from '@/lib/main-site-url';
import {
  ThemeSwitch as FumadocsThemeSwitch,
  type ThemeSwitchProps,
} from 'fumadocs-ui/layouts/shared/slots/theme-switch';

type HeaderOnlyThemeSwitchProps = ThemeSwitchProps & {
  'data-docs-header-theme'?: boolean;
};

export function HeaderOnlyThemeSwitch({
  'data-docs-header-theme': isHeader,
  ...props
}: HeaderOnlyThemeSwitchProps) {
  if (!isHeader) return null;

  return <FumadocsThemeSwitch {...props} />;
}

export function DocsHeader({ className, ...props }: ComponentProps<'header'>) {
  const pathname = usePathname();
  const {
    slots,
    props: { tabs },
  } = useDocsLayout();
  const NavTitle = slots.navTitle;
  const ThemeSwitch = slots.themeSwitch;
  const SidebarTrigger = slots.sidebar?.trigger;
  const activeTab = tabs.findLast((tab) => isLayoutTabActive(tab, pathname));
  const isEnglish = pathname.startsWith('/en/');
  const mainSiteHref = localizedMainSiteUrl(isEnglish ? 'en' : 'zh');

  const openMainSite = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    window.location.assign(mainSiteHref);
  };

  return (
    <header
      id="nd-subnav"
      {...props}
      className={['zsphere-docs-header', className].filter(Boolean).join(' ')}
    >
      <div className="zsphere-docs-header-primary zsphere-docs-header-row">
        {NavTitle ? (
          <NavTitle
            className="zsphere-docs-brand"
            aria-label="ZSvirt"
            data-docs-main-site-link
            onClick={openMainSite}
          />
        ) : null}

        <div className="zsphere-docs-actions">
          <FullSearchTrigger className="zsphere-docs-search-desktop" />
          <SearchTrigger className="zsphere-docs-search-mobile" />
          {ThemeSwitch ? (
            <ThemeSwitch className="zsphere-docs-theme" data-docs-header-theme />
          ) : null}
        </div>
      </div>

      <div className="zsphere-docs-header-secondary zsphere-docs-desktop-row">
        <nav
          className="zsphere-docs-tabs"
          aria-label={isEnglish ? 'Documentation' : '文档主导航'}
        >
          {tabs.map((tab) => {
            const active = tab === activeTab;
            const tabClassName = tab.props?.className;

            return (
              <Link
                {...tab.props}
                key={tab.url}
                href={tab.url}
                className={['zsphere-docs-tab', tabClassName].filter(Boolean).join(' ')}
                data-active={active}
                aria-current={active ? 'page' : undefined}
              >
                {tab.icon ? (
                  <span className="zsphere-docs-tab-icon">{tab.icon}</span>
                ) : null}
                {tab.title}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="zsphere-docs-header-secondary zsphere-docs-mobile-row">
        {SidebarTrigger ? (
          <SidebarTrigger
            className="zsphere-docs-mobile-trigger"
            aria-label={isEnglish ? 'Open documentation navigation' : '打开文档导航'}
          >
            <svg
              className="zsphere-docs-mobile-trigger-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <span className="zsphere-docs-mobile-trigger-label">
              {activeTab?.title ?? (isEnglish ? 'Documentation' : '文档导航')}
            </span>
          </SidebarTrigger>
        ) : null}
      </div>
    </header>
  );
}
