import { Router } from 'express';
import { MAX_DOC_CHARS, MAX_MODEL_CHARS, MAX_STEPS, TEACH_OUTPUT_TOKENS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';
import { CAPS, MAX_POINTS } from '../ai/plan.js';
import { providerOutcome } from '../ai/errors.js';
import { buildTeachMessages, TRANSITIONS } from '../ai/prompts/teach.js';
import { openStream } from '../streams.js';
import { isId } from './plan.js';

const MAX_FIELD_CHARS = 300; // step title, objective, check question
const MAX_SETTING_CHARS = 100; // language, audience, style

const text = (v, max) => typeof v === 'string' && v.length <= max;
const optional = (v) => v == null || text(v, MAX_SETTING_CHARS);

const textList = (v, max, count) => Array.isArray(v) && v.length <= count && v.every((x) => text(x, max));

// The step the student just answered: its key points and which of them are met (indexes into expected).
function validAnswered(a) {
  if (!a || ![a.title, a.checkQuestion].every((v) => text(v, MAX_FIELD_CHARS))) return null;
  if (!textList(a.expected, CAPS.point, MAX_POINTS) || !a.expected.length) return null;
  if (!Array.isArray(a.pointsMet) || !a.pointsMet.every((i) => Number.isInteger(i) && i >= 0 && i < a.expected.length) || new Set(a.pointsMet).size !== a.pointsMet.length) return null;
  return { title: a.title, checkQuestion: a.checkQuestion, expected: a.expected, pointsMet: a.pointsMet };
}

// Returns the checked request, or null. The step's chunks are the only document text it carries.
function validateRequest(body) {
  const { preset, teacher, transition, lesson, step, chunks, answered, recap } = body ?? {};
  if (!Object.hasOwn(PRESETS, preset) || (teacher !== undefined && !text(teacher, MAX_MODEL_CHARS))) return null;
  if (!Object.hasOwn(TRANSITIONS, transition)) return null;
  if (!lesson || ![lesson.language, lesson.audience, lesson.style, lesson.documentLanguage].every(optional)) return null;
  if (!step || !Number.isInteger(step.index) || !Number.isInteger(step.total) || step.index < 1 || step.index > step.total || step.total > MAX_STEPS) return null;
  if (![step.title, step.objective, step.checkQuestion].every((v) => text(v, MAX_FIELD_CHARS))) return null;
  if (!Array.isArray(chunks) || !chunks.length) return null;
  let chars = 0;
  const ids = new Set();
  for (const c of chunks) {
    if (!isId(c?.id) || ids.has(c.id) || typeof c.text !== 'string' || (c.page != null && !Number.isInteger(c.page))) return null;
    ids.add(c.id);
    chars += c.text.length;
  }
  if (chars > MAX_DOC_CHARS) return null;
  // After an answer the request carries that step's key points; an opening never does.
  const after = transition !== 'opening';
  const answeredStep = after && (answered !== undefined || transition !== 'recap') ? validAnswered(answered) : undefined; // a recap may omit it
  if (answeredStep === null || (transition === 'nudge' && answeredStep.pointsMet.length === answeredStep.expected.length)) return null;
  if (transition === 'recap' && !(recap && textList(recap.mastered, MAX_FIELD_CHARS, MAX_STEPS) && textList(recap.revealed, MAX_FIELD_CHARS, MAX_STEPS))) return null;
  const { language = null, audience = null, style = null, documentLanguage = null } = lesson;
  return {
    preset, model: teacher?.trim() || PRESETS[preset].teacher, transition,
    lesson: { language, audience, style, documentLanguage },
    step: { index: step.index, total: step.total, title: step.title, objective: step.objective, checkQuestion: step.checkQuestion },
    chunks,
    ...(answeredStep && { answered: answeredStep }),
    ...(transition === 'recap' && { recap: { mastered: recap.mastered, revealed: recap.revealed } }),
  };
}

// Calls `onText` with the text of each delta of an OpenAI-style event stream. Returns whether any arrived.
async function readDeltas(body, onText) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let any = false;
  const line = (raw) => {
    if (!raw.startsWith('data:')) return;
    let delta;
    try { delta = JSON.parse(raw.slice(5)).choices?.[0]?.delta?.content; } catch { return; } // [DONE], keep-alives
    if (typeof delta === 'string' && delta) { any = true; onText(delta); }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(line);
    }
    line(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
  return any;
}

// POST /api/teach { preset, teacher?, transition, lesson: { language, audience, style, documentLanguage },
// step: { index, total, title, objective, checkQuestion }, chunks, answered?, recap? } with X-Api-Key.
// `answered` ({ title, checkQuestion, expected, pointsMet }) is the step the student just answered, and `recap`
// ({ mastered, revealed }, step titles) the outcome of the lesson; the server picks which key points the
// transition gets from `expected` and `pointsMet`.
// A rejected request is a plain 400. Otherwise an event stream: `start` { id }, `{ text }` chunks, then
// `done` or `error` { error: code }. The id works with POST /api/streams/:id/cancel.
export function teachRouter(fetchImpl, log, streams, streamMaxMs) {
  const router = Router();
  router.post('/teach', async (req, res) => {
    const request = validateRequest(req.body);
    if (!request) return res.status(400).json({ code: 'invalid_request' });
    const apiKey = req.get('X-Api-Key')?.trim();
    if (!apiKey) return res.status(401).json({ code: 'invalid_key' });

    const stream = openStream(req, res, { log, streams, maxMs: streamMaxMs });
    try {
      const response = await chatCompletion({
        preset: request.preset, apiKey, model: request.model, messages: buildTeachMessages(request),
        maxCompletionTokens: TEACH_OUTPUT_TOKENS, stream: true, temperature: 1, signal: stream.signal,
      }, fetchImpl);
      const code = await providerOutcome(response);
      if (code !== 'ok') return stream.end(code);
      if (!response.body) return stream.end('unreachable');
      const any = await readDeltas(response.body, (t) => stream.write({ text: t }));
      stream.end(any ? 'done' : 'unreachable');
    } catch {
      stream.end('unreachable'); // network failure, or the stream already ended (cancel, cap, a client that left)
    }
  });
  return router;
}
