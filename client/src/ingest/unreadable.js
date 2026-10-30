// One rule for every reader with pages (PDF pages, PPTX slides): no usable text when there
// are fewer than 20 letters (a scan, a figure, a picture-only slide), or more than 20% of
// the characters are broken (a font without a usable character map).
export function unreadable(text) {
  const chars = text.replace(/\s/g, '');
  const letters = chars.match(/\p{L}/gu)?.length ?? 0;
  const broken = chars.match(/[�\p{Co}\p{Cc}]/gu)?.length ?? 0;
  return letters < 20 || broken > chars.length * 0.2;
}
