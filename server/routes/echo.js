import { Router } from 'express';

const WORD_DELAY_MS = 150;
const MAX_TEXT = 2000;

export function echoRouter(log = console.log) {
  const router = Router();

  router.post('/echo-stream', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return res.status(400).json({ error: `text must be a non-empty string up to ${MAX_TEXT} characters` });
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();

    const words = text.trim().split(/\s+/);
    let timer;
    let i = 0;

    // Client went away before we finished: stop the loop.
    res.on('close', () => {
      if (res.writableEnded) return;
      clearTimeout(timer);
      log(`${req.method} ${req.originalUrl} aborted`);
    });

    const next = () => {
      if (i === words.length) {
        res.write('event: done\ndata: {}\n\n');
        return res.end();
      }
      res.write(`data: ${JSON.stringify({ word: words[i++] })}\n\n`);
      timer = setTimeout(next, WORD_DELAY_MS);
    };
    next();
  });

  return router;
}
