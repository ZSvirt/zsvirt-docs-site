import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { APIPage } from '@/components/api-page';
import { DocImageZoom as ImageZoom } from '@/components/doc-image-zoom';
import { HistoricalNamingNote } from '@/components/historical-naming-note';
import { ProductFeaturesTable } from '@/components/product-features-table';
import type { MDXComponents } from 'mdx/types';
import type { ComponentPropsWithoutRef } from 'react';

type HtmlTableProps = ComponentPropsWithoutRef<'table'> & {
  class?: string;
};

type HtmlCellProps = ComponentPropsWithoutRef<'td'> & {
  class?: string;
  rowspan?: number | string;
  colspan?: number | string;
};

function Table({ class: htmlClass, className, ...props }: HtmlTableProps) {
  return <table {...props} className={className ?? htmlClass} />;
}

function normalizeCellProps({
  class: htmlClass,
  className,
  rowspan,
  colspan,
  rowSpan,
  colSpan,
  ...props
}: HtmlCellProps) {
  return {
    ...props,
    className: className ?? htmlClass,
    rowSpan: rowSpan ?? (rowspan == null ? undefined : Number(rowspan)),
    colSpan: colSpan ?? (colspan == null ? undefined : Number(colspan)),
  };
}

function Td(props: HtmlCellProps) {
  return <td {...normalizeCellProps(props)} />;
}

function Th(props: HtmlCellProps) {
  return <th {...normalizeCellProps(props)} />;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    table: Table,
    td: Td,
    th: Th,
    APIPage,
    Steps,
    Step,
    Accordions,
    Accordion,
    ImageZoom,
    HistoricalNamingNote,
    ProductFeaturesTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
