import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler, requestLogger } from './logger.js';
import { echoRouter } from './routes/echo.js';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');

// `log` is injectable so tests can capture output.
export function createApp({ log = console.log } = {}) {
  const app = express();

  app.use(requestLogger(log));
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', echoRouter(log));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built client; unknown paths fall back to the SPA shell.
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));

  app.use(errorHandler(log));
  return app;
}
