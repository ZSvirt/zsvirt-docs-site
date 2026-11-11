import { exportSearchSnapshot } from '@/lib/search/export';

export const dynamic = 'force-static';

/** Build artifact consumed by the server runtime; the search UI never downloads it. */
export async function GET() {
  return Response.json(await exportSearchSnapshot());
}
