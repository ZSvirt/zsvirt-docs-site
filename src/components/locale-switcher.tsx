'use client';

import { localizedDocsPath, type Locale } from '@/lib/i18n';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

type LocaleSwitcherProps = {
  locale: Locale;
  zhHref?: string;
  enHref?: string;
};

export function LocaleSwitcher({ locale, zhHref, enHref }: LocaleSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const zhOptionRef = useRef<HTMLButtonElement>(null);
  const enOptionRef = useRef<HTMLButtonElement>(null);
  const resolvedZhHref = zhHref ?? localizedDocsPath('zh', pathname);
  const resolvedEnHref = enHref ?? localizedDocsPath('en', pathname);
  const label = locale === 'zh' ? '切换语言' : 'Switch language';

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    (locale === 'zh' ? zhOptionRef : enOptionRef).current?.focus();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [locale, open]);

  const selectLocale = (nextLocale: Locale) => {
    setOpen(false);
    if (nextLocale === locale) return;
    router.push(nextLocale === 'zh' ? resolvedZhHref : resolvedEnHref);
  };

  return (
    <div
      ref={rootRef}
      className="doc-locale-switcher"
      data-open={open || undefined}
    >
      <button
        type="button"
        className="doc-locale-switcher__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          className="doc-locale-switcher__globe"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
        </svg>
        <span className="doc-locale-switcher__value">
          {locale === 'zh' ? '中文' : 'English'}
        </span>
        <svg
          className="doc-locale-switcher__chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m4.5 6 3.5 3.5L11.5 6" />
        </svg>
      </button>

      {open ? (
        <div id={menuId} className="doc-locale-switcher__menu" role="menu">
          <button
            ref={zhOptionRef}
            type="button"
            className="doc-locale-switcher__option"
            role="menuitemradio"
            aria-checked={locale === 'zh'}
            onClick={() => selectLocale('zh')}
          >
            <span>中文</span>
            <LocaleCheckIcon visible={locale === 'zh'} />
          </button>
          <button
            ref={enOptionRef}
            type="button"
            className="doc-locale-switcher__option"
            role="menuitemradio"
            aria-checked={locale === 'en'}
            onClick={() => selectLocale('en')}
          >
            <span>English</span>
            <LocaleCheckIcon visible={locale === 'en'} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LocaleCheckIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      className="doc-locale-switcher__check"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-visible={visible || undefined}
    >
      <path d="m3.5 8 3 3 6-6" />
    </svg>
  );
}
