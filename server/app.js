import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BODY_BYTES } from '../shared/limits.js';
import { errorHandler, requestLogger } from './logger.js';
import { checkRouter } from './routes/check.js';
import { echoRouter } from './routes/echo.js';
import { planRouter } from './routes/plan.js';
import { teachRouter } from './routes/teach.js';
import { cancelRouter } from './streams.js';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');

// `log` is injectable so tests can capture output.
export function createApp({ log = console.log, streamMaxMs, providerFetch, checkTimeoutMs, planTimeoutMs } = {}) {
  const app = express();
  const streams = new Map();
  app.locals.streams = streams; // read by tests to assert cleanup

  app.use(requestLogger(log));
  app.use(express.json({ limit: MAX_BODY_BYTES }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', checkRouter(providerFetch, checkTimeoutMs));
  app.use('/api', planRouter(providerFetch, planTimeoutMs));
  app.use('/api', echoRouter(log, streams, streamMaxMs));
  app.use('/api', teachRouter(providerFetch, log, streams, streamMaxMs));
  app.use('/api', cancelRouter(streams));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built client; unknown paths fall back to the SPA shell.
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile('index.html', { root: dist }));

  app.use(errorHandler(log));
  return app;
}
