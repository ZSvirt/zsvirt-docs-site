import 'server-only';

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createElement } from 'react';
import {
  UserGuideCategorySwitcher,
  type UserGuideCategoryOption,
} from '@/components/user-guide-category-switcher';
import type { Locale } from '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';
import type * as FumaPageTree from 'fumadocs-core/page-tree';

type DocSource = {
  getPageTree: (locale?: string) => FumaPageTree.Root;
};

type TreeNode = {
  type?: string;
  name?: unknown;
  url?: string;
  index?: TreeNode;
  children?: TreeNode[];
  [key: string]: unknown;
};

const apiMethodCache = new Map<Locale, Map<string, string>>();


function getApiMethodMap(locale: Locale, basePath: string): Map<string, string> {
  const cached = apiMethodCache.get(locale);
  if (cached) return cached;

  const methods = new Map<string, string>();
  const contentRoot = join(process.cwd(), 'content', 'api-reference', locale);

  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;

      const source = readFileSync(absolutePath, 'utf8');
      const method = source.match(/<APIPage\b[^>]*\bmethod=["']([A-Za-z]+)["']/)?.[1]?.toUpperCase();
      if (!method) continue;

      const path = relative(contentRoot, absolutePath)
        .split(sep)
        .join('/')
        .replace(/\.mdx$/, '')
        .replace(/\/index$/, '');
      methods.set(path ? `${basePath}/${path}` : basePath, method);
    }
  }

  visit(contentRoot);
  apiMethodCache.set(locale, methods);
  return methods;
}

function withApiMethodLabels(node: TreeNode, methods: Map<string, string>): TreeNode {
  const next: TreeNode = { ...node };
  const method = typeof next.url === 'string' ? methods.get(next.url) : undefined;

  if (method && typeof next.name === 'string') {
    next.name = createElement(
      'span',
      { className: 'api-sidebar-link-label' },
      createElement(
        'span',
        { className: `api-sidebar-method api-sidebar-method-${method.toLowerCase()}` },
        method,
      ),
      createElement('span', { className: 'api-sidebar-link-title' }, next.name),
    );
  }

  if (next.index) next.index = withApiMethodLabels(next.index, methods);
  if (Array.isArray(next.children)) {
    next.children = next.children.map((child) => withApiMethodLabels(child, methods));
  }

  return next;
}

function localeDocsRoot(locale: Locale, basePath = '/docs'): string {
  return locale === i18n.defaultLanguage ? basePath : `/${locale}${basePath}`;
}

function withLocalePrefix(locale: Locale, url: string, basePath = '/docs'): string {
  const localizedBase = localeDocsRoot(locale, basePath);
  if (locale === i18n.defaultLanguage || url.startsWith(`/${locale}/`)) {
    return url;
  }

  if (url === basePath) return localizedBase;
  if (url.startsWith(`${basePath}/`)) return `/${locale}${url}`;

  return url;
}

function getNodeSegment(locale: Locale, node: TreeNode, basePath = '/docs'): string | undefined {
  return getNodeSegments(locale, node, basePath)?.[0];
}

function getNodeSegments(locale: Locale, node: TreeNode, basePath = '/docs'): string[] | undefined {
  const url =
    typeof node.url === 'string'
      ? node.url
      : typeof node.index?.url === 'string'
        ? node.index.url
        : undefined;
  if (!url) return undefined;

  for (const root of [localeDocsRoot(locale, basePath), basePath]) {
    if (url === root) return undefined;
    if (url.startsWith(`${root}/`)) {
      return url.slice(root.length + 1).split('/');
    }
  }

  return undefined;
}

function containsSegment(locale: Locale, node: TreeNode, segment: string, basePath = '/docs'): boolean {
  if (getNodeSegment(locale, node, basePath) === segment) {
    return true;
  }

  if (node.index && containsSegment(locale, node.index, segment, basePath)) {
    return true;
  }

  return node.children?.some((child) => containsSegment(locale, child, segment, basePath)) ?? false;
}

function containsUrl(node: TreeNode, url: string): boolean {
  if (node.url === url || node.index?.url === url) return true;
  if (node.index && containsUrl(node.index, url)) return true;
  return node.children?.some((child) => containsUrl(child, url)) ?? false;
}

function localizeTree(locale: Locale, node: TreeNode, basePath = '/docs'): TreeNode {
  const next: TreeNode = { ...node };

  if (typeof next.url === 'string') {
    next.url = withLocalePrefix(locale, next.url, basePath);
  }

  if (next.index) {
    next.index = localizeTree(locale, next.index, basePath);
  }

  if (Array.isArray(next.children)) {
    next.children = next.children.map((child) => localizeTree(locale, child, basePath));
  }

  return next;
}

function promoteScopedChildren(node: TreeNode): TreeNode[] {
  const children = [...(node.children ?? [])];

  if (node.index) {
    children.unshift(node.index);
  }

  return children.length > 0 ? children : [node];
}

function getUserGuideCategoryHref(
  locale: Locale,
  category: TreeNode,
  basePath = '/docs',
): string | undefined {
  const candidates = [category, category.index, ...(category.children ?? [])];
  let fallbackHref: string | undefined;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const segments = getNodeSegments(locale, candidate, basePath);
    const url = typeof candidate.url === 'string'
      ? candidate.url
      : candidate.index?.url;

    if (!segments || segments.length < 2 || !url) continue;
    const localizedUrl = withLocalePrefix(locale, url, basePath);
    if (segments.length === 2) return localizedUrl;
    fallbackHref ??= localizedUrl;
  }

  return fallbackHref;
}

function getUserGuideCategoryOptions(
  locale: Locale,
  userGuide: TreeNode,
  basePath = '/docs',
): UserGuideCategoryOption[] {
  return (userGuide.children ?? []).flatMap((category) => {
    const href = getUserGuideCategoryHref(locale, category, basePath);
    if (!href || typeof category.name !== 'string') return [];

    return [{ href, label: category.name }];
  });
}

function getUserGuideCategoryNodes(
  locale: Locale,
  category: TreeNode,
  categories: UserGuideCategoryOption[],
): TreeNode[] {
  const overviewName = locale === 'zh' ? '概述' : 'Overview';
  const activeHref = getUserGuideCategoryHref(locale, category);
  const children = (category.children ?? []).map((child) => {
    const segments = getNodeSegments(locale, child);

    return child.type === 'page' && segments?.length === 2
      ? { ...child, name: overviewName }
      : child;
  });

  if (category.index) {
    children.unshift({
      ...category.index,
      name: overviewName,
    });
  }

  return [
    {
      type: 'separator',
      name: createElement(
        UserGuideCategorySwitcher,
        {
          activeHref: activeHref ?? `${localeDocsRoot(locale)}/user-guide`,
          categories,
          locale,
          rootHref: `${localeDocsRoot(locale)}/user-guide`,
        },
      ),
    },
    ...(children.length > 0 ? children : [category]),
  ];
}

export function getScopedPageTree(
  locale: Locale,
  slug?: string[],
  docSource: DocSource = source,
  basePath = '/docs',
): FumaPageTree.Root {
  const sourceTree = docSource.getPageTree(locale) as FumaPageTree.Root;
  const tree = basePath === '/docs/api-reference'
    ? withApiMethodLabels(
        sourceTree as TreeNode,
        getApiMethodMap(locale, basePath),
      ) as FumaPageTree.Root
    : sourceTree;
  if (basePath === '/docs/api-reference') {
    return localizeTree(locale, tree as TreeNode, basePath) as FumaPageTree.Root;
  }

  const scope = slug?.[0];

  if (!scope) {
    return localizeTree(locale, tree as TreeNode, basePath) as FumaPageTree.Root;
  }

  const scoped = tree.children.find((child) =>
    containsSegment(locale, child as TreeNode, scope, basePath),
  );
  if (!scoped) {
    return localizeTree(locale, tree as TreeNode, basePath) as FumaPageTree.Root;
  }

  const localizedScope = localizeTree(locale, scoped as TreeNode, basePath);

  if (basePath === '/docs' && scope === 'user-guide' && slug?.[1]) {
    const currentUrl = `${basePath}/${slug.join('/')}`;
    const localizedCurrentUrl = withLocalePrefix(locale, currentUrl, basePath);
    const category = (scoped as TreeNode).children?.find(
      (child) =>
        containsUrl(child, currentUrl) ||
        containsUrl(child, localizedCurrentUrl),
    );

    if (category) {
      const localizedCategory = localizeTree(locale, category, basePath);
      const categories = getUserGuideCategoryOptions(locale, scoped as TreeNode, basePath);

      return {
        ...tree,
        children: getUserGuideCategoryNodes(locale, localizedCategory, categories),
      } as FumaPageTree.Root;
    }
  }

  return {
    ...tree,
    children: promoteScopedChildren(localizedScope),
  } as FumaPageTree.Root;
}
