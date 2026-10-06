import { describe, expect, it } from 'vitest';
import { buildLut, buildRamp, dbzOf, entryOf, LUT_BITS, LUT_SIZE } from '../src/map/radarPalette';

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
    expect(alpha(10)).toBe(0);
    expect(alpha(20)).toBeGreaterThan(100);
    expect(alpha(45)).toBeGreaterThan(alpha(20));
    // Light rain is green; heavy rain is red.
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
