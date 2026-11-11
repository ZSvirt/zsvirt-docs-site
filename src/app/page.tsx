import DocsPage, { generateMetadata as docsMetadata } from './docs/[[...slug]]/page';

export function generateMetadata() {
  return docsMetadata({ params: Promise.resolve({}) });
}

export default function HomePage() {
  return <DocsPage params={Promise.resolve({})} />;
}
