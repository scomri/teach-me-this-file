// Limits shared by the client and the server.

// Maximum characters of document text sent in one plan request. Preset planning
// budgets may select an outline sooner.
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

// Largest model output of one tutor reply, in tokens. About 120 words; the rest is headroom for
// models that count reasoning tokens against the same cap.
export const TEACH_OUTPUT_TOKENS = 2048;

// Longest model name a settings field or request may carry, in characters.
export const MAX_MODEL_CHARS = 200;

// Longest teacher prompt, in characters.
export const MAX_PROMPT_CHARS = 2000;

// Longest student message, in characters. The composer counts it live and the server answers 400 over it.
export const MAX_ANSWER_CHARS = 1000;

// Largest model output of one evaluation (a label, point indexes and chunk ids), in tokens. Mostly
// headroom for models that count reasoning tokens against the same cap.
export const EVALUATE_OUTPUT_TOKENS = 2048;

// One evaluation, one teaching reply, one schema repair and one shared rate-limit retry.
export const TURN_MAX_PROVIDER_REQUESTS = 4;
export const TURN_RATE_LIMIT_RETRIES = 1;
export const EVALUATION_MAX_ATTEMPTS = TURN_MAX_PROVIDER_REQUESTS - TURN_RATE_LIMIT_RETRIES - 1;

// Longest tutor message the evaluate and teach requests carry, in characters: a reply can reach about 8,000
// (TEACH_OUTPUT_TOKENS), so the client sends only the tail, which holds the question the reply ends with.
export const MAX_TUTOR_CHARS = 5000;

// Turns of the current step (tutor and student messages) a teach request carries as conversation.
export const MAX_HISTORY_TURNS = 8;
