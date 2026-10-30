# Teach Me This File

Upload a document and get a short, interactive tutoring lesson on it.

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

Deploys are manual: one command, run from a clean checkout of `main` with `gcloud` authenticated against the project. Cloud Build builds the `Dockerfile`, and `.gcloudignore` limits the upload to the build inputs.

```sh
gcloud run deploy teach-me-this-file --source . --region europe-west1 \
  --allow-unauthenticated --max-instances 1 --min-instances 0 \
  --memory 512Mi --cpu 1 --concurrency 80 --timeout 300
```

Keep `--max-instances 1`: active streams are tracked in memory, so Stop (`POST /api/streams/:id/cancel`) must reach the same instance as the stream. Do not add `--use-http2`, because the server speaks HTTP/1.1 only.

## Model connection

Settings opens automatically when no key is available. Choose Gemini (default), Groq, OpenRouter, OpenAI or Anthropic, enter your own API key, and choose Save and check connection. Each preset fills separate evaluator and teacher models; blank model fields use that preset's defaults. Checks make a tiny request for each model and may consume provider quota.

The header connection pill reopens Settings. A rejected key or missing model must be corrected before saving. Rate limits and connection failures save with a visible warning; reopen Settings and save to retry. A saved connection is not a guarantee that later requests will succeed.

Keys stay in browser memory by default and travel to the server only in `X-Api-Key`. Optional **Remember for this tab** uses `sessionStorage`, so reloading that tab restores settings. Uncheck it to remove the saved key. Scripts on the same origin can read tab storage; avoid remembering keys on shared devices. If browser storage is blocked, settings still work in memory and the app shows a warning. Keys are not stored on the server or in IndexedDB. Provider destinations are fixed server-side; custom base URLs are not supported.

File ingestion and the echo demo remain available. Lesson planning is not yet connected to the selected model. Accounts, a database, multiple files per lesson, voice/avatar and teacher analytics are out of scope.
