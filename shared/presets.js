// tpm: a conservative input-tokens-per-minute setting for a new key on the teacher model, not a published limit. A plan
// request must fit under it, so it sets how much of a document is sent whole (client/src/outline.js).
export const PRESETS = {
  gemini: { name: 'Gemini', evaluator: 'gemini-3.5-flash-lite', teacher: 'gemini-3.8-flash', tpm: 250_000, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', evaluator: 'google/gemini-3.5-flash-lite', teacher: 'google/gemini-3.8-flash', tpm: 250_000, keyUrl: 'https://openrouter.ai/settings/keys' },
  openai: { name: 'OpenAI', evaluator: 'gpt-6-luna', teacher: 'gpt-6.1-terra', tpm: 200_000, keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Anthropic', evaluator: 'claude-haiku-5-5', teacher: 'claude-sonnet-5-5', tpm: 30_000, keyUrl: 'https://console.anthropic.com/settings/keys' },
};
