// Only answer reveals and final recaps may state all key points.
export const protectsUnansweredPoints = (transition) => !['reveal', 'recap'].includes(transition);

// Replies that open a step: they explain its idea, then ask its check question.
export const opensStep = (transition) => ['opening', 'advance'].includes(transition);
