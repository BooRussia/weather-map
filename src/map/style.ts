/**
 * Basemap color handling. DESIGN.md allows neutrals plus one accent, so every
 * color in the Carto style is converted to its grayscale luminance at load.
 */

type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = 'f'] = h.split('');
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    if (h.length === 6 || h.length === 8) {
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], alpha(m[4])];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    return [r, g, b, alpha(m[4])];
  }
  return null;
}

function alpha(a: string | undefined): number {
  if (a == null) return 1;
  return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Same perceived lightness, zero saturation. Returns null for non-colors. */
export function toGray(color: string): string | null {
  const c = parseColor(color);
  if (!c) return null;
  const [r, g, b, a] = c;
  const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return a >= 1 ? `rgb(${l}, ${l}, ${l})` : `rgba(${l}, ${l}, ${l}, ${+a.toFixed(3)})`;
}

function grayDeep(v: unknown): unknown {
  if (typeof v === 'string') return toGray(v) ?? v;
  if (Array.isArray(v)) return v.map(grayDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = grayDeep(x);
    return out;
  }
  return v;
}

interface StyleLike {
  layers: { paint?: Record<string, unknown> }[];
}

/** Grayscale every `*-color` paint property, including inside expressions. */
export function desaturateStyle<T extends StyleLike>(style: T): T {
  for (const layer of style.layers) {
    if (!layer.paint) continue;
    for (const key of Object.keys(layer.paint)) {
      if (key.endsWith('-color')) layer.paint[key] = grayDeep(layer.paint[key]);
    }
  }
  return style;
}
