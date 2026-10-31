import { createApp } from './app.js';

const port = process.env.PORT || 8080;
const server = createApp()
  .listen(port, () => console.log(`Listening on ${port}`))
  .on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

// Cloud Run sends SIGTERM; stop accepting connections and exit.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => process.exit(0));
    setTimeout(() => server.closeAllConnections(), 8_000).unref();
  });
}
