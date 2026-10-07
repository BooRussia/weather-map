import { describe, expect, it } from 'vitest';
import { readGeoTiff } from '../src/maps/geotiff';
import { isoDuration, parseTimes, slots } from '../src/maps/geometSource';
import { parseColormap } from '../src/maps/gibsSource';
import { sampleGrid } from '../src/maps/fieldController';
import { buildFieldRamp, rampDomain } from '../src/map/fieldLayer';
import { WEATHER_MAPS, formatValue, plainLabel, weatherMap } from '../src/maps/catalog';

/** A tiny GeoTIFF like GeoMet's: little-endian, one float32 band, one strip, corner tie point. */
function tiff(cols: number, rows: number, values: number[], west: number, north: number, dx: number, dy: number): ArrayBuffer {
  const entries: [tag: number, type: number, count: number, value: number][] = [];
  const header = 8;
  const nTags = 10;
  const ifdSize = 2 + nTags * 12 + 4;
  const scaleAt = header + ifdSize;
  const tieAt = scaleAt + 24;
  const dataAt = tieAt + 48;
  entries.push([256, 3, 1, cols], [257, 3, 1, rows], [258, 3, 1, 32], [259, 3, 1, 1], [273, 4, 1, dataAt]);
  entries.push([277, 3, 1, 1], [279, 4, 1, cols * rows * 4], [339, 3, 1, 3], [33550, 12, 3, scaleAt], [33922, 12, 6, tieAt]);
  const buf = new ArrayBuffer(dataAt + cols * rows * 4);
  const v = new DataView(buf);
  v.setUint8(0, 0x49);
  v.setUint8(1, 0x49);
  v.setUint16(2, 42, true);
  v.setUint32(4, header, true);
  v.setUint16(header, nTags, true);
  entries.forEach(([tag, type, count, value], i) => {
    const e = header + 2 + i * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, count, true);
    if (type === 3) v.setUint16(e + 8, value, true);
    else v.setUint32(e + 8, value, true);
  });
  [dx, dy, 0].forEach((x, i) => v.setFloat64(scaleAt + i * 8, x, true));
  [0, 0, 0, west, north, 0].forEach((x, i) => v.setFloat64(tieAt + i * 8, x, true));
  values.forEach((x, i) => v.setFloat32(dataAt + i * 4, x, true));
  return buf;
}

describe('GeoTIFF from GeoMet', () => {
  it('reads float32 values and where they are', () => {
    const r = readGeoTiff(tiff(3, 2, [1, 2, 3, 4, 5, 6.5], -100, 35, 0.5, 0.25));
    expect(r).toMatchObject({ west: -100, north: 35, dx: 0.5, dy: 0.25, cols: 3, rows: 2 });
    expect([...r.values]).toEqual([1, 2, 3, 4, 5, 6.5]);
  });

  it('refuses what it would misread', () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><ServiceExceptionReport/>').buffer;
    expect(() => readGeoTiff(xml as ArrayBuffer)).toThrow('not a TIFF');
  });
});

describe('GeoMet times and runs', () => {
  const H = 3_600_000;
  const t = (s: string) => Date.parse(s);

  it('reads ISO durations and time lists in both forms', () => {
    expect(isoDuration('PT1H')).toBe(H);
    expect(isoDuration('PT3H')).toBe(3 * H);
    expect(isoDuration('P1D')).toBe(24 * H);
    expect(parseTimes('2026-10-06T12:00:00Z,2026-10-06T13:00:00Z')).toEqual([t('2026-10-06T12:00:00Z'), t('2026-10-06T13:00:00Z')]);
    expect(parseTimes('2026-10-05T00:00:00Z/2026-10-06T00:00:00Z/PT12H')).toHaveLength(3);
  });

  it('fills the past from older runs, each until the next run starts', () => {
    const refs = parseTimes('2026-10-05T12:00:00Z/2026-10-06T12:00:00Z/PT12H');
    const times = parseTimes('2026-10-06T12:00:00Z/2026-10-08T00:00:00Z/PT1H');
    const s = slots({ times, refs }, t('2026-10-06T02:00:00Z'), t('2026-10-06T14:00:00Z'));
    const at = (iso: string) => s.find((x) => x.shown === t(iso));
    // 02Z comes from the 00Z run; 12Z on from the newest (12Z) run.
    expect(at('2026-10-06T02:00:00Z')?.ref).toBe(t('2026-10-06T00:00:00Z'));
    expect(at('2026-10-06T11:00:00Z')?.ref).toBe(t('2026-10-06T00:00:00Z'));
    expect(at('2026-10-06T12:00:00Z')?.ref).toBe(t('2026-10-06T12:00:00Z'));
    expect(s.map((x) => x.shown)).toEqual([...new Set(s.map((x) => x.shown))].sort((a, b) => a - b));
  });

  it('shows "next 24 h" accumulations at the moment they start', () => {
    const refs = [t('2026-10-06T12:00:00Z')];
    // Accum24h: valid from 24 h after the run, every 6 h.
    const times = parseTimes('2026-10-07T12:00:00Z/2026-10-08T12:00:00Z/PT6H');
    const s = slots({ times, refs }, t('2026-10-06T00:00:00Z'), t('2026-10-07T12:00:00Z'), 24 * H);
    expect(s[0]).toEqual({ shown: t('2026-10-06T12:00:00Z'), valid: t('2026-10-07T12:00:00Z'), ref: refs[0] });
  });
});

describe('weather map colors and units', () => {
  it('spreads small values over more of a sqrt ramp', () => {
    const rain = weatherMap('rain')!.ramp;
    const [lo, hi] = rampDomain(rain);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(Math.sqrt(50));
    const lut = buildFieldRamp(rain);
    // 1 mm/h sits ~14% along a sqrt ramp (it would be 2% on a linear one), already visible.
    const k = Math.round((1 / Math.sqrt(50)) * 255) * 4;
    expect(lut[k + 3]).toBeGreaterThan(150);
    expect(lut[3]).toBe(0);
  });

  it('keeps every ramp in ascending order', () => {
    for (const m of WEATHER_MAPS) {
      const v = m.ramp.stops.map((s) => s[0]);
      expect(v, m.id).toEqual([...v].sort((a, b) => a - b));
    }
  });

  it('formats values in the viewer’s units', () => {
    const us = { temp: 'F' as const, wind: 'mph' as const };
    const metric = { temp: 'C' as const, wind: 'kmh' as const };
    expect(formatValue(weatherMap('temp')!, 25, us)).toBe('77°F');
    expect(formatValue(weatherMap('temp')!, 25, metric)).toBe('25°C');
    expect(formatValue(weatherMap('wind')!, 10, us)).toBe('22 mph');
    expect(formatValue(weatherMap('waves')!, 2, us)).toBe('7 ft');
    expect(formatValue(weatherMap('pressure')!, 1013.25, us)).toBe('29.92 inHg');
    expect(plainLabel(weatherMap('thunder')!)).toBe('Thunderstorms');
  });
});

describe('infrared colors back to temperatures', () => {
  it('reads NASA’s colormap bins', () => {
    const xml = `<ColorMapEntry rgb="255,255,255" transparent="false" sourceValue="(-92.1,-91.1]" value="(-92.1,-91.1]" ref="0"/>
      <ColorMapEntry rgb="50,50,50" transparent="false" sourceValue="(37.9,38.4]" value="(37.9,38.4]" ref="142"/>
      <ColorMapEntry rgb="0,0,0" transparent="true" nodata="true" ref="162"/>`;
    const e = parseColormap(xml);
    expect(e).toHaveLength(2);
    expect(e[0]).toEqual({ rgb: 0xffffff, value: -91.6 });
    expect(e[1].value).toBeCloseTo(38.15);
  });
});

describe('sampling a weather map', () => {
  it('interpolates between lattice points and says NaN outside', () => {
    const g = { west: 0, east: 2, south: 0, north: 2, cols: 3, rows: 3, values: new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]) };
    expect(sampleGrid(g, 0.5, 1)).toBeCloseTo(0.5);
    expect(sampleGrid(g, 2, 0)).toBeCloseTo(2);
    expect(sampleGrid(g, 3, 1)).toBeNaN();
  });
});
