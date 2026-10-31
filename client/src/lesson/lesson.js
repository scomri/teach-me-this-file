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

export function reduce(state, event) {
  switch (event.type) {
    case 'fileRead': // source null: a pick started or failed. A new file keeps the typed prompt.
      return { ...state, source: event.source, teacher: { ...state.teacher, constraints: null }, plan: null, progress: null, messages: [] };
    case 'promptChanged':
      return { ...state, teacher: { ...state.teacher, prompt: event.prompt } };
    case 'planReceived': {
      const { plan, constraints, coverage, coverageNote } = event;
      return { ...state, teacher: { ...state.teacher, constraints }, plan: { ...plan, coverage, coverageNote }, progress: null, messages: [] };
    }
    case 'planCleared':
      return { ...state, teacher: { ...state.teacher, constraints: null }, plan: null, progress: null, messages: [] };
    case 'newLesson':
      return initialLesson();
    default:
      throw new Error(`Unknown lesson event: ${event.type}`);
  }
}
