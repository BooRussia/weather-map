import type { ColorMode } from '../config';

/**
 * The 256-color table IEM paints every radar tile with: the NEXRAD archive
 * composite, the live composite, and the HRRR forecast all share it. Entry i
 * is reflectivity i / 2 − 32 dBZ; entry 0 is "no data". Read from the PLTE
 * chunk of IEM's n0q composite PNG. Tile pixels are exact entries (nearest-
 * neighbor rendering), so each one decodes back to its dBZ.
 */
const N0Q_PALETTE =
  'AAAAhXGPhXKPhnONh3WLh3aLiHeJiXmHiXqHinuFi32Ei36EjH+CjYGAjYKAjoN+j4R8j4V8kId7kYh5kYl5kot3k411lpFTmJRXm5dbnZpgoJ1k' +
  'o6BopaNtqKZxqql2rax6sK9+srKDt7iMuruQvb6Uv8GZwsSdxMeix8qmys2qzNCv0tS0z9K0ycy0xsm0w8e0wMS0vcG0ub60tru0s7m0sLa0rbO0' +
  'qrC0pKu0oKi0naW0mqK0l6C0lJ20kZq0lJu1kJi0jJWziJKygIywfImveIaudIOscICrbH2qZ3mpY3aoX3OnW3CmV22kT2eiS2ShR2GgQ16fQVue' +
  'Q2GiRWimSG+qSnauTX2yT4S2UYu7VpnDWZ/HW6bLXq3PYLTUYrvYZcLcZ8ngatDkb9boaNbXWdazUtaiS9aQQ9Z+PNZtNdZbEdUYEdEXEM0XEMgW' +
  'EMQWD7wVD7cUDrMUDq8TDqsTDaYSDaISDZ4RDJkRDJUQDJEQC4gPC4QOCoAOCnwNCncNCXMMCW8MCWsLCGYLCGIKCV4JMnMIRn0IW4gHb5IHhJ0G' +
  'mKgGrbIFwb0F1scE6tIE/+IA/9gA/9MA/84A/8kA/8QA/8AA/7sA/7YA/7EA/6wA/6cA/6IA/5kA/5QA/48A/4oA/4UA/4AA/wAA+AAA8QAA6gAA' +
  '4wAA1QAAzQAAxgAAvwAAuAAAsQAAqgAAowAAmwAAlAAAjQAAfwAAeAAAcQAA//////X//+r//9///9T//8n//77//7P//53//5L//3X//Gv9+WD6' +
  '9lb380v08EDx7Tbv6ivs5yDp4QvjsgD/rAD8pAD3mwD0kwDviADqgwDoeQDicgDdaQDbBezwBevwBerwBd3gBdzgBdvgBc3QBczQBL3ABLzABLvA' +
  'BK6wBK2wBJ6gBJ2gBJygA46QA42QA4yQA36AA32AA29wA25wA21wAl9gAl5gAk9QAk5QAk1QAj9AAj5AAj1AATAwAS8wASAgAR8gAR4gOme1Oma1' +
  'OmW1OmS1OmO1OmK1';

/** Bits per channel in the color → entry lookup (128³ cells; neighbors differ by at most 0.5 dBZ). */
export const LUT_BITS = 7;
export const LUT_SIZE = 1 << LUT_BITS;

/** Reflectivity of palette entry i. */
export const dbzOf = (i: number) => i / 2 - 32;
/** Palette entry for a reflectivity. */
export const entryOf = (dbz: number) => Math.round((dbz + 32) * 2);

function palette(): Uint8Array {
  const bin = atob(N0Q_PALETTE);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 3-D lookup: color (each channel >> 1) → palette entry, as a 128³ R8 volume.
 * Cells no palette color lands in stay 0 (no data).
 */
export function buildLut(): Uint8Array {
  const p = palette();
  const shift = 8 - LUT_BITS;
  const lut = new Uint8Array(LUT_SIZE ** 3);
  for (let i = 1; i < 256; i++) {
    const r = p[i * 3] >> shift;
    const g = p[i * 3 + 1] >> shift;
    const b = p[i * 3 + 2] >> shift;
    lut[(b * LUT_SIZE + g) * LUT_SIZE + r] = i;
  }
  return lut;
}

/* ---------- MRMS ---------- */

/**
 * NOAA's MRMS tiles come pre-colored with no published table. The colors are
 * a straight-line ramp between these anchors, one every 5 dBZ, in 0.5 dBZ
 * steps (10 per segment). Worked out from every color on the server and
 * checked against IEM's dBZ at the same places and time: medians land on the
 * anchors from 20 to 40 dBZ. Past 60 only two pixels were ever seen, both on
 * the line toward white.
 */
export const MRMS_ANCHORS: [dbz: number, r: number, g: number, b: number][] = [
  [-5, 210, 212, 180],
  [0, 176, 182, 180],
  [5, 148, 155, 181],
  [10, 99, 118, 168],
  [15, 67, 94, 159],
  [20, 94, 173, 207],
  [25, 82, 214, 162],
  [30, 14, 214, 20],
  [35, 11, 136, 15],
  [40, 9, 94, 9],
  [45, 255, 226, 0],
  [50, 255, 177, 0],
  [55, 255, 0, 0],
  [60, 177, 0, 0],
  [65, 255, 255, 255],
];

/**
 * Color → palette entry (the same entries as IEM's, so every ramp reads both)
 * for MRMS tiles, as a 128³ volume like `buildLut`. The ramp is traced finely
 * and every cell within a cell or so of it takes the nearest point's entry,
 * so rounding on the server never drops an echo; cells off the ramp stay 0.
 */
export function buildMrmsLut(): Uint8Array {
  const shift = 8 - LUT_BITS;
  const lut = new Uint8Array(LUT_SIZE ** 3);
  const dist = new Map<number, number>();
  const REACH = 1.5; // cells
  for (let k = 0; k < MRMS_ANCHORS.length - 1; k++) {
    const [d0, r0, g0, b0] = MRMS_ANCHORS[k];
    const [d1, r1, g1, b1] = MRMS_ANCHORS[k + 1];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      // In cell units: cell c holds colors 2c and 2c + 1, so it spans c … c + 0.5, centered on c + 0.25.
      const r = (r0 + (r1 - r0) * t) / (1 << shift);
      const g = (g0 + (g1 - g0) * t) / (1 << shift);
      const b = (b0 + (b1 - b0) * t) / (1 << shift);
      const entry = entryOf(d0 + (d1 - d0) * t);
      for (let cb = Math.floor(b - REACH); cb <= Math.floor(b + REACH); cb++) {
        for (let cg = Math.floor(g - REACH); cg <= Math.floor(g + REACH); cg++) {
          for (let cr = Math.floor(r - REACH); cr <= Math.floor(r + REACH); cr++) {
            if (cr < 0 || cg < 0 || cb < 0 || cr >= LUT_SIZE || cg >= LUT_SIZE || cb >= LUT_SIZE) continue;
            const e = (cr + 0.25 - r) ** 2 + (cg + 0.25 - g) ** 2 + (cb + 0.25 - b) ** 2;
            const idx = (cb * LUT_SIZE + cg) * LUT_SIZE + cr;
            if (e <= REACH * REACH && e < (dist.get(idx) ?? Infinity)) {
              dist.set(idx, e);
              lut[idx] = entry;
            }
          }
        }
      }
    }
  }
  return lut;
}

type Stop = [dbz: number, r: number, g: number, b: number, a: number];

/**
 * Display ramps, by reflectivity. Color reads like TV-weather radar: nothing
 * below light rain (the archive's pale "clear air" returns), translucent
 * greens, then yellow, orange, red, magenta. Mono is the DESIGN.md default:
 * white at rising opacity.
 */
const RAMPS: Record<ColorMode, Stop[]> = {
  color: [
    [9, 120, 210, 120, 0],
    [14, 118, 206, 112, 0.45],
    [22, 66, 182, 74, 0.6],
    [28, 28, 152, 52, 0.72],
    [34, 14, 118, 42, 0.8],
    [37.5, 22, 108, 40, 0.83],
    [39.5, 238, 214, 52, 0.86],
    [44, 250, 168, 28, 0.88],
    [48, 242, 100, 22, 0.9],
    [52, 222, 34, 30, 0.92],
    [57, 164, 12, 30, 0.93],
    [62, 202, 40, 168, 0.95],
    [68, 246, 178, 255, 0.95],
  ],
  mono: [
    [9, 200, 200, 205, 0],
    [14, 205, 205, 210, 0.24],
    [30, 228, 228, 232, 0.4],
    [45, 245, 245, 248, 0.6],
    [60, 255, 255, 255, 0.78],
  ],
};

/** A ramp sampled at every palette entry: 256 RGBA texels, straight alpha. */
export function buildRamp(mode: ColorMode): Uint8Array {
  const stops = RAMPS[mode];
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const d = dbzOf(i);
    if (d < stops[0][0]) {
      // Transparent, but in the first color, so filtering toward it doesn't darken the fringe.
      out.set([stops[0][1], stops[0][2], stops[0][3], 0], i * 4);
      continue;
    }
    let k = 0;
    while (k < stops.length - 1 && stops[k + 1][0] <= d) k++;
    const a = stops[k];
    const b = stops[k + 1] ?? a;
    const t = b === a ? 0 : (d - a[0]) / (b[0] - a[0]);
    for (let c = 1; c <= 4; c++) {
      const v = a[c] + (b[c] - a[c]) * t;
      out[i * 4 + c - 1] = Math.round(c === 4 ? v * 255 : v);
    }
  }
  return out;
}

/** Legend gradient for the Color ramp, light → heavy. */
export const RADAR_LEGEND = RAMPS.color.slice(1).map(([, r, g, b]) => `rgb(${r}, ${g}, ${b})`);

/* ---------- storm-relative velocity (N0S) ---------- */

/**
 * IEM's N0S tiles: 13 colors, knots, negative toward the radar (decoded from
 * the product headers). Steps run inbound → outbound; the last is range-folded.
 */
const VELOCITY_COLORS: [r: number, g: number, b: number][] = [
  [2, 252, 2], // ≤ −50 kt toward
  [1, 228, 1], // −36 … −49
  [1, 197, 1], // −26 … −35
  [7, 172, 4], // −20 … −25
  [6, 143, 3], // −10 … −19
  [124, 151, 123], // −1 … −9
  [152, 119, 119], // 0 … 9
  [162, 0, 0], // 10 … 19
  [185, 0, 0], // 20 … 25
  [216, 0, 0], // 26 … 35
  [239, 0, 0], // 36 … 49
  [254, 0, 0], // ≥ 50 away
];
const FOLDED: [number, number, number] = [144, 0, 160];
/** Steps are spread across the 0..255 range so smoothing blends neighbors, not the extremes. */
const VEL_STEP = 20;
const velSlot = (k: number) => 10 + k * VEL_STEP;
/** Range-folded (ambiguous) gates get a slot of their own, far from the others. */
const FOLDED_SLOT = 252;

/** Color → velocity slot, as a 128³ volume like `buildLut`. */
export function buildVelocityLut(): Uint8Array {
  const shift = 8 - LUT_BITS;
  const lut = new Uint8Array(LUT_SIZE ** 3);
  const put = ([r, g, b]: [number, number, number], slot: number) => {
    lut[((b >> shift) * LUT_SIZE + (g >> shift)) * LUT_SIZE + (r >> shift)] = slot;
  };
  VELOCITY_COLORS.forEach((c, k) => put(c, velSlot(k)));
  put(FOLDED, FOLDED_SLOT);
  return lut;
}

/**
 * Display colors by slot: toward the radar in greens (brighter = faster),
 * away in reds, near zero a quiet gray, range-folded purple. Straight alpha.
 */
const VELOCITY_DISPLAY: [r: number, g: number, b: number, a: number][] = [
  [80, 255, 120, 0.95],
  [40, 225, 90, 0.92],
  [20, 190, 70, 0.9],
  [20, 160, 60, 0.88],
  [30, 125, 55, 0.85],
  // Near zero is mostly clear-air return (insects, birds): kept quiet.
  [110, 140, 115, 0.35],
  [150, 115, 115, 0.35],
  [150, 25, 30, 0.85],
  [190, 25, 35, 0.88],
  [225, 30, 40, 0.9],
  [250, 60, 70, 0.92],
  [255, 130, 150, 0.95],
];

export function buildVelocityRamp(): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    if (i >= FOLDED_SLOT - 1) {
      out.set([150, 60, 200, Math.round(0.85 * 255)], i * 4);
      continue;
    }
    // Between two steps: blend them (smoothing lands in between).
    const k = Math.max(0, Math.min(VELOCITY_DISPLAY.length - 1, (i - 10) / VEL_STEP));
    const k0 = Math.floor(k);
    const k1 = Math.min(VELOCITY_DISPLAY.length - 1, k0 + 1);
    const t = k - k0;
    for (let c = 0; c < 4; c++) {
      const v = VELOCITY_DISPLAY[k0][c] + (VELOCITY_DISPLAY[k1][c] - VELOCITY_DISPLAY[k0][c]) * t;
      out[i * 4 + c] = Math.round(c === 3 ? v * 255 : v);
    }
  }
  return out;
}

/** Legend gradient for velocity, toward → away. */
export const VELOCITY_LEGEND = VELOCITY_DISPLAY.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
