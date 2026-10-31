// Evaluate call: the strict output schema and validation (the prompt is in prompts/evaluate.js). Pure; no network.
// The model labels the student's message; code checks the label and drops anything the request cannot back.
export const INTENTS = ['answer', 'asks_for_answer', 'off_topic', 'question'];

export const EVALUATION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'evaluation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['intent', 'keyPointsMet', 'relevantChunkIds'],
      properties: {
        intent: { type: 'string', enum: INTENTS },
        keyPointsMet: { type: 'array', items: { type: 'integer' } },
        relevantChunkIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

// reply: the parsed model output. points: how many key points the step has. chunkIds: Set of the ids sent.
// Returns { ok: true, evaluation } or { ok: false, errors } (strings for the repair message).
export function validateEvaluation(reply, points, chunkIds) {
  const errors = [];
  if (!INTENTS.includes(reply?.intent)) errors.push(`intent must be one of ${INTENTS.join(', ')}`);
  if (!Array.isArray(reply?.keyPointsMet) || !reply.keyPointsMet.every(Number.isInteger)) errors.push('keyPointsMet must be an array of integers');
  if (!Array.isArray(reply?.relevantChunkIds) || !reply.relevantChunkIds.every((id) => typeof id === 'string')) errors.push('relevantChunkIds must be an array of strings');
  if (errors.length) return { ok: false, errors };
  const answer = reply.intent === 'answer';
  return {
    ok: true,
    evaluation: {
      intent: reply.intent,
      keyPointsMet: answer ? [...new Set(reply.keyPointsMet.filter((i) => i >= 0 && i < points))].sort((a, b) => a - b) : [],
      relevantChunkIds: [...new Set(reply.relevantChunkIds.filter((id) => chunkIds.has(id)))],
    },
  };
}
