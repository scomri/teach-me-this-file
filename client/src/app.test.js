import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';

test('the lesson screen has no echo demo or API status line', async (t) => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  document.oninput = null;
  const { createRoot } = await import('react-dom/client');
  window.HTMLElement.prototype.showModal = function () {};
  window.HTMLElement.prototype.close = function () {};
  globalThis.fetch = async () => Response.json({ ok: true });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
  t.after(() => vite.close());
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(() => act(() => root.unmount()));
  await act(async () => root.render(React.createElement(App)));
  assert.equal(container.querySelector('textarea'), null);
  assert.ok(![...container.querySelectorAll('button')].some((b) => ['Send', 'Stop'].includes(b.textContent)));
  assert.doesNotMatch(container.textContent, /API:/);
  assert.match(container.textContent, /Teach Me This File/);
});
