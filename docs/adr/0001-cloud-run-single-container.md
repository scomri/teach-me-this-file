# 1. Cloud Run, one container, one instance

Status: accepted (built in slice 0)

## Context

The app needs a public URL, server-side streaming of model replies, and a server that never stores the user's API key. It has to run on a free or near-free tier and be deployable by one person. The front end is a static Vite build and the back end is a small Express API.

## Decision

- **One container on Google Cloud Run** (`europe-west1`). Express serves both the built client and `/api`: one URL, so no CORS.
- **Multi-stage image.** `node:24.22.1` builds the client and `node:24.22.1-slim` runs it, as the `node` user, with production dependencies only. An allowlist `.dockerignore` and `.gcloudignore` keep anything outside `server/`, `client/` and the package files out of the build.
- **max-instances 1, min-instances 0.** Cost is capped by the instance limit; a budget alert covers anything unexpected. Min-instances goes to 1 only for the review window, to avoid cold starts there.
- **Manual deploy, no CD.** One documented command (`gcloud run deploy --source .`). CI runs tests, build and a secret scan, and holds no cloud credentials.
- **Explicit stream cancel.** Cloud Run's front end keeps its connection to the container open after the browser disconnects. A 60-word stream cut off by the client after 1.2 s still ran for its full 9 s on the server. So each stream opens with a random id, and Stop calls `POST /api/streams/:id/cancel`. Every stream also ends after 120 s at most.

## Consequences

- Active streams live in an in-memory map. Cancel only works because every request reaches the same instance. Raising max-instances needs sticky routing or a shared store first.
- A cold start costs **4–7 s** on the first request after the instance has scaled to zero (two samples: 7.3 s and 4.2 s, of which 6.5 s and 3.5 s were Cloud Run starting the container; a warm request takes 0.2 s). Idle instances were still warm after 17 minutes. The client warms the server with `/api/health` on load and shows a "waking the server" state if the first request takes over 1.5 s.
- The server stays stateless apart from the live stream map, so a restart loses nothing but in-flight replies.
- The cancel POST must carry a body length. The front end rejects a bodyless POST without `Content-Length` with 411. Browsers send `Content-Length: 0`; scripts must send an empty body.
- HTTP/2 end-to-end (`--use-http2`) is off: Express speaks HTTP/1.1 only.
