// Plan call: the strict output schema and validation (prompts are in prompts/plan.js). Pure; no network.
// The model proposes a plan; code checks it, assigns step ids and fills constraint defaults.
import { DEFAULT_STEPS, MAX_STEPS, MIN_STEPS, MINUTES_PER_STEP } from '../../shared/limits.js';

// Longest accepted value of each plan field, in characters. Over the cap is rejected, not cut.
export const CAPS = { title: 120, objective: 300, question: 300, point: 200 };
const MAX_CONSTRAINT_CHARS = 100;
export const MAX_POINTS = 3;

const str = { type: 'string' };
const nullable = (type) => ({ type: [type, 'null'] });
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const PLAN_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'lesson_plan',
    strict: true,
    schema: object({
      promptLanguage: str,
      documentLanguage: str,
      constraints: object({ language: nullable('string'), audience: nullable('string'), style: nullable('string'), minutes: nullable('number') }),
      plan: object({
        title: str,
        steps: {
          type: 'array',
          items: object({ title: str, objective: str, chunkIds: { type: 'array', items: str }, checkQuestion: str, expected: { type: 'array', items: str } }),
        },
      }),
    }),
  },
};

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_CONSTRAINT_CHARS) : null);

// Constraints as the teacher stated them, with defaults filled by code.
export function resolveConstraints(reply) {
  const c = reply?.constraints ?? {};
  const minutes = typeof c.minutes === 'number' && Number.isFinite(c.minutes) && c.minutes > 0 ? c.minutes : null;
  const maxSteps = minutes == null ? DEFAULT_STEPS : Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(minutes / MINUTES_PER_STEP)));
  return {
    language: text(c.language) ?? text(reply?.promptLanguage) ?? text(reply?.documentLanguage),
    audience: text(c.audience),
    style: text(c.style),
    minutes,
    maxSteps,
  };
}

const key = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// reply: the parsed model output. chunkIds: Set of ids in the document.
// Returns { ok: true, plan, constraints } or { ok: false, errors } (strings for the repair message).
export function validatePlan(reply, chunkIds) {
  const errors = [];
  const constraints = resolveConstraints(reply);
  const { title, steps } = reply?.plan ?? {};
  const field = (value, cap, label) => {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${label} must be a non-empty string`);
    else if (value.trim().length > cap) errors.push(`${label} is over ${cap} characters`);
    else return value.trim();
  };

  const planTitle = field(title, CAPS.title, 'plan title');
  if (!Array.isArray(steps) || !steps.length) errors.push('plan.steps must be a non-empty array');
  else if (steps.length > constraints.maxSteps) errors.push(`plan has ${steps.length} steps; the ceiling is ${constraints.maxSteps}`);

  const out = [];
  const titles = new Set();
  const sets = new Set();
  for (const [i, s] of (Array.isArray(steps) ? steps : []).entries()) {
    const at = `step ${i + 1}`;
    const stepTitle = field(s?.title, CAPS.title, `${at} title`);
    const objective = field(s?.objective, CAPS.objective, `${at} objective`);
    const checkQuestion = field(s?.checkQuestion, CAPS.question, `${at} checkQuestion`);

    let ids = [];
    if (!Array.isArray(s?.chunkIds) || !s.chunkIds.length || s.chunkIds.some((id) => typeof id !== 'string')) {
      errors.push(`${at} chunkIds must be a non-empty array of strings`);
    } else {
      ids = [...new Set(s.chunkIds)];
      const unknown = ids.filter((id) => !chunkIds.has(id));
      if (unknown.length) errors.push(`${at} uses unknown chunk ids: ${unknown.slice(0, 5).join(', ')}`);
    }

    let expected = [];
    if (!Array.isArray(s?.expected) || s.expected.length < 1 || s.expected.length > MAX_POINTS) {
      errors.push(`${at} expected must have 1 to ${MAX_POINTS} key points`);
    } else {
      expected = s.expected.map((p, j) => field(p, CAPS.point, `${at} expected point ${j + 1}`));
    }

    if (stepTitle) {
      if (titles.has(key(stepTitle))) errors.push(`${at} repeats the title of an earlier step`);
      titles.add(key(stepTitle));
    }
    if (ids.length) {
      const set = [...ids].sort().join(',');
      if (sets.has(set)) errors.push(`${at} uses the same chunks as an earlier step`);
      sets.add(set);
    }
    out.push({ id: `s${i + 1}`, title: stepTitle, objective, chunkIds: ids, checkQuestion, expected });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { title: planTitle, steps: out }, constraints };
}
