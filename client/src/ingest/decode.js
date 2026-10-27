// Bytes of a text file to a string. UTF-8 and UTF-16 first; otherwise guess the
// legacy Windows code page from byte ranges (Latin, Hebrew or Arabic).

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(legacyEncoding(bytes)).decode(bytes);
  }
}

const isAsciiLetter = (b) => b !== undefined && (b | 0x20) >= 0x61 && (b | 0x20) <= 0x7a;
const count = (text, re) => text.match(re)?.length ?? 0;

// ponytail: heuristic for the three code pages this app's users meet. Other legacy
// encodings (Cyrillic, Greek…) decode as windows-1252 garbage; add a detector
// library if real files need them.
function legacyEncoding(bytes) {
  // Accented Latin letters sit inside ASCII words ("procédé"); Hebrew and Arabic
  // words are runs of high bytes, even in a mostly English file.
  let high = 0;
  let inLatinWord = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue;
    high++;
    if (isAsciiLetter(bytes[i - 1]) || isAsciiLetter(bytes[i + 1])) inLatinWord++;
  }
  if (inLatinWord > high / 2) return 'windows-1252';

  // Hebrew or Arabic: Arabic text hits bytes windows-1255 leaves undefined (ع ف ق ك);
  // otherwise the code page whose script block covers more of the text wins.
  const he = new TextDecoder('windows-1255').decode(bytes);
  const ar = new TextDecoder('windows-1256').decode(bytes);
  const heScore = he.includes('�') ? -1 : count(he, /[֑-״]/g);
  return count(ar, /[؀-ۿ]/g) >= heScore ? 'windows-1256' : 'windows-1255';
}
