// Main writing system of a text, from letter counts. Sets text direction where
// dir="auto" would be fooled by a leading Latin word or number.

const count = (text, re) => text.match(re)?.length ?? 0;

export function detectScript(text) {
  const hebrew = count(text, /\p{Script=Hebrew}/gu);
  const arabic = count(text, /\p{Script=Arabic}/gu);
  const latin = count(text, /\p{Script=Latin}/gu);
  const other = count(text, /\p{L}/gu) - hebrew - arabic - latin;
  const [script, n] = Object.entries({ hebrew, arabic, latin, other }).reduce((a, b) => (b[1] > a[1] ? b : a));
  if (!n) return { script: 'other', rtl: false };
  return { script, rtl: script === 'hebrew' || script === 'arabic' };
}

export const textDir = (text) => (detectScript(text).rtl ? 'rtl' : 'ltr');
