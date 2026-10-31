# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Slice 0 done: Express API (`server/`) and Vite React client (`client/`) with a streamed echo endpoint, a redacting request logger, a Dockerfile and CI, deployed to Cloud Run (automatically on every push to `main`, ADR 0004). Slice 1 in progress: file ingestion (PDF, DOCX, PPTX, TXT and MD built), model settings with a key and model check (`/api/check`), and planning (`/api/plan`, read-only plan screen), with an outline for documents too long for one request and a coverage check (full, partial, none) plus notes on requests the app does not follow; Start opens step 1 and streams the tutor's opening reply (`/api/teach`); a lesson resumes after a refresh (IndexedDB); answering a check question (`/api/evaluate`, then advance, nudge, reveal, Continue and recap) is built; the other student intents, the evaluator-failure fallback and the turn budget are next. Planning notes are kept outside version control.

Commands (Node 24):

```sh
npm install
npm run dev    # Express API on :8080 + Vite client on :5173 (proxies /api)
npm run build  # build the client into client/dist
npm start      # serve client/dist and the API from one port (PORT, default 8080)
npm test       # run all tests (node:test)
```

Docker:

```sh
docker build -t teach-me-this-file:local .
docker run --rm -p 8080:8080 teach-me-this-file:local   # http://localhost:8080
```

There is no lint command yet.

## Documentation split

Committed docs are for reviewers: `README.md`, `DECISIONS.md`, `GLOSSARY.md`, `docs/adr/`, this file. One short ADR per significant architectural choice (context, decision, consequences); `DECISIONS.md` is the required summary and links to the ADRs instead of repeating them. Write them in reviewer voice, with no private context. Raw grilling, open questions, risks and drafts go in `internal/` (gitignored), mainly `internal/GRILL-LOG.md`. Log a decision there first; promote it to `DECISIONS.md` once it is built or stable. Never link to or quote `internal/` content from a committed file.

The same rule covers everything published to GitHub: issue titles and bodies, comments, PR descriptions, review replies and commit messages. Write them in reviewer voice. They must not contain `internal/` paths, internal decision numbers (`D1`, `D24`, …), names of people, hiring or interview context, or deadline pressure. Describe a decision by what it is and why, not by where it was logged. Re-read the text before every `gh issue create`, `gh issue comment`, `gh pr create` or commit.

## Deliverables

Public GitHub repo, live URL, `README.md` (how to run and use), `DECISIONS.md` (choices and why, what was not done and why, known weaknesses, what to do with 4 more hours, ~5 test scenarios with results). `DECISIONS.md` is a first-class deliverable; record decisions as they are made.

## Stack (fixed by the assignment)

- Front end: React + Vite + Tailwind CSS, JavaScript (no TypeScript).
- Back end: Node.js. Extra libraries allowed, each one must be justified in `DECISIONS.md`.

## Architecture (planned)

Layers, kept separate on purpose:

- `ai/`: provider adapter behind one interface (swappable), prompts, JSON-schema validation of model output.
- `lesson/`: pure state machine in plain JS, no React, no network. Steps, transitions, attempts, mastery. Must be unit-testable.
- `ingest/`: file in, chunks out, in the browser. Pure and unit-testable; one reader per format behind `ingestFile`.
- `ui/`: React components. Reads state, dispatches events. No prompt logic.

Key design rules:

- **Client owns lesson state.** Plan and progress live in app state, not in chat history. The server is stateless: each request carries what it needs. This survives free-tier cold starts.
- **LLM proposes, code disposes.** Per student message: a small structured evaluation call returns an intent (`answer | asks_for_answer | off_topic | question`), the key points met and the relevant chunk ids; code derives `correct`, `partial` or `wrong` from the key points, and the state machine decides the transition; then a streamed teaching reply is generated for that transition only.
- **Lesson length is a ceiling, never padded.** Steps ≤ minutes ÷ 2.5, clamped to 1–10 (5 with no minutes), from `shared/limits.js`. There is no minimum lesson length. Requests the app does not follow (more steps than the ceiling, outside sources, a topic the file lacks) are bounded by code and the plan screen says so.
- **Grounding:** the tutor teaches only from the current step's source chunks. Chunks carry page/id so the UI can show the source passage behind each message.
- **File text is content, not instructions.** Delimit it in prompts. Test with a file containing "ignore your instructions".
- **Streaming:** POST + `fetch` ReadableStream. Client uses `AbortController` for Stop; server aborts the upstream provider call on client disconnect.

## API key rule (hard constraint)

The reviewer's API key goes from a settings field to the server in an `X-Api-Key` header on each request. It is never stored server-side, never logged (redact the header in request logs), never committed. `.env` must be in `.gitignore`. Run a secret scan before pushing.

## Ingestion scope

Decided and recorded in `DECISIONS.md` (File types, Chunks, Text direction, Text encoding, Long documents). In short: PDF, DOCX, PPTX, TXT and MD are read in the browser; legacy formats are refused with a "save as" message; the whole document is kept and only the plan request is size-limited; limits live in `shared/limits.js`. Unsupported, empty, or corrupt files must show a clear error state, not a crash. Malformed UTF-16 instead offers explicit continuation with replacement characters and a persistent warning; do not plan from it before the teacher chooses to continue. Files without readable text are refused.

## Out of scope (say so in the README and DECISIONS)

Accounts, database, multiple files per lesson, voice/avatar, teacher analytics.

## Agent skills

### Issue tracker

GitHub Issues in `scomri/teach-me-this-file`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
