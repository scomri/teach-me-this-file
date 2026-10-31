import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), plugins: [react()], appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' });
const { default: FileIngest } = await vite.ssrLoadModule('/src/ui/FileIngest.jsx');
test.after(() => vite.close());

test('damaged text requires continuation and a new file clears the warning', async () => {
  const container = document.getElementById('root');
  const root = createRoot(container);
  let doc;
  await act(async () => root.render(React.createElement(FileIngest, { onDoc: (value) => { doc = value; } })));
  const input = container.querySelector('input[type="file"]');
  const select = async (file) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
  };
  const damaged = new File([Uint8Array.of(0xff, 0xfe, 0x41, 0, 0x42)], 'damaged.txt');
  await select(damaged);
  assert.equal(doc, null);
  assert.match(container.textContent, /damaged or missing/);
  const buttons = [...container.querySelectorAll('button')];
  let pickerOpened = false;
  input.addEventListener('click', () => { pickerOpened = true; });
  buttons.find((button) => button.textContent === 'Choose another file').click();
  assert.equal(pickerOpened, true);
  await act(async () => buttons.find((button) => button.textContent === 'Continue with damaged text').click());
  assert.equal(doc.chunks[0].text, 'A�');
  assert.match(container.textContent, /damaged or missing/);
  await select(new File(['Good text'], 'good.txt'));
  assert.equal(doc.chunks[0].text, 'Good text');
  assert.doesNotMatch(container.textContent, /damaged or missing/);
  await act(async () => root.unmount());
});
