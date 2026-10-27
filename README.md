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
