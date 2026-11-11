import { productFeaturesTableHtml } from '@/components/product-features-table.generated';

export function ProductFeaturesTable() {
  return (
    <div
      className="doc-feature-table-wrap not-prose"
      dangerouslySetInnerHTML={{ __html: productFeaturesTableHtml }}
    />
  );
}
