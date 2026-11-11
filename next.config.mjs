import { createMDX } from 'fumadocs-mdx/next';
import { loopbackHost, loopbackOrigin, tcpPort } from './scripts/local-launcher.mjs';

const withMDX = createMDX();

const isStaticExport = process.env.NODE_ENV === 'production';
const searchOrigin = loopbackOrigin(
  loopbackHost(process.env.DOC_SEARCH_HOST, 'DOC_SEARCH_HOST'),
  tcpPort(process.env.DOC_SEARCH_PORT, 'DOC_SEARCH_PORT', 4323),
);

/** @type {import('next').NextConfig} */
const config = {
  ...(isStaticExport ? { output: 'export' } : {}),
  ...(!isStaticExport ? {
    async rewrites() {
      return [{ source: '/api/search', destination: `${searchOrigin}/api/search` }];
    },
  } : {}),
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
