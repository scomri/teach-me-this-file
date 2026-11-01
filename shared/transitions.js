// Only answer reveals and final recaps may state all key points.
export const protectsUnansweredPoints = (transition) => !['reveal', 'recap'].includes(transition);
