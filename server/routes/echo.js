import { randomUUID } from 'node:crypto';
import { Router } from 'express';

const WORD_DELAY_MS = 150;
const MAX_TEXT = 2000;
export const STREAM_MAX_MS = 120_000;

// `streams` maps stream id -> { abort() } for every active stream. It is
// in-memory, which is correct only because the service runs as a single
// instance (max-instances 1). More instances would need sticky routing or a
// shared store, or a cancel could land on an instance that does not own the stream.
export function echoRouter(log = console.log, streams = new Map(), streamMaxMs = STREAM_MAX_MS) {
  const router = Router();

  router.post('/echo-stream', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return res.status(400).json({ error: `text must be a non-empty string up to ${MAX_TEXT} characters` });
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();

    const id = randomUUID();
    const words = text.trim().split(/\s+/);
    let timer;
    let i = 0;
    let ended = false;

    // The single exit: runs once per stream, whatever ends it.
    const end = (reason) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearTimeout(cap);
      streams.delete(id);
      if (reason === 'done') res.write('event: done\ndata: {}\n\n');
      if (reason === 'timeout') res.write('event: error\ndata: {"error":"timeout"}\n\n');
      if (reason !== 'close') res.end();
      if (reason !== 'done') log(`${req.method} ${req.baseUrl}${req.path} ${reason === 'close' ? 'aborted' : reason}`);
    };

    const cap = setTimeout(() => end('timeout'), streamMaxMs);
    streams.set(id, { abort: () => end('cancelled') });
    res.on('close', () => end('close'));
    res.write(`event: start\ndata: ${JSON.stringify({ id })}\n\n`);

    const next = () => {
      if (i === words.length) return end('done');
      res.write(`data: ${JSON.stringify({ word: words[i++] })}\n\n`);
      timer = setTimeout(next, WORD_DELAY_MS);
    };
    next();
  });

  router.post('/streams/:id/cancel', (req, res) => {
    const stream = streams.get(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    stream.abort();
    res.status(204).end();
  });

  return router;
}
