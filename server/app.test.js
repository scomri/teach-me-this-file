import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { MAX_BODY_BYTES } from '../shared/limits.js';

// Starts the app on an ephemeral port with a capturing log sink.
function start(t, opts = {}) {
  const lines = [];
  const app = createApp({ log: (line) => lines.push(line), ...opts });
  const server = app.listen(0);
  t.after(() => server.close());
  return { lines, streams: app.locals.streams, url: `http://127.0.0.1:${server.address().port}` };
}

// Opens a long stream and returns its id (from the start event) plus the reader.
async function openStream(url, words = 50, signal) {
  const res = await post(url, JSON.stringify({ text: Array(words).fill('word').join(' ') }), {}, signal);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const id = /"id":"([^"]+)"/.exec(new TextDecoder().decode(value))[1];
  return { id, reader };
}

const cancel = (url, id, headers = {}) => fetch(`${url}/api/streams/${id}/cancel`, { method: 'POST', headers });

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
  assert.match(body, /^event: start\ndata: \{"id":"[0-9a-f-]{36}"\}/);
  assert.match(body, /event: done/);
});

test('cancelling an active stream returns 204, ends it, logs cancelled and empties the registry', { timeout: 5000 }, async (t) => {
  const { url, lines, streams } = start(t);
  const { id, reader } = await openStream(url);
  assert.equal(streams.size, 1);
  assert.equal((await cancel(url, id)).status, 204);
  for (;;) if ((await reader.read()).done) break; // server ended the response
  assert.ok(lines.includes('POST /api/echo-stream cancelled'), `got ${lines}`);
  assert.ok(await waitFor(() => lines.some((l) => l.startsWith('POST /api/streams/') && l.includes(' 204 '))));
  assert.ok(await waitFor(() => streams.size === 0));
  await new Promise((r) => setTimeout(r, 50)); // let close fire
  assert.ok(!lines.some((l) => l.includes('aborted')), 'cancel must not also log aborted');
});

test('cancelling an unknown id or an already finished stream returns 404', async (t) => {
  const { url } = start(t);
  assert.equal((await cancel(url, 'nope')).status, 404);
  const res = await post(url, JSON.stringify({ text: 'hi' }));
  const id = /"id":"([^"]+)"/.exec(await res.text())[1];
  assert.equal((await cancel(url, id)).status, 404);
});

test('the duration cap ends the stream with event: error and logs timeout', async (t) => {
  const { url, lines, streams } = start(t, { streamMaxMs: 300 });
  const res = await post(url, JSON.stringify({ text: Array(50).fill('word').join(' ') }));
  const body = await res.text();
  assert.match(body, /event: error\ndata: \{"error":"timeout"\}/);
  assert.ok(lines.includes('POST /api/echo-stream timeout'), `got ${lines}`);
  assert.equal(streams.size, 0);
});

test('the registry is empty after a normal finish and after a client disconnect', async (t) => {
  const { url, lines, streams } = start(t);
  await (await post(url, JSON.stringify({ text: 'hi' }))).text();
  assert.equal(streams.size, 0);

  const ac = new AbortController();
  const { reader } = await openStream(url, 50, ac.signal);
  assert.equal(streams.size, 1);
  ac.abort();
  await reader.read().catch(() => {});
  assert.ok(await waitFor(() => streams.size === 0 && lines.some((l) => l.includes('aborted'))));
});

test('the cancel route never logs the X-Api-Key value', { timeout: 5000 }, async (t) => {
  const { url, lines } = start(t);
  const { id, reader } = await openStream(url);
  await cancel(url, id, { 'X-Api-Key': 'sk-test-123' });
  await cancel(url, 'nope', { 'X-Api-Key': 'sk-test-123' });
  for (;;) if ((await reader.read()).done) break;
  assert.ok(await waitFor(() => lines.filter((l) => l.startsWith('POST /api/streams/')).length === 2));
  assert.ok(!lines.join('\n').includes('sk-test-123'));
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

// A JSON body of exactly `bytes` bytes, with `marker` inside so leaks are detectable.
const bodyOfSize = (bytes, marker) => {
  const pad = bytes - Buffer.byteLength(JSON.stringify({ text: marker }));
  return JSON.stringify({ text: marker + 'a'.repeat(pad) });
};

test('a JSON body at the size limit is accepted', async (t) => {
  const { url } = start(t);
  const res = await post(url, bodyOfSize(MAX_BODY_BYTES, 'SECRETMARKER'));
  // The echo route has its own, smaller text cap; reaching it (not 413) means the parser accepted the body.
  assert.notEqual(res.status, 413);
  await res.text();
});

test('a JSON body over the limit returns a fixed 413 and echoes nothing', async (t) => {
  const { url, lines } = start(t);
  const res = await post(url, bodyOfSize(MAX_BODY_BYTES + 1, 'SECRETMARKER'), { 'X-Api-Key': 'sk-secret-key' });
  assert.equal(res.status, 413);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), {
    error: 'request_too_large',
    message: 'The request is too large. Try a shorter document.',
  });
  for (const out of [text, lines.join('\n')]) {
    assert.ok(!out.includes('SECRETMARKER'));
    assert.ok(!out.includes('sk-secret-key'));
  }
});
