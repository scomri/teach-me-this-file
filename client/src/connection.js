// Requests that check the connection to the server and the model provider. No React.

// Checks the key and models. Resolves with the server's body ({ code, role? }); a network failure or a body
// that is not JSON resolves with { code: 'unreachable' }. An aborted `signal` also maps to 'unreachable'.
export async function checkKey({ settings, signal }, fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey },
      body: JSON.stringify({ preset: settings.preset, evaluator: settings.evaluator, teacher: settings.teacher }),
      signal,
    });
    return await response.json().catch(() => ({ code: 'unreachable' }));
  } catch {
    return { code: 'unreachable' };
  }
}

// Pings the server. Resolves true when it answers { ok: true }, false otherwise; never throws.
export async function pingHealth({ signal } = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/health', { signal });
    return (await response.json()).ok === true;
  } catch {
    return false;
  }
}
