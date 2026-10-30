const PROVIDERS = {
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', temperature: true },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', temperature: true },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', temperature: true },
  openai: { url: 'https://api.openai.com/v1/chat/completions', temperature: false },
  anthropic: { url: 'https://api.anthropic.com/v1/chat/completions', temperature: false },
};

// Returns the provider response so later routes can consume JSON or a stream.
export async function chatCompletion({ preset, apiKey, model, messages, maxCompletionTokens = 16, stream = false, signal }, fetchImpl = fetch) {
  const provider = PROVIDERS[preset];
  if (!provider) throw new Error('Unsupported preset');
  return fetchImpl(provider.url, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_completion_tokens: maxCompletionTokens, stream, ...(provider.temperature ? { temperature: 0 } : {}) }),
  });
}
