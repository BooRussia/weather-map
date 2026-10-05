/** Words are whitespace-separated tokens; a lone separator like "·" does not count. */
export function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Trim a line to at most `max` words, dropping a trailing separator. */
export function limitWords(s: string, max: number): string {
  const tokens = s.trim().split(/\s+/);
  const out: string[] = [];
  let words = 0;
  for (const t of tokens) {
    const isWord = /[\p{L}\p{N}]/u.test(t);
    if (isWord && words === max) break;
    out.push(t);
    if (isWord) words++;
  }
  while (out.length && !/[\p{L}\p{N}]/u.test(out[out.length - 1])) out.pop();
  return out.join(' ').replace(/[,;]$/, '');
}

/** "chance showers and thunderstorms" -> "Chance showers and thunderstorms" */
export function sentenceCase(s: string): string {
  const lower = s.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}
