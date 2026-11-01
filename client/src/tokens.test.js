import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The colour tokens in index.css, light (@theme) and dark (the prefers-color-scheme block), checked for
// WCAG contrast. Text pairs need 4.5:1 (AA); focus rings and control borders need 3:1 (non-text contrast).
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = tokens(css.match(/@theme\s*{([^}]*)}/)[1]);
const dark = { ...light, ...tokens(css.match(/prefers-color-scheme:\s*dark\)[^{]*{[^{]*{([^}]*)}/)[1]) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = [
  ['text', 'canvas'], ['text', 'surface'], ['muted', 'canvas'], ['muted', 'surface'],
  ['on-accent', 'accent-strong'], ['text', 'highlight'],
  ['danger', 'canvas'], ['danger', 'surface'], ['text', 'danger-tint'],
  ['warning', 'canvas'], ['warning', 'surface'], ['text', 'warning-tint'],
];
const NON_TEXT = [['focus', 'canvas'], ['focus', 'surface'], ['border-strong', 'canvas'], ['border-strong', 'surface']];

for (const [mode, t] of [['light', light], ['dark', dark]]) {
  test(`${mode} token pairs meet WCAG AA`, () => {
    for (const [pairs, min] of [[TEXT, 4.5], [NON_TEXT, 3]]) {
      for (const [fg, bg] of pairs) {
        assert.ok(t[fg] && t[bg], `${mode}: --color-${fg} and --color-${bg} are defined`);
        const ratio = contrast(t[fg], t[bg]);
        assert.ok(ratio >= min, `${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  });
}

test('dark mode redefines every colour token', () => {
  const darkOnly = tokens(css.match(/prefers-color-scheme:\s*dark\)[^{]*{[^{]*{([^}]*)}/)[1]);
  assert.deepEqual(Object.keys(darkOnly).sort(), Object.keys(light).sort());
});
