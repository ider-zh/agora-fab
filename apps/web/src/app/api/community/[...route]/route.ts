import { proxyCommunity } from '../../../../lib/community-proxy';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ route: string[] }> };

async function handle(request: Request, context: Context) {
  return proxyCommunity(request, (await context.params).route);
}

export { handle as POST, handle as PATCH };
