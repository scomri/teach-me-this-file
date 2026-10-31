import { Router } from 'express';
import { MAX_DOC_CHARS, MAX_MODEL_CHARS, MAX_PROMPT_CHARS, PLAN_OUTPUT_TOKENS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';
import { providerOutcome } from '../ai/errors.js';
import { PLAN_RESPONSE_FORMAT, validatePlan } from '../ai/plan.js';
import { buildPlanMessages, repairMessages } from '../ai/prompts/plan.js';

const SCRIPTS = ['hebrew', 'arabic', 'latin', 'other'];
const STATUS = { invalid_request: 400, invalid_key: 401, model_not_found: 404, document_too_long: 413, out_of_credit: 402, rate_limited: 429, unreachable: 502, plan_invalid: 502 };

const invalid = { code: 'invalid_request' };
// Ids and pages go into prompt attributes, so they are checked, not escaped.
const isId = (id) => typeof id === 'string' && /^[\w-]{1,20}$/.test(id);

// Returns the checked request, or an error code. The document is either `chunks` (the full text) or
// an `outline` of it with `chunkIds`, the id of every chunk, in document order.
function validateRequest(body) {
  const { preset, teacher, prompt = '', script = 'other', chunks, outline, chunkIds, wholeFile = false } = body ?? {};
  if (!Object.hasOwn(PRESETS, preset)) return invalid;
  if (teacher !== undefined && (typeof teacher !== 'string' || teacher.length > MAX_MODEL_CHARS)) return invalid;
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS || !SCRIPTS.includes(script)) return invalid;
  if (typeof wholeFile !== 'boolean' || (chunks === undefined) === (outline === undefined)) return invalid;

  const ids = new Set();
  let chars = 0;
  if (chunks !== undefined) {
    if (!Array.isArray(chunks) || !chunks.length) return invalid;
    for (const c of chunks) {
      if (!isId(c?.id) || ids.has(c.id) || typeof c.text !== 'string') return invalid;
      if (c.page != null && !Number.isInteger(c.page)) return invalid;
      ids.add(c.id);
      chars += c.text.length;
    }
  } else {
    if (!Array.isArray(outline) || !outline.length || !Array.isArray(chunkIds) || !chunkIds.length) return invalid;
    const position = new Map();
    for (const id of chunkIds) {
      if (!isId(id) || position.has(id)) return invalid;
      position.set(id, position.size);
    }
    let end = -1; // entries cover the document in order
    for (const e of outline) {
      if (!position.has(e?.first) || !position.has(e.last) || position.get(e.first) > position.get(e.last) || position.get(e.first) <= end) return invalid;
      if (e.page != null && !Number.isInteger(e.page)) return invalid;
      if (typeof e.heading !== 'string' || typeof e.text !== 'string') return invalid;
      end = position.get(e.last);
      chars += e.heading.length + e.text.length;
    }
    for (const id of position.keys()) ids.add(id);
  }
  if (chars > MAX_DOC_CHARS) return { code: 'document_too_long' };
  return { preset, model: teacher?.trim() || PRESETS[preset].teacher, prompt, script, chunks, outline, ids, wholeFile };
}

// POST /api/plan { preset, teacher?, prompt?, script?, chunks | outline + chunkIds, wholeFile? } with X-Api-Key.
// Answers { plan, constraints, coverage, coverageNote } (plan is null when coverage is 'none') or { code }.
// A rejected plan gets one repair retry.
export function planRouter(fetchImpl, timeoutMs = 90_000) {
  const router = Router();
  router.post('/plan', async (req, res) => {
    const request = validateRequest(req.body);
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
          maxCompletionTokens: PLAN_OUTPUT_TOKENS, responseFormat: PLAN_RESPONSE_FORMAT, signal: controller.signal,
        }, fetchImpl);
        const code = await providerOutcome(response);
        if (code !== 'ok') return fail(code);

        const content = (await response.json().catch(() => null))?.choices?.[0]?.message?.content;
        let reply;
        try { reply = JSON.parse(content); } catch { reply = null; }
        const result = reply && typeof reply === 'object' ? validatePlan(reply, request.ids, { promptBlank: !request.prompt.trim(), wholeFile: request.wholeFile }) : { ok: false, errors: ['the reply was not a JSON object'] };
        if (result.ok) {
          const { plan, constraints, coverage, coverageNote, documentLanguage } = result;
          return res.json({ plan, constraints, coverage, coverageNote, documentLanguage });
        }
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
