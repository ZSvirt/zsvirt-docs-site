'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type UserGuideCategoryOption = {
  href: string;
  label: string;
};

type UserGuideCategorySwitcherProps = {
  activeHref: string;
  categories: UserGuideCategoryOption[];
  locale: 'zh' | 'en';
  rootHref: string;
};

export function UserGuideCategorySwitcher({
  activeHref,
  categories,
  locale,
  rootHref,
}: UserGuideCategorySwitcherProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeOptionRef = useRef<HTMLAnchorElement>(null);
  const activeCategory = categories.find((category) => category.href === activeHref);
  const currentLabel = activeCategory?.label ?? (locale === 'zh' ? '用户手册' : 'User Guide');
  const triggerLabel = locale === 'zh'
    ? `切换用户手册分类，当前：${currentLabel}`
    : `Switch User Guide category, current: ${currentLabel}`;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    activeOptionRef.current?.focus();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const openFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
  };

  return (
    <span
      ref={rootRef}
      className="user-guide-category-switcher"
      data-open={open || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="user-guide-category-switcher__trigger"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={openFromKeyboard}
      >
        <span className="user-guide-category-switcher__value">{currentLabel}</span>
        <svg
          className="user-guide-category-switcher__chevron"
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
        <span id={menuId} className="user-guide-category-switcher__menu" role="menu">
          <a
            className="user-guide-category-switcher__option user-guide-category-switcher__option--home"
            href={rootHref}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <svg
              className="user-guide-category-switcher__home-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6.5 3-4 5 4 5M3 8h10.5" />
            </svg>
            <span>{locale === 'zh' ? '全部用户手册' : 'All User Guide'}</span>
          </a>

          <span className="user-guide-category-switcher__separator" role="separator" />

          {categories.map((category) => {
            const active = category.href === activeHref;

            return (
              <a
                key={category.href}
                ref={active ? activeOptionRef : undefined}
                className="user-guide-category-switcher__option"
                href={category.href}
                role="menuitemradio"
                aria-checked={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <span>{category.label}</span>
                <CategoryCheckIcon visible={active} />
              </a>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function CategoryCheckIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      className="user-guide-category-switcher__check"
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
