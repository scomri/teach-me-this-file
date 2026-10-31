import { randomUUID } from 'node:crypto';
import { Router } from 'express';

export const STREAM_MAX_MS = 120_000;

// `streams` maps stream id -> { abort() } for every active stream. It is
// in-memory, which is correct only because the service runs as a single
// instance (max-instances 1). More instances would need sticky routing or a
// shared store, or a cancel could land on an instance that does not own the stream.
//
// Opens an event stream on `res`: sends `start` with the id, registers it for cancel, and arms the
// duration cap. Returns { id, signal, write(data), end(reason) }. `end` is the single exit and runs
// once, whatever ends the stream: 'done', 'cancelled' (cancel endpoint), 'timeout' (the cap),
// 'close' (the client left) or a fixed error code, which is sent as `event: error`. It aborts
// `signal`, so an upstream provider call tied to it stops too.
export function openStream(req, res, { log, streams, maxMs = STREAM_MAX_MS }) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders();

  const id = randomUUID();
  const controller = new AbortController();
  let ended = false;

  const end = (reason) => {
    if (ended) return;
    ended = true;
    clearTimeout(cap);
    streams.delete(id);
    controller.abort();
    if (reason === 'done') res.write('event: done\ndata: {}\n\n');
    else if (!['close', 'cancelled'].includes(reason)) res.write(`event: error\ndata: ${JSON.stringify({ error: reason })}\n\n`);
    if (reason !== 'close') res.end();
    if (reason !== 'done') log(`${req.method} ${req.baseUrl}${req.path} ${reason === 'close' ? 'aborted' : reason}`);
  };

  const cap = setTimeout(() => end('timeout'), maxMs);
  streams.set(id, { abort: () => end('cancelled') });
  res.on('close', () => end('close'));
  res.write(`event: start\ndata: ${JSON.stringify({ id })}\n\n`);

  return { id, signal: controller.signal, write: (data) => { if (!ended) res.write(`data: ${JSON.stringify(data)}\n\n`); }, end };
}

export function cancelRouter(streams) {
  const router = Router();
  router.post('/streams/:id/cancel', (req, res) => {
    const stream = streams.get(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    stream.abort();
    res.status(204).end();
  });
  return router;
}
