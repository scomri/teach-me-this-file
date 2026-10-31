import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

test('an HTML 503 response shows its HTTP status', async (t) => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLElement.prototype.showModal = function () {};
  window.HTMLElement.prototype.close = function () {};
  let abortBody = false;
  globalThis.fetch = async (url) => url === '/api/health' ? Response.json({ ok: true }) : abortBody
    ? { ok: false, status: 503, json: async () => { throw new DOMException('aborted', 'AbortError'); } }
    : new Response('<h1>Unavailable</h1>', { status: 503 });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
  t.after(() => vite.close());
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(() => act(() => root.unmount()));
  await act(async () => root.render(React.createElement(App)));
  const input = container.querySelector('textarea');
  await act(async () => { input[Object.keys(input).find((key) => key.startsWith('__reactProps'))].onChange({ target: { value: 'hello' } }); });
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send');
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
  assert.match(container.textContent, /error: HTTP 503/);
  abortBody = true;
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
  assert.match(container.textContent, /stopped/);
});
