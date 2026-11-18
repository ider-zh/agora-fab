import { proxyAuth } from '../../../../lib/auth-proxy';

type AuthRouteContext = { params: Promise<{ route: string[] }> };

async function authRoute(request: Request, context: AuthRouteContext) {
  return proxyAuth(request, (await context.params).route);
}

export { authRoute as GET, authRoute as POST };
