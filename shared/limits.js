// Limits shared by the client and the server.

// Characters of document text sent in one plan request (default; presets with small
// free tiers use less). Larger documents are planned from an outline instead.
// The whole document is always kept on the client.
export const MAX_DOC_CHARS = 100_000;

// Tokens a plan request spends beyond the document: the longest completion the plan call asks for,
// and the system prompt, the teacher's prompt and the response schema.
export const PLAN_OUTPUT_TOKENS = 8192;
export const PLAN_OVERHEAD_TOKENS = 3000;

// Largest file the picker accepts. It also bounds how much text a document can hold.
export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// Largest JSON request body, in bytes: MAX_DOC_CHARS at up to 4 bytes per character
// (3 for most non-Latin BMP scripts, plus JSON escaping) and 100 KiB for the prompt and settings.
export const MAX_BODY_BYTES = MAX_DOC_CHARS * 4 + 100 * 1024;

// Lesson length: a step takes about MINUTES_PER_STEP; a plan has MIN_STEPS to MAX_STEPS
// steps, DEFAULT_STEPS when the teacher's prompt states no minutes.
export const MINUTES_PER_STEP = 2.5;
export const MIN_STEPS = 1;
export const MAX_STEPS = 10;
export const DEFAULT_STEPS = 5;

// Steps a lesson of this many minutes asks for, before the MIN_STEPS to MAX_STEPS clamp.
export const stepsForMinutes = (minutes) => Math.round(minutes / MINUTES_PER_STEP);

// Longest model name a settings field or request may carry, in characters.
export const MAX_MODEL_CHARS = 200;

// Longest teacher prompt, in characters.
export const MAX_PROMPT_CHARS = 2000;
