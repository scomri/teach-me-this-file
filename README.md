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

Deploys are manual: one command, run from a clean checkout of `main` with `gcloud` authenticated against the project. Cloud Build builds the `Dockerfile`, and `.gcloudignore` limits the upload to the build inputs.

```sh
gcloud run deploy teach-me-this-file --source . --region europe-west1 \
  --allow-unauthenticated --max-instances 1 --min-instances 0 \
  --memory 512Mi --cpu 1 --concurrency 80 --timeout 300
```

Keep `--max-instances 1`: active streams are tracked in memory, so Stop (`POST /api/streams/:id/cancel`) must reach the same instance as the stream. Do not add `--use-http2`, because the server speaks HTTP/1.1 only.
