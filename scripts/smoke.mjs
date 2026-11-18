import assert from 'node:assert/strict';

const webUrl = process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:3100';
const apiUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3101';
const request = (url) => fetch(url, { signal: AbortSignal.timeout(10000) });

const page = await request(new URL('/', webUrl));
assert.equal(page.status, 200);
assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
const html = await page.text();
assert.match(html, /AgoraFab/);
assert.match(html, /基础环境已搭建/);
assert.match(html, /以下功能尚未实现/);
assert.match(html, /已连接/);
for (const [base, path] of [
  [webUrl, '/health'],
  [apiUrl, '/health/live'],
  [apiUrl, '/health/ready'],
]) {
  const response = await request(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.equal((await response.json()).status, 'ok', path);
}
const missing = await request(new URL('/api/topics', apiUrl));
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error.code, 'NOT_FOUND');
console.log(
  'Smoke passed: SSR shell, security header, Web/API/DB health, and planned API returns 404.',
);
