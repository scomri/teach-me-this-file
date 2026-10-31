import { Router } from 'express';
import { openStream } from '../streams.js';

const WORD_DELAY_MS = 150;
const MAX_TEXT = 2000;

export function echoRouter(log = console.log, streams = new Map(), streamMaxMs) {
  const router = Router();

  router.post('/echo-stream', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return res.status(400).json({ error: `text must be a non-empty string up to ${MAX_TEXT} characters` });
    }

    const stream = openStream(req, res, { log, streams, maxMs: streamMaxMs });
    const words = text.trim().split(/\s+/);
    let i = 0;
    let timer;
    stream.signal.addEventListener('abort', () => clearTimeout(timer));

    const next = () => {
      if (i === words.length) return stream.end('done');
      stream.write({ word: words[i++] });
      timer = setTimeout(next, WORD_DELAY_MS);
    };
    next();
  });

  return router;
}
