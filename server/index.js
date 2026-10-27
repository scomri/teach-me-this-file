import { createApp } from './app.js';

const port = process.env.PORT || 8080;
const server = createApp()
  .listen(port, () => console.log(`Listening on ${port}`))
  .on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

// Cloud Run sends SIGTERM; stop accepting connections and exit.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections(); // open SSE streams would otherwise block close
  });
}
