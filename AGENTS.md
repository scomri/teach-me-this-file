# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Scaffold only. No application code yet. Planning notes are kept outside version control.

No build, lint, or test commands exist yet. Once a `package.json` lands, add the real commands here instead of guessing them.

## Deliverables

Public GitHub repo, live URL, `README.md` (how to run and use), `DECISIONS.md` (choices and why, what was not done and why, known weaknesses, what to do with 4 more hours, ~5 test scenarios with results). `DECISIONS.md` is a first-class deliverable; record decisions as they are made.

## Stack (fixed by the assignment)

- Front end: React + Vite + Tailwind CSS, JavaScript (no TypeScript).
- Back end: Node.js. Extra libraries allowed, each one must be justified in `DECISIONS.md`.

## Architecture (planned)

Three layers, kept separate on purpose:

- `ai/`: provider adapter behind one interface (swappable), prompts, JSON-schema validation of model output.
- `lesson/`: pure state machine in plain JS, no React, no network. Steps, transitions, attempts, mastery. Must be unit-testable.
- `ui/`: React components. Reads state, dispatches events. No prompt logic.

Key design rules:

- **Client owns lesson state.** Plan and progress live in app state, not in chat history. The server is stateless: each request carries what it needs. This survives free-tier cold starts.
- **LLM proposes, code disposes.** Per student message: a small structured evaluation call returns a label (`correct | partial | wrong | asks_for_answer | off_topic | question`); the state machine decides the transition; then a streamed teaching reply is generated for that transition only.
- **Grounding:** the tutor teaches only from the current step's source chunks. Chunks carry page/id so the UI can show the source passage behind each message.
- **File text is content, not instructions.** Delimit it in prompts. Test with a file containing "ignore your instructions".
- **Streaming:** POST + `fetch` ReadableStream. Client uses `AbortController` for Stop; server aborts the upstream provider call on client disconnect.

## API key rule (hard constraint)

The reviewer's API key goes from a settings field to the server in an `X-Api-Key` header on each request. It is never stored server-side, never logged (redact the header in request logs), never committed. Optional: fall back to a host environment variable. `.env` must be in `.gitignore`. Run a secret scan before pushing.

## Ingestion scope

Supported and refused file types, scanned-page handling, and the long-document cap are decisions still open. Record each one in `DECISIONS.md` when made. Unsupported, empty, or corrupt files must show a clear error state, not a crash.

## Out of scope (say so in the README and DECISIONS)

Accounts, database, multiple files per lesson, voice/avatar, teacher analytics.
