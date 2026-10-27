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

// ponytail: byte-range heuristic for the three code pages this app's users meet.
// Other legacy encodings (Cyrillic, Greek…) decode as windows-1252 garbage; add a
// detector library if real files need them.
function legacyEncoding(bytes) {
  let ascii = 0;
  let high = 0;
  let startC = 0; // word-initial 0xC0–0xDF: Arabic letters in 1256, Hebrew vowel points in 1255
  let startE = 0; // word-initial 0xE0–0xFA: Hebrew letters in 1255
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      if ((b | 0x20) >= 0x61 && (b | 0x20) <= 0x7a) ascii++;
      continue;
    }
    high++;
    const prev = i ? bytes[i - 1] : 0x20;
    const wordStart = prev < 0x80 && !/[0-9A-Za-z]/.test(String.fromCharCode(prev));
    if (!wordStart) continue;
    if (b >= 0xc0 && b <= 0xdf) startC++;
    else if (b >= 0xe0 && b <= 0xfa) startE++;
  }
  if (high < 0.3 * (ascii + high)) return 'windows-1252';
  // Vowel points never start a Hebrew word, but Arabic words often start with alef (0xC7).
  return startC > 0.3 * (startC + startE) ? 'windows-1256' : 'windows-1255';
}
