import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

// Starts the app on an ephemeral port with a capturing log sink.
function start(t) {
  const lines = [];
  const server = createApp({ log: (line) => lines.push(line) }).listen(0);
  t.after(() => server.close());
  return { lines, url: `http://127.0.0.1:${server.address().port}` };
}

const post = (url, body, headers = {}, signal) =>
  fetch(`${url}/api/echo-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal,
  });

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

test('GET /api/health returns { ok: true }', async (t) => {
  const { url } = start(t);
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown /api path returns 404 JSON', async (t) => {
  const { url } = start(t);
  const res = await fetch(`${url}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('echo-stream sends one SSE event per word, then done', async (t) => {
  const { url } = start(t);
  const res = await post(url, JSON.stringify({ text: 'hello big world' }));
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const body = await res.text();
  const words = [...body.matchAll(/^data: \{"word":"(.+)"\}$/gm)].map((m) => m[1]);
  assert.deepEqual(words, ['hello', 'big', 'world']);
  assert.match(body, /event: done/);
});

test('echo-stream rejects missing, empty and oversized text with 400', async (t) => {
  const { url } = start(t);
  for (const body of [{}, { text: '  ' }, { text: 5 }, { text: 'a'.repeat(2001) }]) {
    const res = await post(url, JSON.stringify(body));
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  }
});

test('closing the connection mid-stream stops the server loop and logs aborted', async (t) => {
  const { url, lines } = start(t);
  const ac = new AbortController();
  const res = await post(url, JSON.stringify({ text: Array(50).fill('word').join(' ') }), {}, ac.signal);
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  assert.ok(await waitFor(() => lines.some((l) => l.includes('aborted'))), `no aborted line in ${lines}`);
  assert.ok(!lines.some((l) => l.includes('/api/echo-stream 200')), 'stream should not have finished');
});

test('X-Api-Key never appears in log output, including on an error path', async (t) => {
  const { url, lines } = start(t);
  const headers = { 'X-Api-Key': 'sk-test-123' };

  const ok = await post(url, JSON.stringify({ text: 'hi' }), headers);
  await ok.text();
  const bad = await post(url, '{not json', headers);
  assert.equal(bad.status, 400);
  await bad.text();

  assert.ok(await waitFor(() => lines.length >= 2));
  assert.ok(lines.some((l) => l.includes('error:')), 'error path should be logged');
  assert.ok(!lines.join('\n').includes('sk-test-123'));
});

test('malformed JSON returns a fixed message and never echoes the body', async (t) => {
  const { url, lines } = start(t);
  const res = await post(url, '{"text": "secret-fragment');
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.deepEqual(JSON.parse(body), { error: 'Invalid JSON body' });

  assert.ok(await waitFor(() => lines.some((l) => l.includes('error:'))));
  assert.ok(!body.includes('secret-fragment'));
  assert.ok(!lines.join(' ').includes('secret-fragment'));
});
