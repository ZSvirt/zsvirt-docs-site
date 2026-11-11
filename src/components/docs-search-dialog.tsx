'use client';

import type { SortedResult } from 'fumadocs-core/search';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search';
import type { SharedProps } from 'fumadocs-ui/contexts/search';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { searchMessages } from '@/lib/ui-translations';

type SearchState = {
  key: string;
  items?: SortedResult[];
  error?: Error;
};

export function DocsSearchDialog({ open, onOpenChange }: SharedProps) {
  const pathname = usePathname() ?? '/';
  const locale = pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh';
  const messages = searchMessages[locale];
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState | null>(null);
  const query = search.trim();
  const requestKey = `${locale}\0${query}\0${retry}`;
  const current = state?.key === requestKey ? state : null;
  const loading = open && query.length > 0 && !current;

  useEffect(() => {
    if (open) return;
    setSearch('');
    setRetry(0);
    setState(null);
  }, [open]);

  useEffect(() => {
    if (!open || !query) return;

    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const url = new URL('/api/search', window.location.origin);
      url.searchParams.set('query', query);
      url.searchParams.set('locale', locale);
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Search request failed (${response.status})`);
        const items: unknown = await response.json();
        if (!Array.isArray(items)) throw new Error('Search response is not an array');
        if (!cancelled) {
          setState({ key: requestKey, items: items as SortedResult[] });
        }
      } catch (error) {
        if (cancelled) return;
        const failure = controller.signal.aborted
          ? new Error('Search request timed out')
          : error instanceof Error ? error : new Error(String(error));
        console.error('[zsvirt:docs-search]', failure);
        setState({ key: requestKey, error: failure });
      } finally {
        window.clearTimeout(timeout);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [locale, open, query, requestKey]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearch('');
      setRetry(0);
      setState(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <SearchDialog
      open={open}
      onOpenChange={handleOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={loading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput aria-label={messages.inputLabel} maxLength={200} autoFocus />
          <SearchDialogClose />
        </SearchDialogHeader>
        {query && loading ? (
          <p className="zsphere-docs-search-status" role="status">
            {messages.loading}
          </p>
        ) : null}
        {query && current?.error ? (
          <div className="zsphere-docs-search-status" role="alert">
            <span>{messages.error}</span>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              {messages.retry}
            </button>
          </div>
        ) : null}
        <SearchDialogList className="zsphere-docs-search-results" items={query ? current?.items ?? null : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
