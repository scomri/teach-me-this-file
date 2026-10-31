import { Router } from 'express';
import { EVALUATE_OUTPUT_TOKENS, EVALUATION_MAX_ATTEMPTS, MAX_ANSWER_CHARS, MAX_MODEL_CHARS, MAX_TUTOR_CHARS, TURN_RATE_LIMIT_RETRIES } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';
import { providerTelemetry } from '../ai/telemetry.js';
import { EVALUATION_RESPONSE_FORMAT, validateEvaluation } from '../ai/evaluate.js';
import { providerOutcome } from '../ai/errors.js';
import { CAPS, MAX_POINTS } from '../ai/plan.js';
import { buildEvaluateMessages } from '../ai/prompts/evaluate.js';
import { repairMessages } from '../ai/prompts/plan.js';
import { validChunks } from './plan.js';

const STATUS = { invalid_request: 400, invalid_key: 401, model_not_found: 404, out_of_credit: 402, rate_limited: 429, unreachable: 502 };
const MAX_EARLIER = 10; // answers on one step are bounded by its key points and failed attempts; this is slack

const text = (v, max) => typeof v === 'string' && v.length <= max;

// Returns the checked request, or null. The step's chunks are the only document text it carries.
function validateRequest(body) {
  const { preset, evaluator, step, chunks, lastTutor, earlier = [], message } = body ?? {};
  if (!Object.hasOwn(PRESETS, preset) || (evaluator !== undefined && !text(evaluator, MAX_MODEL_CHARS))) return null;
  if (!text(message, MAX_ANSWER_CHARS) || !message.trim() || !text(lastTutor, MAX_TUTOR_CHARS)) return null;
  if (!Array.isArray(earlier) || earlier.length > MAX_EARLIER || !earlier.every((a) => text(a, MAX_ANSWER_CHARS))) return null;
  if (!step || ![step.objective, step.checkQuestion].every((v) => text(v, CAPS.question))) return null;
  if (!Array.isArray(step.expected) || step.expected.length < 1 || step.expected.length > MAX_POINTS || !step.expected.every((p) => text(p, CAPS.point))) return null;
  const ids = validChunks(chunks);
  if (!ids) return null;
  return {
    preset, model: evaluator?.trim() || PRESETS[preset].evaluator, ids, chunks, lastTutor, earlier, message,
    step: { objective: step.objective, checkQuestion: step.checkQuestion, expected: step.expected },
  };
}

// POST /api/evaluate { preset, evaluator?, step: { objective, checkQuestion, expected }, chunks, lastTutor,
// earlier: [string], message } with X-Api-Key. Answers { evaluation: { intent, keyPointsMet, relevantChunkIds } }
// or { code }. A reply that breaks the schema gets one repair retry; if that fails too, { evaluation: null }.
export function evaluateRouter(fetchImpl, timeoutMs = 30_000, log = console.log) {
  const router = Router();
  router.post('/evaluate', async (req, res) => {
    const fail = (code) => res.status(STATUS[code]).json({ code });
    const request = validateRequest(req.body);
    if (!request) return fail('invalid_request');
    const apiKey = req.get('X-Api-Key')?.trim();
    if (!apiKey) return fail('invalid_key');
    const telemetry = providerTelemetry(req, 'evaluate', log, fetchImpl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let messages = buildEvaluateMessages(request);
      let rateRetries = 0;
      for (let attempt = 0; attempt < EVALUATION_MAX_ATTEMPTS; attempt++) {
        let response = await chatCompletion({
          preset: request.preset, apiKey, model: request.model, messages,
          maxCompletionTokens: EVALUATE_OUTPUT_TOKENS, responseFormat: EVALUATION_RESPONSE_FORMAT, signal: controller.signal,
        }, telemetry.fetch);
        let code = await providerOutcome(response);
        if (code === 'rate_limited' && rateRetries < TURN_RATE_LIMIT_RETRIES) {
          rateRetries++;
          response = await chatCompletion({ preset: request.preset, apiKey, model: request.model, messages, maxCompletionTokens: EVALUATE_OUTPUT_TOKENS, responseFormat: EVALUATION_RESPONSE_FORMAT, signal: controller.signal }, telemetry.fetch);
          code = await providerOutcome(response);
        }
        if (code !== 'ok') return fail(code);

        const content = (await response.json().catch(() => null))?.choices?.[0]?.message?.content;
        let reply;
        try { reply = JSON.parse(content); } catch { reply = null; }
        const result = reply && typeof reply === 'object' ? validateEvaluation(reply, request.step.expected.length, request.ids) : { ok: false, errors: ['the reply was not a JSON object'] };
        if (result.ok) return res.json({ evaluation: result.evaluation, ...(rateRetries && { rateLimitRetried: true }) });
        messages = repairMessages(messages, content, result.errors, 'evaluation');
      }
      res.json({ evaluation: null, ...(rateRetries && { rateLimitRetried: true }) });
    } catch {
      if (!res.destroyed) fail('unreachable'); // network failure, timeout, or a client that left
    } finally {
      telemetry.finish(); clearTimeout(timer); res.off('close', disconnect);
    }
  });
  return router;
}
