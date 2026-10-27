# Decisions

What I chose, why, and what I left out. *Planned* means settled but not built yet. Larger architectural choices get a short ADR in `docs/adr/`.

## How decisions are made

- **Design before code.** A grilling session tested every open question in the brief before any code was written. It produced the initial decisions below.
- **A decision map before agents.** I split the assignment into 11 components (scope, hosting, provider, API key and safety, file ingestion, planning, tutor loop, lesson state, streaming, UI states, evidence) and marked each question settled, to decide, or to verify. A component goes to an AI coding agent only when nothing in it is open, so the agent never fills gaps with guesses. At the start, 45 of 89 items were open, most in the tutor loop and UI.
- **Scope first.** Scope was settled before anything else. Core features land first. Extras come after, as clearly labelled `feat(extra): …` commits, so the history shows what core alone delivers. Work is tracked as GitHub issues: one parent issue per vertical slice, with small implementation tickets (one concern, one PR, acceptance criteria and tests) as its sub-issues.
- **AI assistance.** I make and review every decision. AI agents write most of the code from those decisions. The lesson state machine is test-first.

## Initial decisions (planned)

| Area | Decision | Why |
|---|---|---|
| Architecture | Three layers: `ai/` (server: provider adapter, prompts, output validation), `lesson/` (pure JS state machine), `ui/` (React). | Separation the brief asks for. Lesson logic is testable without React or network. |
| Lesson state | Client owns plan and progress, saved in IndexedDB. Server is stateless. API key never saved. | Survives refreshes and free-tier cold starts. |
| Tutor loop | Per student message: a small JSON evaluation call (`correct`, `partial`, `wrong`, `asks_for_answer`, `off_topic`, `question`), code picks the transition, then a streamed teaching reply. | The model proposes, code decides. One call with a JSON header was brittle across providers. |
| Teaching policy | Reveal after two failed attempts. "Just tell me" gets one scaffold first. Off-topic doesn't count as an attempt. End recap: mastered vs revealed. | Baseline, tuned during build. |
| Grounding | Chunk = one page, split at ~1,500 chars, with id and page. Citations are the evaluator's chunk ids, checked against the current step. | No invented citations. The UI can show the source passage. |
| Planning | Constraints (language, audience, style, minutes) extracted as JSON. Code sets steps: ~2.5 min each, 3–10, default 5. Read-only plan screen with Start and Regenerate. | Lesson length is a rule, so it is testable. |
| Provider | One OpenAI-compatible adapter with presets: Gemini (default), Groq, OpenRouter, OpenAI. Separate evaluator and teacher models. | Works with the reviewer's key. Evaluator can be cheaper. |
| File types | PDF (text layer), TXT, MD, DOCX. PDF read in the browser with pdf.js. Scans get a clear "no readable text" error until vision transcription lands as the first extra. | The server never receives the file, so requests stay small. |
| Long documents | Hard cap with a "using pages 1–N of M" banner. Outline-first planning is an extra. | No crash or timeout on long files. |
| Hosting | Google Cloud Run, one container, Express serves the front end, max one instance. | One URL, no CORS. |
| Streaming and stop | POST + `fetch` stream, `AbortController`. Server aborts the provider call on disconnect. Stop keeps the lesson state and saves the partial reply; Regenerate re-runs only the reply. | Saves cost; state is never half-applied. |
| UI language | English UI, `dir="auto"` on all content. | Right-to-left material renders correctly. |
| Evidence | Unit tests for the state machine, plus a scripted-student harness running ~5 scenarios. | "It looked fine to me" is not enough. |

## Libraries

- **express** (runtime): HTTP server; serves the built client and the API.
- **vite**, **@vitejs/plugin-react** (dev): client build and dev server.
- **react**, **react-dom** (dev): UI, bundled into `client/dist` at build time, so the production image does not need them.
- **tailwindcss**, **@tailwindcss/vite** (dev): styling, as the brief requires.
- Tests use the built-in `node:test` runner and global `fetch`; no test framework.
- Dev runs the API and Vite together with a small Node script (`scripts/dev.js`) rather than adding `concurrently`.

## Not doing

- **Free-text provider URL:** SSRF risk on Cloud Run's metadata server. URLs are hardcoded presets.
- **Fallback key from the host environment:** anyone on the public URL would spend the owner's quota.
- **Accounts, database, multiple files, voice, teacher analytics:** out of scope. So teacher and student share one browser session; a lesson can't move to a student's device.
