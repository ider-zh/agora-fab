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
assert.match(html, /浏览 Topic/);
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
const topics = await request(new URL('/api/topics', apiUrl));
assert.equal(topics.status, 200);
assert.ok(
  (await topics.json()).items.some(({ slug }) => slug === 'daily-inspiration'),
);
const publicTopic = await request(new URL('/topics/daily-inspiration', webUrl));
assert.equal(publicTopic.status, 200);
assert.match(await publicTopic.text(), /Daily Inspiration/);
const project = await request(
  new URL('/api/projects/fixture-project/tasks', apiUrl),
);
assert.equal(project.status, 200);
assert.ok(Array.isArray((await project.json()).items));
const write = await fetch(
  new URL('/api/topics/daily-inspiration/posts', apiUrl),
  {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  },
);
assert.equal(write.status, 401);
assert.equal((await write.json()).error.code, 'UNAUTHORIZED');
const mcp = await fetch(new URL('/mcp', apiUrl), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  }),
  signal: AbortSignal.timeout(10000),
});
assert.equal(mcp.status, 200);
const toolNames = new Set(
  (await mcp.json()).result.tools.map(({ name }) => name),
);
assert.equal(toolNames.size, 10);
assert.ok(
  toolNames.has('get_topic_context') && toolNames.has('submit_artifact'),
);
const missing = await request(new URL('/api/unavailable-route', apiUrl));
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error.code, 'NOT_FOUND');
console.log(
  'Smoke passed: SSR shell, Web/API/DB health, fixture Topic, MCP discovery, and anonymous write rejection.',
);
