# ADR 0002: Fixed model presets and opt-in tab credentials

## Context

Model connection must support five providers and separate evaluator and teacher models without letting a public server call user-supplied destinations. The browser supplies the user's key per request; the stateless server must not retain it.

## Decision

Use one `chatCompletion` adapter with messages, model, output limit, streaming and abort signal. A server-only preset table fixes endpoints and temperature support. Public preset metadata is shared with the client. Use native fetch and reject redirects. The check route makes tiny model calls under a ten-second deadline and maps failures to fixed codes, adding the affected role for model errors. Provider error bodies are discarded.

Use memory by default. Only an explicit Remember for this tab option writes settings and the key to sessionStorage; opting out removes that entry immediately. Storage errors fall back to memory with a visible warning. A native modal dialog provides keyboard focus containment; editing or dismissing settings invalidates any pending check.

The adapter uses `max_completion_tokens`, as documented in the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Per-provider compatibility differences follow the presets' agreed contract.

## Consequences

Later model routes can share the adapter without sharing prompts or introducing a provider SDK. Custom URLs are unavailable, preventing user-directed server requests. The app adds no dependency. Keys can be read by same-origin scripts while present in memory or tab storage; tab storage is convenience, not a credential vault. Temporary connection failures can save with an explicit warning, so ready records configured settings rather than a continuing availability guarantee. Real provider availability still requires credentialed deployed validation.
