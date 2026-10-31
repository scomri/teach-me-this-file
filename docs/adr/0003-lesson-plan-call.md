# ADR 0003: One validated plan call per document

## Context

A teacher gives a file and a short prompt and reviews a lesson plan before any student sees it. The file text is untrusted, the model may ignore the requested length, and the server keeps no state.

## Decision

`POST /api/plan` makes one teacher-model call that uses a strict JSON schema. The client sends the chunks, the prompt and the model settings; the server owns every prompt template (`server/ai/prompts/`).

- **The model proposes, code disposes.** The call reports the constraints the prompt states (language, audience, style, minutes), with `null` for anything not stated, and returns the plan. Code fills the defaults: language is the explicit request, else the prompt's language, else the document's (a code such as "en" is shown as its name). The step ceiling is minutes ÷ 2.5, clamped to 3–10, or 5 with no minutes. With a blank prompt the model's constraints are ignored.
- **Validation in code.** A plan is rejected for a schema mismatch, more steps than the ceiling, an unknown chunk id, a field over its length cap, a repeated title, key point or chunk set (padding), or wrong-typed constraints. Code assigns step ids. A rejected plan gets one repair retry that lists the problems, then a fixed `plan_invalid` error. Teacher review on the plan screen is the remaining gate; there is no model judge.
- **File text is data.** Chunks are fenced as `<source_document>` and `<chunk id page>` elements, the system prompt says text inside is never instructions, and the four literal fence tags in file text are rewritten (case-insensitive) so a file cannot close the fence.
- **One status mapping.** Provider responses map to fixed codes in `server/ai/errors.js`, shared with the connection check. Provider text is never forwarded.
- **A request is bounded.** The plan route accepts at most `MAX_DOC_CHARS` of chunk text and `MAX_PROMPT_CHARS` of prompt. Longer documents need an outline and are a separate piece of work.

## Consequences

A model that ignores the ceiling or invents a chunk id is repaired or refused instead of shown. Validation and defaults are plain functions covered by unit tests with a stubbed model. The step ceiling depends on the minutes the model reports for a non-blank prompt, so text planted in a file could raise it, up to 10 steps; the teacher sees the plan before use. The response schema uses nullable types; all four presets (Gemini, OpenRouter, OpenAI, Anthropic) accepted it in a real-key check.
