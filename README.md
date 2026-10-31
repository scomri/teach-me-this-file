# Teach Me This File

Upload a document and get a short, interactive tutoring lesson on it.

## API key

The app runs on your own key, entered in Settings and kept in the browser; the server never stores it. Presets: Gemini (default), OpenRouter, OpenAI, Anthropic. Without paid credits, use a free Gemini key from Google AI Studio. OpenRouter's free models are not supported (see `DECISIONS.md`).

## Run locally

Requires Node 24.

```sh
npm install
npm run dev    # Express API on :8080 + Vite client on :5173 (proxies /api)
npm run build  # build the client into client/dist
npm start      # serve client/dist and the API from one port (PORT, default 8080)
npm test       # run the server tests (node:test)
```

CI runs the tests, the build and a gitleaks secret scan on every pull request and on pushes to `main`.

### Docker

```sh
docker build -t teach-me-this-file:local .
docker run --rm -p 8080:8080 teach-me-this-file:local   # http://localhost:8080
```

## Deploy

Live: https://teach-me-this-file-630387171976.europe-west1.run.app

Every push to `main` deploys automatically. The `deploy` job in `.github/workflows/ci.yml` runs only after tests, the build and the secret scan pass, and signs in to Google Cloud with Workload Identity Federation, so GitHub stores no cloud key. The URL stays the same; each deploy adds a new Cloud Run revision. See [ADR 0004](docs/adr/0004-continuous-deploy.md).

Cloud Build builds the `Dockerfile`, and `.gcloudignore` limits the upload to the build inputs. The job runs the command below, which also works as a manual fallback from a clean checkout of `main` with `gcloud` authenticated against the project:

```sh
gcloud run deploy teach-me-this-file --source . --region europe-west1 \
  --allow-unauthenticated --max-instances 1 \
  --memory 512Mi --cpu 1 --concurrency 80 --timeout 300
```

Keep `--max-instances 1`: active streams are tracked in memory, so Stop (`POST /api/streams/:id/cancel`) must reach the same instance as the stream. Do not add `--use-http2`, because the server speaks HTTP/1.1 only. `--min-instances` is left out so a deploy keeps the service's current value.

## Model connection

Settings opens automatically when no key is available. Choose Gemini (default), OpenRouter, OpenAI or Anthropic, enter your own API key, and choose Save and check connection. Each preset fills separate evaluator and teacher models; blank model fields use that preset's defaults. Checks make a tiny request for each model and may consume provider quota.

The header connection pill reopens Settings. A rejected key or missing model must be corrected before saving. Rate limits and connection failures save with a visible warning, and the pill reads "rate-limited" or "not verified" instead of "ready"; reopen Settings and save to retry. A saved connection is not a guarantee that later requests will succeed.

Keys stay in browser memory by default and travel to the server only in `X-Api-Key`. Optional **Remember for this tab** uses `sessionStorage`, so reloading that tab restores settings. Uncheck it to remove the saved key. Scripts on the same origin can read tab storage; avoid remembering keys on shared devices. If browser storage is blocked, settings still work in memory and the app shows a warning. Keys are not stored on the server or in IndexedDB. Provider destinations are fixed server-side; custom base URLs are not supported.

## Planning a lesson

If a text file contains damaged UTF-16 text, the app warns that characters may be missing. Choose another file or continue with the readable text; missing characters appear as `�` and may affect the lesson. The original file is not changed.

Pick a file, optionally describe the lesson in the prompt box (for example "teach the main ideas in 15 minutes, in English, for 10th graders", up to 2,000 characters), and choose Plan. The teacher model returns a plan you can read before any student sees it: a title and, for each step, its objective, a check question, the key points a good answer covers, and the pages it draws on. Regenerate asks for a new plan. Start opens step 1: the tutor streams a short explanation from the step's passages and asks its check question, with the page it draws on. Stop cuts a reply and keeps what was written; Regenerate replaces it, and Retry repeats a reply that failed. The lesson is kept in this browser: a refresh returns to the same screen and step, New lesson clears it, and blocked storage keeps it in memory with a notice. Answering the tutor comes next.

The plan says honestly how the file matches the request. If the file covers only part of it, the plan covers what the file contains and the screen adds "Not in the file: …". If it covers none of it, no plan is shown: a message explains, with a **Plan from whole file** button that plans the document's main ideas instead (the language, audience and length in the prompt still apply). An empty prompt plans the whole file with every default.

The prompt may state a language, audience, style and length; anything it leaves out gets a default (the prompt's language, else the document's; five steps). Steps run about 2.5 minutes each, between 1 and 10, and the stated length is a ceiling, never padded: a file that supports fewer steps than the minutes allow gets a shorter lesson, and the screen says so ("This file supports 4 steps (~10 min), shorter than the 25 min requested"). It also notes a request the app does not follow: more minutes or steps than the ten-step ceiling allows, or outside sources (the lesson teaches only from the file). A key without enough provider credit shows its own message. A rejected key shows "Your key was rejected" with an Open Settings button, and the request re-runs after a successful save. A file too long for one request (over 100,000 characters, or over the preset's estimated planning budget) is planned from an outline of the whole file, so a request like "teach chapter 5" reaches the right part. See [ADR 0003](docs/adr/0003-lesson-plan-call.md).

File ingestion and the echo demo remain available. Accounts, a database, multiple files per lesson, voice/avatar and teacher analytics are out of scope.
