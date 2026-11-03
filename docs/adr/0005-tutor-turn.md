# ADR 0005: Code chooses each tutor transition

## Context

A tutor must respond to student messages while keeping progress independent of model prose and of a stateless server. Document, student and model-written plan text are untrusted. Questions and hints can reveal unanswered key points even when the prompt asks the model not to do so.

## Decision

The client owns the plan, progress and messages. A validation model screens all plan questions together against their key points before Start; a flagged plan may be repaired once and every question is checked again. Every preset uses the configured teacher model for plan and protected-reply checks; student answers use the evaluator. Restored plans without a validation marker are checked before Start, while lessons already in progress retain their state. A failed or uncertain check blocks Start.

For a student message, `POST /api/evaluate` returns an intent, key-point indexes and relevant chunk ids. The server validates it and permits one schema repair. The client reducer combines points, chooses the transition and applies it before requesting the reply. Protected drafts (opening, advance, nudge, scaffold, answer to a question and redirect) are buffered on the server and checked by the validation model against the current step's unanswered points and source passages. On an advance, previously mastered points can support the confirmation. Only approved text reaches the student; a failed, uncertain or rejected check yields a fixed fallback. Reveal and recap remain streamed. The student can open cited source passages even when they contain answers.

A normal protected turn permits one evaluation, one teaching draft, one disclosure check, one evaluation schema repair and one shared automatic 429 retry: at most five provider requests. An opening or regenerated protected reply permits a draft, a check and one shared 429 retry (at most three requests). A plan allows at most two generations and two disclosure checks; plan checks have no automatic 429 retry. Stop aborts the active operation without reversing the transition; Regenerate repeats only the reply. The lesson is saved in IndexedDB without model settings or the API key.

## Consequences

The checks add latency and cost, including the passage tokens sent to the validation model. They are best effort, not a guarantee: the model may miss a disclosure or unsupported claim, or reject a useful hint. Fallbacks are provided in English, Hebrew and Arabic; unrecognized languages use English. Document, conversation and model-written fields are treated as data, but the safety floor and model judgments still depend on model behavior. There is no per-step token budget, so large passages can exhaust quotas.
