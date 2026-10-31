// Lesson state and its reducer. Pure: no React, no network.
//   plan null      -> setup
//   progress null  -> plan review
// There is no phase field; the screen follows from these two.

export function initialLesson() {
  return {
    version: 1,
    source: null, // the ingested file, as ingestFile returns it
    teacher: { prompt: '', constraints: null },
    plan: null, // { title, steps, coverage, coverageNote }
    progress: null,
    messages: [],
  };
}

// Back to plan-less: what was planned for, and anything taught from it, goes with the plan.
const withoutPlan = (state) => ({ ...state, teacher: { ...state.teacher, constraints: null }, plan: null, progress: null, messages: [] });

export function reduce(state, event) {
  switch (event.type) {
    case 'fileRead': // source null: a pick started or failed. A new file keeps the typed prompt.
      return { ...withoutPlan(state), source: event.source };
    case 'promptChanged':
      return { ...state, teacher: { ...state.teacher, prompt: event.prompt } };
    case 'planReceived': {
      const { plan, constraints, coverage, coverageNote } = event;
      const next = withoutPlan(state);
      return { ...next, teacher: { ...next.teacher, constraints }, plan: { ...plan, coverage, coverageNote } };
    }
    case 'planCleared':
      return withoutPlan(state);
    case 'newLesson':
      return initialLesson();
    default:
      throw new Error(`Unknown lesson event: ${event.type}`);
  }
}
