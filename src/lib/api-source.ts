import { apiReference } from 'collections/server';
import { i18n } from '@/lib/i18n';
import { stripApiTitleSuffix } from '@/lib/strip-api-title';
import { loader } from 'fumadocs-core/source';

export const apiSource = loader({
  baseUrl: '/docs/api-reference',
  i18n,
  source: apiReference.toFumadocsSource(),
  plugins: [
    {
      transformStorage({ storage }) {
        for (const file of storage.getFiles()) {
          const item = storage.read(file);
          if (!item?.data || typeof item.data.title !== 'string') {
            continue;
          }

          const cleaned = stripApiTitleSuffix(item.data.title);
          if (cleaned === item.data.title) {
            continue;
          }

          item.data.title = cleaned;
          storage.write(file, item);
        }
      },
    },
  ],
});
