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
    // V8 parse messages can echo body fragments, so use a fixed message.
    const message = err.type === 'entity.parse.failed' ? 'Invalid JSON body' : err.message;
    log(`${req.method} ${req.originalUrl} error: ${message}`);
    if (res.headersSent) return res.end();
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'request_too_large',
        message: 'The request is too large. Try a shorter document.',
      });
    }
    res.status(err.status ?? 500).json({ error: err.status && err.status < 500 ? message : 'Internal error' });
  };
}
