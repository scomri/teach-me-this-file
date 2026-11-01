// Teach request: one streamed tutor reply. No React.
import { MAX_HISTORY_TURNS, MAX_TUTOR_CHARS } from '../../shared/limits.js';
import { protectsUnansweredPoints } from '../../shared/transitions.js';
import { stepChunks } from './plan.js';

export class TeachError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// The request the server builds the prompt from: the transition, the lesson's stated constraints and the
// step the reply is about with its chunks. Never prompt text. The key points travel as state, never as text
// to show: an opening carries none, and the server picks which a move gets from the points and which are met.
// stepId: the step the reply belongs to (a repeated reply keeps its own step); default the current one.
export function teachRequest({ lesson, transition, settings, stepId = lesson.progress.current }) {
  const { plan, source, teacher, progress } = lesson;
  const i = plan.steps.findIndex((s) => s.id === stepId);
  const step = plan.steps[i];
  const request = {
    preset: settings.preset,
    teacher: settings.teacher,
    evaluator: settings.evaluator,
    transition,
    lesson: { ...teacher.constraints, documentLanguage: source.language },
    step: { index: i + 1, total: plan.steps.length, title: step.title, objective: step.objective, checkQuestion: step.checkQuestion },
    chunks: stepChunks(step, source),
  };
  if (protectsUnansweredPoints(transition)) {
    const met = progress.steps[step.id].pointsMet;
    request.questionValidated = plan.validated === true;
    request.protectedPoints = step.expected.filter((_, n) => !met.includes(n));
  }
  if (transition === 'opening') return request;
  // The step the student just answered: the one before the reply's step when an advance opens the next.
  const answered = transition === 'advance' ? plan.steps[i - 1] : step;
  const { pointsMet, status } = progress.steps[answered.id];
  // The last turns of the answered step, so a second nudge can read the first. A reply being written has no text yet.
  request.history = lesson.messages.filter((m) => m.stepId === answered.id && m.text).slice(-MAX_HISTORY_TURNS)
    .map(({ role, text }) => ({ role, text: role === 'tutor' ? text.slice(-MAX_TUTOR_CHARS) : text }));
  if (!['answer_question', 'redirect'].includes(transition) && (transition !== 'recap' || status === 'mastered')) { // a recap after a reveal has no answer to confirm
    request.answered = { title: answered.title, checkQuestion: answered.checkQuestion, expected: answered.expected, pointsMet };
  }
  if (transition === 'answer_question') request.questionCovered = !!lesson.messages.findLast((m) => m.role === 'student')?.relevantChunkIds?.length;
  if (transition === 'recap') {
    const titles = (wanted) => plan.steps.filter((s) => progress.steps[s.id].status === wanted).map((s) => s.title);
    request.recap = { mastered: titles('mastered'), revealed: titles('revealed') };
  }
  return request;
}

// Streams one reply: onStart(id) when the server names the stream, onText(text) per chunk. Resolves when
// the reply is done. Throws TeachError with the server's code, 'unreachable' for a network failure, or the
// AbortError when `signal` aborted.
export async function streamTeach({ request, apiKey, signal, onStart, onText, turnId }, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('/api/teach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, ...(turnId && { 'X-Turn-Id': turnId }) },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TeachError('unreachable');
  }
  if (!response.ok) {
    const body = await response.json().catch((error) => { if (signal?.aborted) throw error; return {}; });
    throw new TeachError(body.code ?? 'unreachable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new TeachError('unreachable'); // closed without done: a dropped connection
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const block of blocks) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); // text after Stop is dropped
        let name = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) name = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        const payload = data ? JSON.parse(data) : {};
        if (name === 'start') onStart?.(payload.id);
        else if (name === 'error') throw new TeachError(payload.error ?? 'unreachable');
        else if (name === 'done') return;
        else if (typeof payload.text === 'string') onText(payload.text);
      }
    }
  } catch (error) {
    if (error instanceof TeachError || signal?.aborted) throw error;
    throw new TeachError('unreachable'); // a read that failed mid-body
  } finally {
    reader.cancel().catch(() => {});
  }
}

// Asks the server to end a stream and abort its provider call. Behind a proxy, closing the fetch may never
// reach the server, so Stop sends this first. Failure is ignored: the abort that follows still stops the client.
export function cancelStream(id, fetchImpl = fetch) {
  return fetchImpl(`/api/streams/${id}/cancel`, { method: 'POST', keepalive: true }).catch(() => {});
}
