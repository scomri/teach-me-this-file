// Plan request and plan helpers. No React.
import { MAX_DOC_CHARS, MINUTES_PER_STEP } from '../../shared/limits.js';
import { detectScript } from './ingest/script.js';

export class PlanError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Asks the server for a plan. Throws PlanError with the server's code, or
// 'document_too_long' / 'unreachable' decided here.
export async function requestPlan({ doc, prompt, settings, signal }, fetchImpl = fetch) {
  if (doc.chunks.reduce((n, c) => n + c.text.length, 0) > MAX_DOC_CHARS) throw new PlanError('document_too_long');
  let response;
  try {
    response = await fetchImpl('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey },
      body: JSON.stringify({
        preset: settings.preset,
        teacher: settings.teacher,
        prompt,
        script: detectScript(doc.chunks.map((c) => c.text).join('\n')).script,
        chunks: doc.chunks.map(({ id, page, text }) => ({ id, page, text })),
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
  if (!response.ok) throw new PlanError(body.code ?? (response.status === 413 ? 'document_too_long' : 'unreachable'));
  if (!body.plan || !body.constraints) throw new PlanError('plan_invalid');
  return body;
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
