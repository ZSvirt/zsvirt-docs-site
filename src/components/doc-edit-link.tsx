import type { ReactNode } from 'react';

export function DocEditLink({ href, children, locale }: { href: string; children: ReactNode; locale: 'zh' | 'en' }) {
  return (
    <div className="doc-edit-footer">
      <a className="doc-edit-link" href={href} target="_blank" rel="noopener noreferrer">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="m16 3 5 5M10 14l-1 4 4-1L22 8a2.12 2.12 0 0 0-3-3Z" />
        </svg>
        <span>{children}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
        </svg>
        <span className="sr-only">
          {locale === 'zh' ? '（在新标签页打开）' : ' (opens in a new tab)'}
        </span>
      </a>
    </div>
  );
}
