import { describe, expect, it } from 'vitest';
import { buildLcrefLut, buildLut, buildRamp, dbzOf, entryOf, LUT_BITS, LUT_SIZE } from '../src/map/radarPalette';

/** Look a tile color up the way the decode shader does. */
function decode(lut: Uint8Array, r: number, g: number, b: number): number {
  const s = 8 - LUT_BITS;
  return lut[((b >> s) * LUT_SIZE + (g >> s)) * LUT_SIZE + (r >> s)];
}

describe('radar palette', () => {
  it('maps entries to reflectivity', () => {
    expect(dbzOf(entryOf(20))).toBe(20);
    expect(dbzOf(entryOf(-10.5))).toBe(-10.5);
  });

  it('decodes IEM tile colors back to their reflectivity', () => {
    const lut = buildLut();
    // Colors sampled from IEM's n0q palette.
    expect(dbzOf(decode(lut, 75, 214, 144))).toBe(20); // light green
    expect(dbzOf(decode(lut, 234, 210, 4))).toBe(40); // yellow
    expect(dbzOf(decode(lut, 255, 0, 0))).toBe(50); // red
    expect(decode(lut, 1, 2, 3)).toBe(0); // not a palette color: no data
  });

  it('hides clear-air returns and shows rain with rising opacity', () => {
    const ramp = buildRamp('color');
    const alpha = (dbz: number) => ramp[entryOf(dbz) * 4 + 3];
    expect(alpha(5)).toBe(0);
    expect(alpha(11.5)).toBe(0);
    // Light rain comes in quickly from 12 dBZ, solid (The Weather Channel's look) from light rain up.
    expect(alpha(13)).toBeGreaterThan(0);
    expect(alpha(13)).toBeLessThan(alpha(15));
    expect(alpha(20)).toBeGreaterThan(200);
    expect(alpha(45)).toBeGreaterThanOrEqual(alpha(20));
    // Light rain is green; moderate yellow; heavy rain is red.
    const [ry, gy, by] = [...ramp.subarray(entryOf(39) * 4, entryOf(39) * 4 + 3)];
    expect(ry).toBeGreaterThan(200);
    expect(gy).toBeGreaterThan(150);
    expect(by).toBeLessThan(100);
    const rgb = (dbz: number) => [...ramp.subarray(entryOf(dbz) * 4, entryOf(dbz) * 4 + 3)];
    const [r20, g20] = rgb(20);
    expect(g20).toBeGreaterThan(r20);
    const [r53, g53] = rgb(53);
    expect(r53).toBeGreaterThan(g53 * 3);
  });

  it('has a grayscale ramp for Mono', () => {
    const ramp = buildRamp('mono');
    const i = entryOf(40) * 4;
    expect(ramp[i]).toBe(ramp[i + 1]);
    expect(Math.abs(ramp[i] - ramp[i + 2])).toBeLessThan(6);
  });
});

describe('IEM MRMS archive palette', () => {
  const lut = buildLcrefLut();
  const at = (r: number, g: number, b: number) => {
    const s = 8 - LUT_BITS;
    return lut[((b >> s) * LUT_SIZE + (g >> s)) * LUT_SIZE + (r >> s)];
  };

  it('reads its colors back to the same entries as N0Q (i / 2 − 32 dBZ)', () => {
    // Colors seen in its tiles: lilac at 11 dBZ, green 38, orange 48, dark red 58.
    expect(dbzOf(at(164, 164, 255))).toBe(11);
    expect(dbzOf(at(0, 166, 0))).toBe(38);
    expect(dbzOf(at(255, 166, 0))).toBe(48);
    expect(dbzOf(at(189, 0, 0))).toBe(58);
  });

  it('leaves black (no echo) empty and reads the shared top gray as its lowest entry', () => {
    expect(at(0, 0, 0)).toBe(0);
    expect(dbzOf(at(128, 128, 128))).toBe(81);
  });
});
