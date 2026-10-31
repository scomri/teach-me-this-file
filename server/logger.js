// One line per request, written when the response finishes. Headers are never
// logged, so X-Api-Key cannot leak; errors use fixed messages.
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
    const status = err.status ?? 500;
    const message = err.type === 'entity.parse.failed' ? 'Invalid JSON body'
      : err.type === 'entity.too.large' ? 'The request is too large. Try a shorter document.'
      : status < 500 ? 'Invalid request' : 'Internal error';
    log(`${req.method} ${req.path} error: ${message}`);
    if (res.headersSent) return res.end();
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'request_too_large',
        message,
      });
    }
    res.status(status).json({ error: message });
  };
}
