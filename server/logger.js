// One line per request, written when the response finishes. Headers are never
// logged, so X-Api-Key cannot leak; errors log the message only.
export function requestLogger(log = console.log) {
  return (req, res, next) => {
    const { method, path } = req; // read now: routers strip the mount prefix from req.path
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log(`${method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}

export function errorHandler(log = console.log) {
  return (err, req, res, next) => {
    log(`${req.method} ${req.originalUrl} error: ${err.message}`);
    if (res.headersSent) return res.end();
    res.status(err.status ?? 500).json({ error: err.status && err.status < 500 ? err.message : 'Internal error' });
  };
}
