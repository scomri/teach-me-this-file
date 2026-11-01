// Plan request and plan helpers. No React.
import { MAX_STEPS, MINUTES_PER_STEP, stepsForMinutes } from '../../shared/limits.js';
import { detectScript } from './ingest/script.js';
import { planBudget, planInput } from './outline.js';

export class PlanError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Asks the server for a plan: { plan, constraints, coverage, coverageNote }, with plan null when coverage
// is 'none'. The request carries the whole text, or an outline when it does not fit the preset's budget.
// wholeFile asks for the document's main ideas without the prompt's topic. Throws PlanError with the
// server's code, or 'document_too_long' (any 413) / 'unreachable' decided here.
export async function requestPlan({ doc, prompt, settings, wholeFile = false, signal }, fetchImpl = fetch) {
  const script = detectScript(doc.chunks.map((c) => c.text).join('\n')).script;
  let response;
  try {
    response = await fetchImpl('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey },
      body: JSON.stringify({
        preset: settings.preset,
        teacher: settings.teacher,
        evaluator: settings.evaluator,
        prompt,
        script,
        ...planInput(doc.chunks, script, planBudget(settings.preset)),
        ...(wholeFile && { wholeFile }),
      }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PlanError('unreachable');
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error; // an abort while reading the body is not an empty reply
    body = {};
  }
  if (!response.ok) { const error = new PlanError(body.code ?? (response.status === 413 ? 'document_too_long' : 'unreachable')); error.flagged = body.flagged; error.role = body.role; throw error; }
  if (!body.constraints || (body.coverage !== 'none' && !body.plan)) throw new PlanError('plan_invalid');
  return body;
}

export async function checkPlan({ plan, settings, signal }, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('/api/plan/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey }, body: JSON.stringify({ preset: settings.preset, teacher: settings.teacher, evaluator: settings.evaluator, steps: plan.steps.map(({ checkQuestion, expected }) => ({ checkQuestion, expected })) }), signal });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.flagged)) { const error = new PlanError(body.code ?? 'plan_invalid'); error.role = body.role; throw error; }
    if (body.flagged.length) { const error = new PlanError('plan_invalid'); error.flagged = body.flagged.map((i) => i + 1); throw error; }
  } catch (error) { if (signal?.aborted || error instanceof PlanError) throw error; throw new PlanError('plan_check_failed'); }
}

// The step's chunks as the evaluate and teach requests carry them.
export function stepChunks(step, doc) {
  const byId = new Map(doc.chunks.map((c) => [c.id, c]));
  return step.chunkIds.map((id) => byId.get(id)).filter(Boolean).map(({ id, page, text }) => ({ id, page, text }));
}

// Where a step's chunks come from: "page 2, 3", "slide 1", or '' for formats without pages.
export function sourcePages(step, doc) {
  const byId = new Map(doc.chunks.map((c) => [c.id, c]));
  const pages = new Map();
  for (const id of step.chunkIds) {
    const c = byId.get(id);
    if (c?.page != null) pages.set(c.page, c.pageLabel ?? c.page);
  }
  if (!pages.size) return '';
  const labels = [...pages].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  return `${doc.kind === 'pptx' ? 'slide' : 'page'}${labels.length > 1 ? 's' : ''} ${labels.join(', ')}`;
}

export const estimatedMinutes = (plan) => Math.round(plan.steps.length * MINUTES_PER_STEP);

// Where the plan differs from what the teacher asked for, for the plan screen. The plan is never padded and
// code applies the limits, so each note says which request was not followed, and why. The plan carries
// its step ceiling and the requests it bounded (see lesson/lesson.js); the constraints carry the minutes.
export function requestNotes(plan, constraints) {
  const { minutes } = constraints;
  const { maxSteps, requested: { steps, outsideSources } } = plan;
  const n = plan.steps.length;
  const length = (count) => `${count} ${count === 1 ? 'step' : 'steps'} (~${Math.round(count * MINUTES_PER_STEP)} min)`;
  const notes = [];
  if (minutes != null) {
    if (n < maxSteps && estimatedMinutes(plan) < minutes) {
      notes.push(`This file supports ${length(n)}, shorter than the ${minutes} min requested`);
    } else if (stepsForMinutes(minutes) > MAX_STEPS) {
      notes.push(`${minutes} min requested, capped at ${length(MAX_STEPS)}`);
    }
  }
  if (steps != null && steps > maxSteps) notes.push(`${steps} steps requested, capped at ${length(maxSteps)}`);
  if (outsideSources) notes.push('Outside sources were requested. The lesson teaches only from the file.');
  return notes;
}
