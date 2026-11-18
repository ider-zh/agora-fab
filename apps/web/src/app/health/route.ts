import { getApiHealth } from '../../lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ready = await getApiHealth();
  return Response.json(
    {
      status: ready ? 'ok' : 'unavailable',
      services: { web: 'ok', api: ready ? 'ok' : 'unavailable' },
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
