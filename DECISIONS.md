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
| Architecture | Layers: `ai/` (server: provider adapter, prompts, output validation), `lesson/` (pure JS state machine), `ui/` (React). File reading sits in `ingest/` (pure, in the browser). | Separation the brief asks for. Lesson and ingestion logic are testable without React or network. |
| Lesson state | Client owns plan and progress, saved in IndexedDB. Server is stateless. API key never saved. | Survives refreshes and free-tier cold starts. |
| Tutor loop | Per student message: a small JSON evaluation call (`correct`, `partial`, `wrong`, `asks_for_answer`, `off_topic`, `question`), code picks the transition, then a streamed teaching reply. | The model proposes, code decides. One call with a JSON header was brittle across providers. |
| Teaching policy | Reveal after two failed attempts. "Just tell me" gets one scaffold first. Off-topic doesn't count as an attempt. End recap: mastered vs revealed. | Baseline, tuned during build. |
| Grounding | Every message teaches from chunks of the source (see Chunks below). Citations are the evaluator's chunk ids, checked against the current step. | No invented citations. The UI can show the source passage. |
| Planning | Constraints (language, audience, style, minutes) extracted as JSON. Code sets steps: ~2.5 min each, 3–10, default 5. Read-only plan screen with Start and Regenerate. | Lesson length is a rule, so it is testable. |
| Provider | One OpenAI-compatible adapter with presets: Gemini (default), Groq, OpenRouter, OpenAI. Separate evaluator and teacher models. | Works with the reviewer's key. Evaluator can be cheaper. |
| File types | PDF (text layer), DOCX, PPTX, TXT, MD, all in the first slice, because most teaching material is PDF, Word or slides. Files are read in the browser; PDF with pdf.js, DOCX with mammoth, PPTX from its XML. Legacy formats (`.doc`, `.ppt`, `.rtf`, `.odt`, `.odp`) are refused with "save it as PDF, DOCX or PPTX". Scans get a clear "no readable text" error until vision transcription lands as the first extra. **Built for TXT, MD and DOCX.** | The server never receives the file, so requests stay small. No maintained browser reader exists for `.doc`, and Word has saved `.docx` by default since 2007. |
| Chunks (**built**) | Paragraphs packed to 1,500 characters, never across a page; long paragraphs split at a sentence end, then whitespace, then hard. Every heading starts a new chunk (a Markdown `#` line, outside code fences; other formats map their headings to the same form). Headings with no text between them open one chunk together, labelled with the last, most specific one. Ids `c1…cN`, plus page, printed page label and the nearest heading. Formats without pages (TXT, MD, DOCX) report `page` and `totalPages` as `null` rather than a made-up page 1. | Stable ids for citations; the heading gives files without pages ("Section: Photosynthesis") a usable source reference. |
| Text direction (**built**) | Each chunk's direction comes from counting letters per script, not from `dir="auto"`. The planner will be told the main script and name the language itself. | `dir="auto"` follows the first strong character, so a Hebrew file starting with "Chapter 1" displays left-to-right. A language-detection library or API is not needed for direction. |
| Text encoding (**built**) | UTF-8, then UTF-16 by byte-order mark, then a legacy code page: windows-1252 when non-ASCII bytes mostly sit inside English words ("procédé") or stand alone ("à"); otherwise windows-1255 (Hebrew) or -1256 (Arabic), whichever decodes more of the text into its own script, with Hebrew ruled out when it leaves bytes undefined. | Hebrew and Arabic `.txt` files saved by older Windows tools are common in Israeli schools. Other legacy code pages are not detected. |
| Long documents | The client keeps the whole document; the only bound is the 20 MB file limit. The plan request carries at most 100,000 characters (`shared/limits.js`; lower for presets whose free tier rejects large requests). A document over that is planned from a compact outline of the whole file (headings, or pages, or groups of chunks, each with chunk ids and its first ~150 characters), and each step then teaches from its own chunks. **Whole-document ingestion built; outline planning comes with the plan route.** | Cutting the file to its first 100,000 characters would drop the section a teacher asks for ("teach chapter 5"). In a test set of real teaching files, 5 of 27 were over 100,000 characters (largest about 540,000), as were 4 of 9 chapters of an open statistics textbook. A 20 MB text file ingests in about 200 ms. |
| Hosting (**built**) | Google Cloud Run, one container, Express serves the front end, max one instance, min zero. Manual deploy, no CD. See [ADR 0001](docs/adr/0001-cloud-run-single-container.md). | One URL, no CORS, no cloud credentials in CI. |
| Streaming and stop | POST + `fetch` stream. Stop keeps the lesson state and saves the partial reply; Regenerate re-runs only the reply. **Built for the echo stream:** each stream gets a random id, and Stop calls `POST /api/streams/:id/cancel`, because Cloud Run does not pass client disconnects to the container. Every stream ends after 120 s at most. | Saves cost: the model stops generating when the user stops reading. State is never half-applied. |
| UI language | English UI. Source text gets its direction from its script (see Text direction); other content, such as the student's own messages, uses `dir="auto"`. | Right-to-left material renders correctly. |
| Evidence | Unit tests for the state machine, plus a scripted-student harness running ~5 scenarios. | "It looked fine to me" is not enough. |

## Libraries

- **express** (runtime): HTTP server; serves the built client and the API.
- **vite**, **@vitejs/plugin-react** (dev): client build and dev server.
- **react**, **react-dom** (dev): UI, bundled into `client/dist` at build time, so the production image does not need them.
- **tailwindcss**, **@tailwindcss/vite** (dev): styling, as the brief requires.
- Tests use the built-in `node:test` runner and global `fetch`; no test framework.
- **mammoth** (dev, bundled): reads `.docx` in the browser. It turns Word into clean HTML, with headings, lists and tables intact, and does not need a server. A worksheet's answers sit in tables and lists, so flattening to plain lines would lose which answer belongs to which question. It is loaded with a dynamic `import()` when a DOCX is picked, so it is not in the initial bundle. The DOM walk behind it (`dom-text.js`) is plain DOM code that is not specific to Word.
- **linkedom** (dev only): a small DOM for Node, so the walk can be unit-tested with `DOMParser` injected; the browser uses its own. It never reaches the client bundle. **jszip** (dev only, already a mammoth dependency) builds the test DOCX in `scripts/make-docx-fixture.js`.
- Text ingestion uses no library: the browser's `TextDecoder` for encodings and Unicode property regexes (`\p{Script=Hebrew}`) for script detection.
- `shared/` is a plain folder, not a package, for constants both sides need (the document cap and file size limit).
- Dev runs the API and Vite together with a small Node script (`scripts/dev.js`) rather than adding `concurrently`.

## Not doing

- **Free-text provider URL:** SSRF risk on Cloud Run's metadata server. URLs are hardcoded presets.
- **Fallback key from the host environment:** anyone on the public URL would spend the owner's quota.
- **Accounts, database, multiple files, voice, teacher analytics:** out of scope. So teacher and student share one browser session; a lesson can't move to a student's device.
