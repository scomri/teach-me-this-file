// Lesson state and its reducer. Pure: no React, no network.
//   plan null      -> setup
//   progress null  -> plan review
// There is no phase field; the screen follows from these two.

const noConstraints = () => ({ language: null, minutes: null, audience: null, style: null });

export function initialLesson() {
  return {
    version: 1,
    source: null, // the ingested file, as ingestFile returns it
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
      return { ...withoutPlan(state), source: event.source };
    case 'promptChanged':
      return { ...state, teacher: { ...state.teacher, prompt: event.prompt } };
    case 'planReceived': {
      const { plan, coverage, coverageNote } = event;
      const { language, minutes, audience, style, steps, outsideSources, maxSteps } = event.constraints;
      return {
        ...withoutPlan(state),
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
