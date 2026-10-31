// Lesson state and its reducer. Pure: no React, no network.
//   plan null      -> setup
//   progress null  -> plan review
// Teaching events act on the last tutor message, which is the one being streamed.
// There is no phase field; the screen follows from these two.
import { detectScript } from '../ingest/script.js';

const direction = (doc) => (detectScript(doc.chunks.map((c) => c.text).join('\n')).rtl ? 'rtl' : 'ltr');

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
const streamingReply = (stepId, transition, chunkIds) => ({ role: 'tutor', stepId, text: '', transition, chunkIds, status: 'streaming' });

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
    case 'lessonStarted': {
      if (!state.plan || state.progress) return state;
      const steps = Object.fromEntries(state.plan.steps.map((s, i) => [s.id, { status: i === 0 ? 'active' : 'pending', pointsMet: [], fails: 0, asks: 0 }]));
      return { ...state, progress: { current: state.plan.steps[0].id, steps }, messages: [] };
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
  if (typeof saved !== 'object' || saved.version !== initialLesson().version || !Array.isArray(saved.messages)) return { lesson: null, discarded: true };
  const messages = saved.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m));
  return { lesson: { ...savedRecord(saved), messages }, discarded: false };
}
