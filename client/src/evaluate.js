// Evaluate request: one classification of the student's message. No React.
import { MAX_TUTOR_CHARS } from '../../shared/limits.js';
import { stepChunks } from './plan.js';

export class EvaluateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// The request for the student's `message` on the current step: the step's objective, question and key
// points, its chunks, the tutor's last message and every earlier message on this step that was an answer.
export function evaluateRequest({ lesson, message, settings }) {
  const { plan, source, progress, messages } = lesson;
  const step = plan.steps.find((s) => s.id === progress.current);
  return {
    preset: settings.preset,
    evaluator: settings.evaluator,
    step: { objective: step.objective, checkQuestion: step.checkQuestion, expected: step.expected },
    chunks: stepChunks(step, source),
    lastTutor: (messages.findLast((m) => m.role === 'tutor')?.text ?? '').slice(-MAX_TUTOR_CHARS), // the tail holds the question
    earlier: messages.filter((m) => m.role === 'student' && m.stepId === step.id && m.intent === 'answer').map((m) => m.text),
    message,
  };
}

// Resolves with { intent, keyPointsMet, relevantChunkIds }. Throws EvaluateError with the server's code,
// 'evaluation_invalid' when the server could not get a valid evaluation (null), 'unreachable' for a network
// failure or a reply that is not an evaluation, or the AbortError when `signal` aborted.
export async function requestEvaluation({ lesson, message, settings, signal }, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey },
      body: JSON.stringify(evaluateRequest({ lesson, message, settings })),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new EvaluateError('unreachable');
  }
  const body = await response.json().catch((error) => { if (signal?.aborted) throw error; return {}; });
  if (!response.ok) throw new EvaluateError(body.code ?? 'unreachable');
  if (body.evaluation === null) throw new EvaluateError('evaluation_invalid');
  if (!body.evaluation) throw new EvaluateError('unreachable');
  return body.evaluation;
}
