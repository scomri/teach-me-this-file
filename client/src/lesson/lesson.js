// Lesson state and its reducer. Pure: no React, no network.
//   plan null      -> setup
//   progress null  -> plan review
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
    case 'planCleared':
      return withoutPlan(state);
    case 'newLesson':
      return initialLesson();
    default:
      return state;
  }
}
