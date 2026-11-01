import test from 'node:test';
import assert from 'node:assert/strict';
import { checkKey, pingHealth } from './connection.js';

const settings = { preset: 'gemini', apiKey: 'k-1', evaluator: 'ev', teacher: 'te' };

test('checkKey posts the settings with the key in the header and returns the server body', async () => {
  let call;
  const fetchImpl = async (url, init) => { call = { url, init }; return Response.json({ code: 'ok' }); };
  const signal = new AbortController().signal;
  assert.deepEqual(await checkKey({ settings, signal }, fetchImpl), { code: 'ok' });
  assert.equal(call.url, '/api/check');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-Api-Key'], 'k-1');
  assert.equal(call.init.signal, signal);
  assert.deepEqual(JSON.parse(call.init.body), { preset: 'gemini', evaluator: 'ev', teacher: 'te' });
});

test('checkKey passes server codes and roles through', async () => {
  for (const body of [{ code: 'invalid_key' }, { code: 'model_not_found', role: 'teacher' }, { code: 'invalid_request' }, { code: 'rate_limited' }]) {
    assert.deepEqual(await checkKey({ settings }, async () => Response.json(body, { status: 400 })), body);
  }
});

test('checkKey maps a network failure or an unreadable body to unreachable', async () => {
  assert.deepEqual(await checkKey({ settings }, async () => { throw new TypeError('offline'); }), { code: 'unreachable' });
  assert.deepEqual(await checkKey({ settings }, async () => new Response('<html>', { status: 502 })), { code: 'unreachable' });
});

test('checkKey maps an aborted request to unreachable', async () => {
  const controller = new AbortController();
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const pending = checkKey({ settings, signal: controller.signal }, fetchImpl);
  controller.abort();
  assert.deepEqual(await pending, { code: 'unreachable' });
});

test('pingHealth resolves true only for { ok: true }', async () => {
  assert.equal(await pingHealth({}, async () => Response.json({ ok: true })), true);
  assert.equal(await pingHealth({}, async () => Response.json({ ok: false })), false);
  assert.equal(await pingHealth({}, async () => { throw new TypeError('offline'); }), false);
  assert.equal(await pingHealth({}, async () => new Response('x')), false);
});
