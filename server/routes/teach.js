import { Router } from 'express';
import { MAX_ANSWER_CHARS, MAX_HISTORY_TURNS, MAX_MODEL_CHARS, MAX_STEPS, MAX_TUTOR_CHARS, TEACH_OUTPUT_TOKENS, TURN_RATE_LIMIT_RETRIES } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
import { protectsUnansweredPoints } from '../../shared/transitions.js';
import { chatCompletion } from '../ai/adapter.js';
import { checkDisclosure } from '../ai/disclosure.js';
import { providerTelemetry } from '../ai/telemetry.js';
import { CAPS, MAX_POINTS } from '../ai/plan.js';
import { providerOutcome } from '../ai/errors.js';
import { buildTeachMessages, TRANSITIONS } from '../ai/prompts/teach.js';
import { openStream } from '../streams.js';
import { validChunks } from './plan.js';

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
  const { preset, teacher, evaluator, transition, lesson, step, chunks, answered, recap, history, questionCovered, protectedPoints, questionValidated = false, rateLimitRetried = false } = body ?? {};
  if (!Object.hasOwn(PRESETS, preset) || [teacher, evaluator].some((v) => v !== undefined && !text(v, MAX_MODEL_CHARS))) return null;
  if (!Object.hasOwn(TRANSITIONS, transition)) return null;
  if (!lesson || ![lesson.language, lesson.audience, lesson.style, lesson.documentLanguage].every(optional)) return null;
  if (!step || !Number.isInteger(step.index) || !Number.isInteger(step.total) || step.index < 1 || step.index > step.total || step.total > MAX_STEPS) return null;
  if (![step.title, step.objective, step.checkQuestion].every((v) => text(v, MAX_FIELD_CHARS))) return null;
  if (!validChunks(chunks)) return null;
  const protectedReply = protectsUnansweredPoints(transition);
  if (typeof questionValidated !== 'boolean') return null;
  if (protectedReply && (!textList(protectedPoints, CAPS.point, MAX_POINTS) || !protectedPoints.length || protectedPoints.some((p) => !p.trim()))) return null;
  // After an answer the request carries that step's key points; an opening never does.
  if (typeof rateLimitRetried !== 'boolean' || (transition === 'answer_question' && typeof questionCovered !== 'boolean')) return null;
  const after = !['opening', 'answer_question', 'redirect'].includes(transition);
  const answeredStep = after && (answered !== undefined || transition !== 'recap') ? validAnswered(answered) : undefined; // a recap may omit it
  if (answeredStep === null || (['nudge', 'scaffold'].includes(transition) && answeredStep.pointsMet.length === answeredStep.expected.length)) return null;
  if (transition === 'recap' && !(recap && textList(recap.mastered, MAX_FIELD_CHARS, MAX_STEPS) && textList(recap.revealed, MAX_FIELD_CHARS, MAX_STEPS))) return null;
  if (history !== undefined && !(Array.isArray(history) && history.length <= MAX_HISTORY_TURNS && history.every((m) => (m?.role === 'tutor' && text(m.text, MAX_TUTOR_CHARS)) || (m?.role === 'student' && text(m.text, MAX_ANSWER_CHARS))))) return null;
  const { language = null, audience = null, style = null, documentLanguage = null } = lesson;
  return {
    preset, model: teacher?.trim() || PRESETS[preset].teacher, evaluator: evaluator?.trim() || PRESETS[preset].evaluator, transition, protectedPoints, questionValidated,
    lesson: { language, audience, style, documentLanguage },
    step: { index: step.index, total: step.total, title: step.title, objective: step.objective, checkQuestion: step.checkQuestion },
    chunks, questionCovered, rateLimitRetried,
    history: (history ?? []).map(({ role, text }) => ({ role, text })),
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
  let complete = false;
  let incomplete = false;
  const line = (raw) => {
    if (/^event:\s*error\s*$/.test(raw)) { incomplete = true; return; }
    if (!raw.startsWith('data:')) return;
    const data = raw.slice(5).trim();
    if (data === '[DONE]') { complete = true; return; }
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (payload?.error) { incomplete = true; return; }
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === 'stop') complete = true;
    else if (choice?.finish_reason != null) incomplete = true;
    const delta = choice?.delta?.content;
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
  return { any, complete: complete && !incomplete };
}

const fallbacks = {
  en: { general: 'Take another look at the material and try this question:', advance: 'That is correct. Let’s move to the next question:', redirect: 'If you are distressed, please speak to a trusted adult. Let’s return to the material:', answer_question: 'I could not answer that question. Please return to the check question:' },
  he: { general: 'כדאי לעיין שוב בחומר ולנסות לענות על השאלה:', advance: 'נכון. נעבור לשאלה הבאה:', redirect: 'אם קשה לך, כדאי לדבר עם מבוגר שאפשר לסמוך עליו. נחזור לחומר:', answer_question: 'לא הצלחתי לענות על השאלה שלך. נחזור לשאלת הבדיקה:' },
  ar: { general: 'راجع المادة مرة أخرى وحاول الإجابة عن السؤال:', advance: 'إجابتك صحيحة. لننتقل إلى السؤال التالي:', redirect: 'إذا كنت تشعر بالضيق، فتحدث إلى شخص بالغ تثق به. لنعد إلى المادة:', answer_question: 'لم أتمكن من الإجابة عن سؤالك. لنعد إلى سؤال التحقق:' },
};
function fallback({ transition, lesson, step, questionValidated }) {
  const language = (lesson.language ?? lesson.documentLanguage ?? '').trim().toLowerCase();
  const key = /^(he|iw)(-|$)|^(hebrew(?: \([^()]+\))?|עברית)$/.test(language) ? 'he' : /^(ar)(-|$)|^(arabic(?: \([^()]+\))?|العربية|عربي)$/.test(language) ? 'ar' : 'en';
  return `${fallbacks[key][transition] ?? fallbacks[key].general}${questionValidated ? `\n${step.checkQuestion}` : ''}`;
}

// POST /api/teach { preset, teacher?, transition, lesson: { language, audience, style, documentLanguage },
// step: { index, total, title, objective, checkQuestion }, chunks, history?, answered?, recap? } with X-Api-Key.
// `history` is the last turns of the step the student answered: [{ role: 'tutor' | 'student', text }], at most
// MAX_HISTORY_TURNS; the prompt shows them as data.
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

    const telemetry = providerTelemetry(req, 'teach', log, fetchImpl);
    const stream = openStream(req, res, { log, streams, maxMs: streamMaxMs });
    try {
      const options = {
        preset: request.preset, apiKey, model: request.model, messages: buildTeachMessages(request),
        maxCompletionTokens: TEACH_OUTPUT_TOKENS, stream: true, temperature: 1, signal: stream.signal,
      };
      let retried = request.rateLimitRetried;
      const retry = () => { if (retried || TURN_RATE_LIMIT_RETRIES < 1) return false; retried = true; return true; };
      let response = await chatCompletion(options, telemetry.fetch);
      let code = await providerOutcome(response);
      if (code === 'rate_limited' && retry()) {
        response = await chatCompletion(options, telemetry.fetch);
        code = await providerOutcome(response);
      }
      if (code !== 'ok') return stream.end(code);
      if (!response.body) return stream.end('unreachable');
      const protectedReply = protectsUnansweredPoints(request.transition);
      let draft = '';
      const { any, complete } = await readDeltas(response.body, (t) => {
        if (protectedReply) { draft += t; if (draft.length > 20000) throw new Error('draft too long'); }
        else stream.write({ text: t });
      });
      if (!any || (protectedReply && !complete)) return stream.end('unreachable');
      if (protectedReply) {
        let flagged = null;
        try { flagged = await checkDisclosure({ preset: request.preset, apiKey, model: request.evaluator, signal: stream.signal, fetchImpl: telemetry.fetch, retry, candidates: [{ text: draft, keyPoints: request.protectedPoints }] }); } catch { /* fail closed */ }
        if (stream.signal.aborted) return;
        stream.write({ text: flagged?.length === 0 ? draft : fallback(request) });
      }
      stream.end('done');
    } catch {
      stream.end('unreachable'); // network failure, or the stream already ended (cancel, cap, a client that left)
    } finally {
      telemetry.finish();
    }
  });
  return router;
}
