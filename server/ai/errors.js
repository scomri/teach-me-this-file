// Maps a provider response to a fixed outcome code, never exposing provider text.

// Some providers (OpenRouter) answer an unknown model with 400, not 404. The body is matched, never forwarded.
const UNKNOWN_MODEL = /model_not_found|not a valid model|models?\b[^.]{0,80}?(not found|does not exist)|(invalid|unknown) model/i;
// Gemini answers a bad key with 400 ("Please pass a valid API key"), not 401.
const BAD_KEY = /valid api key|api key not valid|api_key_invalid/i;

export async function providerOutcome(response) {
  if (response.ok) return 'ok';
  if ([401, 403].includes(response.status)) return 'invalid_key';
  if (response.status === 404) return 'model_not_found';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 400) {
    const text = await response.text();
    if (BAD_KEY.test(text)) return 'invalid_key';
    if (UNKNOWN_MODEL.test(text)) return 'model_not_found';
  }
  return 'unreachable';
}
