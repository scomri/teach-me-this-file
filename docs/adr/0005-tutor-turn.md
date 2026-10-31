# ADR 0005: Code chooses each tutor transition

## Context

A tutor must respond to student messages while keeping progress independent of the model's prose and of a stateless server. Document and student text are untrusted, and model output can be malformed.

## Decision

The client owns the plan, progress and messages. For a student message, `POST /api/evaluate` asks the evaluator for a structured intent, key-point indexes and relevant chunk ids. The server validates the result and permits one schema repair. The client reducer combines points across answers, chooses the transition and applies it before `POST /api/teach` streams the corresponding reply. A second schema mismatch becomes an uncounted nudge; provider failures offer Retry. An opening needs only a teaching call.

The server builds prompts from structured request data, fences source and conversation as data, and supplies the current step's passages. A normal student turn makes two provider requests; one schema repair and one shared rate-limit retry bring the maximum to four. Stop preserves the chosen transition; Regenerate repeats only the teaching reply. The lesson is saved in IndexedDB without model settings or the API key.

## Consequences

Progress and retry behavior are testable without a model, survive refresh and do not depend on a server session. Two calls add latency and quota use; evaluations and teaching still depend on model judgment and prompt compliance. The safety floor and answer withholding are prompt rules, not independently verified guarantees. There is no per-step token budget, so large passages can still exhaust provider quotas.
