// Lesson state and its reducer. Pure: no React, no network.
//   plan null      -> setup
//   progress null  -> plan review
// Teaching events act on the last tutor message, which is the one being streamed.
// There is no phase field; the screen follows from these two.
import { textDir } from '../ingest/script.js';

const direction = (doc) => textDir(doc.chunks.map((c) => c.text).join('\n'));

const noConstraints = () => ({ language: null, minutes: null, audience: null, style: null });

export function initialLesson() {
  return {
    version: 1,
    // The ingested file as ingestFile returns it, plus dir ('rtl' | 'ltr', from its main script) and
    // language (as the planner names it; null until a plan arrives).
    source: null,
    teacher: { prompt: '', constraints: noConstraints() }, // as the teacher stated them, read by the planner
    // { title, steps, coverage, coverageNote, maxSteps, requested: { steps, outsideSources } }: the step
    // ceiling the plan was made under, and what was asked beyond it, for the plan screen's notes.
    plan: null,
    progress: null,
    messages: [],
  };
}

// Back to plan-less: what was planned for, and anything taught from it, goes with the plan.
const withoutPlan = (state) => ({ ...state, teacher: { ...state.teacher, constraints: noConstraints() }, plan: null, progress: null, messages: [] });

const lastTutor = (state) => state.messages.at(-1)?.role === 'tutor' ? state.messages.at(-1) : null;
const replaceLast = (state, patch) => ({ ...state, messages: [...state.messages.slice(0, -1), { ...state.messages.at(-1), ...patch }] });
const pendingAnswer = (state) => state.messages.at(-1)?.role === 'student' && state.messages.at(-1).intent === null;
const stepAfter = (plan, id) => plan.steps[plan.steps.findIndex((s) => s.id === id) + 1];
const ATTEMPTS = 2; // failed attempts on a step before the tutor reveals the answer
const streamingReply = (stepId, transition, chunkIds) => ({ role: 'tutor', stepId, text: '', transition, chunkIds, status: 'streaming' });

// Grades an evaluation against the current step: the points it adds (a union with earlier answers), the
// result, and the move. Pure.
function grade(state, evaluation) {
  const { plan, progress } = state;
  const id = progress.current;
  const step = plan.steps.find((s) => s.id === id);
  const before = progress.steps[id];
  if (!evaluation) return { intent: 'evaluation_failed', transition: 'nudge', ...before };
  if (evaluation.intent === 'asks_for_answer') {
    const asks = before.asks + 1;
    return { ...before, intent: evaluation.intent, asks, transition: asks >= 2 ? 'reveal' : 'scaffold', status: asks >= 2 ? 'revealed' : 'active' };
  }
  if (evaluation.intent !== 'answer') return { ...before, intent: evaluation.intent, transition: evaluation.intent === 'question' ? 'answer_question' : 'redirect' };
  const met = (evaluation.keyPointsMet ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < step.expected.length);
  const pointsMet = [...new Set([...before.pointsMet, ...met])].sort((a, b) => a - b);
  const next = stepAfter(plan, id);
  if (pointsMet.length === step.expected.length) {
    return { intent: 'answer', result: 'correct', transition: next ? 'advance' : 'recap', pointsMet, fails: before.fails, status: 'mastered', next };
  }
  const fails = pointsMet.length > before.pointsMet.length ? before.fails : before.fails + 1; // a failed attempt adds no point
  const reveal = fails >= ATTEMPTS;
  return { intent: 'answer', result: pointsMet.length ? 'partial' : 'wrong', transition: reveal ? 'reveal' : 'nudge', pointsMet, fails, status: reveal ? 'revealed' : 'active' };
}

export function reduce(state, event) {
  switch (event.type) {
    case 'fileRead': // source null: a pick started or failed. A new file keeps the typed prompt.
      return { ...withoutPlan(state), source: event.source && { ...event.source, language: null, dir: direction(event.source) } };
    case 'promptChanged':
      return { ...state, teacher: { ...state.teacher, prompt: event.prompt } };
    case 'planReceived': {
      const { plan, coverage, coverageNote, documentLanguage } = event;
      const { language = null, minutes = null, audience = null, style = null, steps, outsideSources, maxSteps } = event.constraints ?? {};
      return {
        ...withoutPlan(state),
        source: state.source && { ...state.source, language: documentLanguage ?? null },
        teacher: { ...state.teacher, constraints: { language, minutes, audience, style } },
        plan: { ...plan, coverage, coverageNote, maxSteps, requested: { steps, outsideSources } },
      };
    }
    case 'planValidated':
      return state.plan ? { ...state, plan: { ...state.plan, validated: true } } : state;
    case 'lessonStarted': {
      if (!state.plan || state.plan.validated !== true || state.progress) return state;
      const steps = Object.fromEntries(state.plan.steps.map((s, i) => [s.id, { status: i === 0 ? 'active' : 'pending', pointsMet: [], fails: 0, asks: 0 }]));
      return { ...state, progress: { current: state.plan.steps[0].id, steps }, messages: [] };
    }
    case 'answerSent': { // the student's message; its evaluation comes next
      const { progress } = state;
      // the turn is over only once the tutor's reply is done or stopped (a failed one is retried first)
      if (!progress || progress.steps[progress.current].status !== 'active' || pendingAnswer(state) || (lastTutor(state) && !['done', 'stopped'].includes(lastTutor(state).status))) return state;
      return { ...state, messages: [...state.messages, { role: 'student', stepId: progress.current, text: event.text, intent: null }] };
    }
    case 'evaluated': { // sets the intent, and applies the move to progress before the reply streams
      if (!pendingAnswer(state)) return state;
      const g = grade(state, event.evaluation);
      const message = { ...state.messages.at(-1), intent: g.intent };
      const { current, steps } = state.progress;
      const settled = { ...steps, [current]: { ...steps[current], pointsMet: g.pointsMet, fails: g.fails, asks: g.asks ?? steps[current].asks, status: g.status } };
      if (g.next) settled[g.next.id] = { ...settled[g.next.id], status: 'active' };
      return {
        ...replaceLast(state, { ...message, ...(g.result && { result: g.result }), transition: g.transition, relevantChunkIds: event.evaluation?.relevantChunkIds ?? [] }),
        progress: { current: g.next?.id ?? current, steps: settled },
      };
    }
    case 'continued': { // after a reveal, on to the next step
      const { plan, progress } = state;
      const next = progress && stepAfter(plan, progress.current);
      if (!next || progress.steps[progress.current].status !== 'revealed') return state;
      return { ...state, progress: { current: next.id, steps: { ...progress.steps, [next.id]: { ...progress.steps[next.id], status: 'active' } } } };
    }
    case 'teachStarted':
      if (!state.progress) return state;
      return { ...state, messages: [...state.messages, streamingReply(event.stepId, event.transition, event.chunkIds)] };
    case 'teachChunk': // chunks append to the reply being streamed
      return lastTutor(state)?.status === 'streaming' ? replaceLast(state, { text: lastTutor(state).text + event.text }) : state;
    case 'teachDone':
    case 'teachStopped': // Stop keeps the text so far
    case 'teachFailed':
      return lastTutor(state)?.status === 'streaming' ? replaceLast(state, { status: { teachDone: 'done', teachStopped: 'stopped', teachFailed: 'failed' }[event.type] }) : state;
    case 'regenerate': { // Retry is the same event: the stored transition runs again, progress is not touched
      const last = lastTutor(state);
      if (!last || last.status === 'streaming') return state;
      return replaceLast(state, streamingReply(last.stepId, last.transition, last.chunkIds));
    }
    case 'planCleared':
      return withoutPlan(state);
    case 'newLesson':
      return initialLesson();
    default:
      return state;
  }
}

// Persistence helpers (pure). The record is the lesson state and nothing else: never the API key or settings.
export const savedRecord = (s) => ({ version: s.version, source: s.source, teacher: s.teacher, plan: s.plan, progress: s.progress, messages: s.messages });

// A loaded record becomes a lesson, or null. discarded: something was saved but cannot be used (wrong version).
// A reply cut off by a reload was streaming; it comes back stopped with the text saved so far.
export function normalizeSaved(saved) {
  if (saved == null) return { lesson: null, discarded: false };
  if (typeof saved !== 'object' || saved.version !== initialLesson().version || !Array.isArray(saved.messages) || typeof saved.teacher !== 'object' || saved.teacher === null) return { lesson: null, discarded: true };
  const messages = saved.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m));
  return { lesson: { ...savedRecord(saved), messages }, discarded: false };
}

// The lesson is stored as two records so that typing does not copy the whole document: the file by itself,
// and everything else with a flag saying whether a file belongs to it.
export function splitSaved(lesson) {
  const { source, ...rest } = savedRecord(lesson);
  return { main: { ...rest, hasSource: source != null }, source };
}

// The two records back into one saved object for normalizeSaved. undefined: nothing saved. A pair that does not
// belong together (one missing, or the flag disagrees) is {}, which normalizeSaved discards.
export function joinSaved(main, source) {
  if (main == null && source == null) return undefined;
  if (main == null || typeof main !== 'object' || main.hasSource !== (source != null)) return {};
  const { hasSource, ...rest } = main;
  return { ...rest, source: source ?? null };
}
