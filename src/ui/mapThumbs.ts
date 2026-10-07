import { buildFieldRamp, type FieldRamp } from '../map/fieldLayer';

const W = 120;
const H = 84;
const cache = new Map<string, string>();

/** Deterministic value noise, so a map's thumbnail looks the same every time. */
function noise(seed: number): (x: number, y: number) => number {
  const hash = (i: number, j: number) => {
    let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * fx;
    const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y) => (value(x, y) * 0.55 + value(x * 2.1, y * 2.1) * 0.3 + value(x * 4.3, y * 4.3) * 0.15);
}

/**
 * A small preview of a weather map: soft noise "weather" colored with the
 * map's own ramp over a dark sea-and-land ground. `bias` shifts the noise
 * toward the ramp's busy end (0..1) so sparse maps (rain, snow) still show color.
 */
export function mapThumb(key: string, ramp: FieldRamp | null, seed: number, bias = 0.5): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(W, H);
  const lut = ramp ? buildFieldRamp(ramp) : null;
  const n = noise(seed);
  const land = noise(seed + 101);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const isLand = land(x / 54, y / 54) > 0.5;
      // Ground: dark sea or slightly lighter land, like the satellite basemap at night.
      let r = isLand ? 46 : 22;
      let g = isLand ? 52 : 36;
      let b = isLand ? 44 : 52;
      if (lut) {
        const t = Math.max(0, Math.min(1, (n(x / 46, y / 46) - 0.5) * 1.6 + bias));
        const k = Math.round(t * 255) * 4;
        const a = lut[k + 3] / 255;
        r = r * (1 - a) + lut[k] * a;
        g = g * (1 - a) + lut[k + 1] * a;
        b = b * (1 - a) + lut[k + 2] * a;
      }
      const o = (y * W + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
