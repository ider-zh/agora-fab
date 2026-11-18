export async function getApiHealth(): Promise<boolean> {
  try {
    const baseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    const response = await fetch(new URL('/health/ready', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const body: unknown = await response.json();
    return (
      response.ok &&
      typeof body === 'object' &&
      body !== null &&
      'status' in body &&
      body.status === 'ok'
    );
  } catch {
    return false;
  }
}
