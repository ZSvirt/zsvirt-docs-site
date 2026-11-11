import { Callout } from 'fumadocs-ui/components/callout';

type HistoricalNamingNoteProps = {
  locale?: 'zh' | 'en';
};

export function HistoricalNamingNote({ locale = 'zh' }: HistoricalNamingNoteProps) {
  if (locale === 'en') {
    return (
      <Callout type="info">
        <strong>ZSvirt</strong> was open-sourced from the <strong>ZStack ZSphere</strong> commercial
        project and has since developed independently. Some code, configuration, and documentation
        still retain historical <strong>ZStack</strong>/<strong>ZSphere</strong> names (such as
        environment variables, configuration items, dependencies, paths, and commands). These names
        are for compatibility only and do not affect the normal use of <strong>ZSvirt</strong>.
      </Callout>
    );
  }

  return (
    <Callout type="info">
      <strong>ZSvirt</strong> 由 <strong>ZStack ZSphere</strong> 商业化项目开源并独立发展而来，部分代码、配置和文档仍保留{' '}
      <strong>ZStack</strong>/<strong>ZSphere</strong>
      {' '}的历史命名（如环境变量、配置项、依赖、路径、命令等）。这些命名仅用于兼容，不影响{' '}
      <strong>ZSvirt</strong> 正常使用。
    </Callout>
  );
}
