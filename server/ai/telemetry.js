import { randomUUID } from 'node:crypto';

export function providerTelemetry(req, operation, log, fetchImpl = fetch) {
  const supplied = req.get('X-Turn-Id');
  const turnId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied ?? '') ? supplied : randomUUID();
  let attempts = 0;
  let rateLimits = 0;
  return {
    fetch: async (...args) => {
      attempts++;
      const response = await fetchImpl(...args);
      if (response.status === 429) rateLimits++;
      return response;
    },
    finish: () => log(JSON.stringify({ event: 'provider_attempts', turnId, operation, attempts, rateLimits })),
  };
}
