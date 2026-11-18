import { DomainError, requireAction } from '@agorafab/domain';

export const defaultTrafficLimits = {
  writesPerPrincipal: 60,
  writesPerCredential: 40,
  searchesPerPeer: 120,
};
export type TrafficLimits = typeof defaultTrafficLimits;
export type AuthorizeMutation = typeof requireAction;

export function createTrafficPolicy(limits: TrafficLimits, now = Date.now) {
  let minute = -1;
  const counts = new Map<string, number>();

  function consume(buckets: { key: string; cap: number }[]) {
    const current = Math.floor(now() / 60_000);
    if (minute !== current) {
      counts.clear();
      minute = current;
    }
    const newKeys = buckets.filter(({ key }) => !counts.has(key)).length;
    if (
      counts.size + newKeys > 8192 ||
      buckets.some(({ key, cap }) => (counts.get(key) ?? 0) >= cap)
    ) {
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Request limit reached. Try again shortly.',
      );
    }
    for (const { key } of buckets) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const authorize: AuthorizeMutation = (auth, action) => {
    const actor = requireAction(auth, action);
    const buckets = [
      { key: `write:${actor.id}`, cap: limits.writesPerPrincipal },
    ];
    if (auth?.method === 'bearer' && auth.credentialId) {
      buckets.push({
        key: `credential:${auth.credentialId}`,
        cap: limits.writesPerCredential,
      });
    }
    consume(buckets);
    return actor;
  };

  return {
    authorize,
    checkSearch: (peer: string) =>
      consume([{ key: `search:${peer}`, cap: limits.searchesPerPeer }]),
  };
}
