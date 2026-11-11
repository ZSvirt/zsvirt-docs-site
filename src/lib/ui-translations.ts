import { uiTranslations } from 'fumadocs-ui/i18n';
import { i18n } from '@/lib/i18n';

export const searchMessages = {
  en: {
    inputLabel: 'Search documentation',
    loading: 'Searching documentation…',
    error: 'Search is unavailable. Please try again.',
    retry: 'Retry',
  },
  zh: {
    inputLabel: '搜索文档',
    loading: '正在搜索文档…',
    error: '搜索暂时不可用，请重试。',
    retry: '重试',
  },
} as const;

/** Fumadocs UI chrome strings (TOC, pagination, search, etc.). */
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: {
      displayName: 'English',
    },
    zh: {
      displayName: '中文',
      'On this page(table of contents)': '本页目录',
      'No Headings(table of contents)': '暂无标题',
      'Previous Page(pagination)': '上一页',
      'Next Page(pagination)': '下一页',
      'Search(search trigger)': '搜索',
      'Search(search dialog)': '搜索文档',
      'No results found(search dialog)': '未找到结果',
      'Open Search(search trigger)(aria-label)': '打开搜索',
      'Close Search(search dialog)(aria-label)': '关闭搜索',
      'Open Sidebar(sidebar)(aria-label)': '打开侧边栏',
      'Collapse Sidebar(sidebar)(aria-label)': '收起侧边栏',
      'Choose a language(language switcher)': '选择语言',
      'Choose a language(language switcher)(aria-label)': '选择语言',
      'Last updated on(page footer)': '最后更新于',
      'Edit on GitHub(edit page)': '在 GitHub 上编辑',
      'Table of Contents(inline table of contents)': '目录',
      'Copy Text(code block)(aria-label)': '复制文本',
      'Copied Text(code block)(aria-label)': '已复制',
      'Toggle Theme(theme switcher)(aria-label)': '切换主题',
      'Light(theme switcher)(aria-label)': '浅色',
      'Dark(theme switcher)(aria-label)': '深色',
      'System(theme switcher)(aria-label)': '跟随系统',
      'Page Not Found(404 page)': '页面未找到',
      'Back to Home(404 page)': '返回首页',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)':
        '您访问的页面可能已被删除、更名或暂时不可用。',
    },
  });
