import assert from 'node:assert/strict';

const webUrl = process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:3100';
const apiUrl = process.env.SMOKE_API_URL ?? webUrl;
const request = (url, options = {}) =>
  fetch(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });

const page = await request(new URL('/', webUrl));
assert.equal(page.status, 200);
assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
const html = await page.text();
assert.match(html, /AgoraFab/);
assert.match(html, /基础环境已搭建/);
assert.match(html, /登录后浏览/);
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
const accountConfig = await request(new URL('/api/auth/config', apiUrl));
assert.equal(accountConfig.status, 200);
assert.equal(typeof (await accountConfig.json()).githubEnabled, 'boolean');
const signIn = await request(new URL('/api/auth/github/start', webUrl));
assert.equal(signIn.status, 405);
for (const path of [
  '/topics',
  '/topics/daily-inspiration',
  '/topics/fixture-project',
  '/search?q=example',
]) {
  const hidden = await request(new URL(path, webUrl));
  assert.equal(hidden.status, 307, path);
  assert.equal(hidden.headers.get('location'), '/account', path);
}
for (const path of [
  '/api/topics',
  '/api/topics/daily-inspiration',
  '/api/projects/fixture-project/tasks',
  '/api/search?q=example',
]) {
  const hidden = await request(new URL(path, apiUrl));
  assert.equal(hidden.status, 401, path);
  assert.equal((await hidden.json()).error.code, 'UNAUTHORIZED', path);
}
const write = await fetch(
  new URL('/api/topics/daily-inspiration/posts', apiUrl),
  {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  },
);
assert.equal(write.status, 401);
assert.equal((await write.json()).error.code, 'UNAUTHORIZED');
const mcp = (method, params) =>
  request(new URL('/mcp', apiUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
const discovery = await mcp('tools/list', {});
assert.equal(discovery.status, 200);
const toolNames = new Set(
  (await discovery.json()).result.tools.map(({ name }) => name),
);
assert.equal(toolNames.size, 11);
assert.ok(toolNames.has('mark_notification_read'));
assert.ok(
  toolNames.has('get_topic_context') && toolNames.has('submit_artifact'),
);
const content = await mcp('tools/call', { name: 'list_topics', arguments: {} });
assert.equal(content.status, 200);
const { result } = await content.json();
assert.equal(result.isError, true);
assert.equal(result.structuredContent.error.code, 'UNAUTHORIZED');
const missing = await request(new URL('/api/unavailable-route', apiUrl));
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error.code, 'NOT_FOUND');
console.log(
  'Smoke passed: SSR shell, Web/API/DB health, MCP discovery, and anonymous content read and write protection.',
);
