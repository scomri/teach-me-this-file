import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

async function startStream(t, text) {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  // Windows cannot deliver POSIX signals to a child, so invoke the same signal event via IPC.
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import './server/index.js'; process.on('message', () => process.emit('SIGTERM'));"], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child.stdout, 'data');
  const res = await fetch(`http://127.0.0.1:${port}/api/echo-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const reader = res.body.getReader();
  const first = await reader.read();
  const exited = once(child, 'exit');
  return { child, reader, first, exited };
}

function shutdown(child) {
  if (process.platform === 'win32') child.send('shutdown');
  else child.kill('SIGTERM');
}

test('shutdown lets an active stream finish before the process exits', { timeout: 10000 }, async (t) => {
  const { child, reader, first, exited } = await startStream(t, 'one two three');
  shutdown(child);
  let body = new TextDecoder().decode(first.value);
  for (;;) { const part = await reader.read(); if (part.done) break; body += new TextDecoder().decode(part.value); }
  assert.match(body, /event: done/);
  assert.equal((await exited)[0], 0);
});

test('shutdown closes a stream that outlasts the grace period', { timeout: 15000 }, async (t) => {
  const { child, reader, exited } = await startStream(t, Array(100).fill('word').join(' '));
  const start = Date.now();
  shutdown(child);
  const reading = (async () => { for (;;) if ((await reader.read()).done) return; })();
  await assert.rejects(reading, /terminated/);
  assert.equal((await exited)[0], 0);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 7000 && elapsed < 10000, `shutdown took ${elapsed}ms`);
});
