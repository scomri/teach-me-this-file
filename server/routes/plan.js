import { Router } from 'express';
import { MAX_DOC_CHARS, MAX_PROMPT_CHARS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';
import { providerOutcome } from '../ai/errors.js';
import { PLAN_RESPONSE_FORMAT, validatePlan } from '../ai/plan.js';
import { buildPlanMessages, repairMessages } from '../ai/prompts/plan.js';

const SCRIPTS = ['hebrew', 'arabic', 'latin', 'other'];
const STATUS = { invalid_request: 400, invalid_key: 401, model_not_found: 404, document_too_long: 413, rate_limited: 429, unreachable: 502, plan_invalid: 502 };

// Returns the checked request, or an error code.
function parse(body) {
  const { preset, teacher, prompt = '', script = 'other', chunks } = body ?? {};
  if (!Object.hasOwn(PRESETS, preset)) return { code: 'invalid_request' };
  if (teacher !== undefined && (typeof teacher !== 'string' || teacher.length > 200)) return { code: 'invalid_request' };
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS || !SCRIPTS.includes(script)) return { code: 'invalid_request' };
  if (!Array.isArray(chunks) || !chunks.length) return { code: 'invalid_request' };
  const ids = new Set();
  let chars = 0;
  for (const c of chunks) {
    // The id and page go into prompt attributes, so they are checked, not escaped.
    if (typeof c?.id !== 'string' || !/^[\w-]{1,20}$/.test(c.id) || ids.has(c.id) || typeof c.text !== 'string') return { code: 'invalid_request' };
    if (c.page != null && !Number.isInteger(c.page)) return { code: 'invalid_request' };
    ids.add(c.id);
    chars += c.text.length;
  }
  if (chars > MAX_DOC_CHARS) return { code: 'document_too_long' };
  return { preset, model: teacher?.trim() || PRESETS[preset].teacher, prompt, script, chunks, ids };
}

// POST /api/plan { preset, teacher?, prompt?, script?, chunks } with X-Api-Key.
// Answers { plan, constraints } or { code }. A rejected plan gets one repair retry.
export function planRouter(fetchImpl, timeoutMs = 90_000) {
  const router = Router();
  router.post('/plan', async (req, res) => {
    const request = parse(req.body);
    const fail = (code) => res.status(STATUS[code]).json({ code });
    if (request.code) return fail(request.code);
    const apiKey = req.get('X-Api-Key')?.trim();
    if (!apiKey) return fail('invalid_key');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let messages = buildPlanMessages(request);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await chatCompletion({
          preset: request.preset, apiKey, model: request.model, messages,
          maxCompletionTokens: 8192, responseFormat: PLAN_RESPONSE_FORMAT, signal: controller.signal,
        }, fetchImpl);
        const code = await providerOutcome(response);
        if (code !== 'ok') return fail(code);

        const content = (await response.json().catch(() => null))?.choices?.[0]?.message?.content;
        let reply;
        try { reply = JSON.parse(content); } catch { reply = null; }
        const result = reply && typeof reply === 'object' ? validatePlan(reply, request.ids) : { ok: false, errors: ['the reply was not a JSON object'] };
        if (result.ok) return res.json({ plan: result.plan, constraints: result.constraints });
        messages = repairMessages(messages, content, result.errors);
      }
      fail('plan_invalid');
    } catch {
      if (!res.destroyed) fail('unreachable'); // network failure, timeout, or a client that left
    } finally {
      clearTimeout(timer); res.off('close', disconnect);
    }
  });
  return router;
}
