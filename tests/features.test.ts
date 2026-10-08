import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatHashView, parseHashView } from '../src/data/view';
import { groupAlerts } from '../src/map/alertAreas';
import { alertColor, alertColorExpression } from '../src/data/alertColors';
import { getOutlookAreas } from '../src/data/outlooks';
import type { AlertAreaProps } from '../src/data/warnings';
import type { Feature, Geometry } from 'geojson';

describe('map position in the address bar', () => {
  it('reads and writes #map=zoom/lat/lon', () => {
    expect(parseHashView('#map=6.50/30.0000/-88.0000')).toEqual({ zoom: 6.5, lat: 30, lon: -88 });
    expect(parseHashView('#foo=1&map=7/29.05/-82.46')).toEqual({ zoom: 7, lat: 29.05, lon: -82.46 });
    expect(formatHashView({ zoom: 6.5, lat: 30, lon: -88 })).toBe('#map=6.50/30.0000/-88.0000');
  });

  it('ignores nonsense', () => {
    expect(parseHashView('')).toBeNull();
    expect(parseHashView('#map=6/95/-88')).toBeNull();
    expect(parseHashView('#map=abc/1/2')).toBeNull();
  });
});

describe('alerts in view', () => {
  const zone = (cap: string, prod: string, coords: [number, number][]): Feature<Geometry, AlertAreaProps> => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: { prod_type: prod, phenom: 'HU', sig: 'W', url: `https://api.weather.gov/alerts/${cap}`, expiration: '2026-10-09T01:00:00-04:00', ends: ' ', wfo: 'KMOB', cap_id: cap },
  });

  it('groups an alert’s zones into one item with a box around them all', () => {
    const items = groupAlerts([
      zone('a', 'Hurricane Warning', [[-88, 30], [-87, 30], [-87, 31], [-88, 30]]),
      zone('a', 'Hurricane Warning', [[-86, 29], [-85, 29], [-85, 30.5], [-86, 29]]),
      zone('b', 'Hurricane Warning', [[-90, 29], [-89, 29], [-89, 30], [-90, 29]]),
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === 'a')!.box).toEqual({ west: -88, east: -85, south: 29, north: 31 });
  });

  it('colors alerts the NWS way', () => {
    expect(alertColor('TO', 'W')).toBe('#ff0000');
    expect(alertColor('SV', 'W')).toBe('#ffa500');
    expect(alertColor('TO', 'A')).toBe('#ffff00');
    // Unknown types still get a warning or watch color.
    expect(alertColor('ZZ', 'W')).toBe('#ff9f0a');
    const expr = alertColorExpression();
    expect(expr[0]).toBe('match');
    expect(expr).toContain('TO.W');
  });
});

describe('storm outlooks', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  const square = { type: 'Polygon', coordinates: [[[-90, 30], [-89, 30], [-89, 31], [-90, 30]]] };

  it('names SPC risks in plain words and keeps SPC’s colors', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: square, properties: { label: 'TSTM', label2: 'General Thunderstorms Risk', dn: 2, fill: '#C1E9C1', stroke: '#55BB55' } },
          { type: 'Feature', geometry: square, properties: { label: 'SLGT', label2: 'Slight Risk', dn: 4, fill: '#F6F67F', stroke: '#DDDD00' } },
        ],
      }),
    );
    const fc = await getOutlookAreas('severe', 1);
    expect(fc.features.map((f) => f.properties.name)).toEqual(['Thunderstorms', 'Slight risk']);
    expect(fc.features[1].properties).toMatchObject({ rank: 4, fill: '#F6F67F' });
  });

  it('turns WPC’s rainfall outlook into the same shape, colored like SPC', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square, properties: { outlook: 'Moderate (At Least 40%)' } }] }),
    );
    const fc = await getOutlookAreas('flood', 2);
    expect(fc.features[0].properties).toMatchObject({ name: 'Moderate risk', rank: 5, fill: '#e67f7f' });
  });
});

describe('storm tracks', () => {
  afterEach(() => vi.unstubAllGlobals());
  const attr = (over: Record<string, unknown>) => ({
    nexrad: 'MOB',
    storm_id: 'J2',
    tvs: 'NONE',
    meso: 'NONE',
    posh: 0,
    poh: 0,
    max_size: 0,
    max_dbz: 55,
    max_dbz_height: 12,
    top: 30,
    drct: 270,
    sknt: 20,
    valid: '2026-10-08T22:00:00Z',
    ...over,
  });

  it('reads a cell: heading is where it goes, threats rank tornado over rotation over hail', async () => {
    const { toCell } = await import('../src/data/stormCells');
    const c = toCell(attr({}) as never, -88, 30);
    expect(c.heading).toBe(90);
    expect(c.speedMph).toBeCloseTo(23, 0);
    expect(c.threat).toBe('storm');
    expect(toCell(attr({ max_size: 1.25 }) as never, 0, 0).threat).toBe('hail');
    expect(toCell(attr({ meso: '7', max_size: 2 }) as never, 0, 0).threat).toBe('rotation');
    expect(toCell(attr({ tvs: 'TVS', meso: '7' }) as never, 0, 0).threat).toBe('tornado');
  });

  it('treats glitched and brand-new tracks as unknown motion', async () => {
    const { toCell } = await import('../src/data/stormCells');
    expect(toCell(attr({ sknt: 99 }) as never, 0, 0).moving).toBe(false);
    expect(toCell(attr({ sknt: 0, drct: 0 }) as never, 0, 0).moving).toBe(false);
    expect(toCell(attr({ sknt: 0, drct: 0 }) as never, 0, 0).speedMph).toBe(0);
  });

  it('projects the path along the heading', async () => {
    const { project } = await import('../src/data/stormCells');
    const [lon, lat] = project(-88, 30, 0, 69.05);
    expect(lon).toBeCloseTo(-88);
    expect(lat).toBeCloseTo(31);
    const [lon2] = project(-88, 0, 90, 69.17);
    expect(lon2).toBeCloseTo(-87);
  });

  it('drops shallow clutter and keeps one cell where radars overlap', async () => {
    const { getStormCells } = await import('../src/data/stormCells');
    const pt = (lon: number, lat: number, p: Record<string, unknown>) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: attr(p) });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [
                pt(-83.2, 36.2, { nexrad: 'MRX', max_dbz: 73, top: 3 }),
                pt(-81.3, 28.3, { nexrad: 'MCO', max_dbz: 58 }),
                pt(-81.3001, 28.3001, { nexrad: 'MLB', max_dbz: 52 }),
              ],
            }),
          ),
      ),
    );
    const cells = await getStormCells();
    expect(cells.map((c) => c.key)).toEqual(['MCO J2']);
  });

  it('sorts reports into tornado, hail, wind, and flood', async () => {
    const { reportKind } = await import('../src/data/stormCells');
    expect(reportKind('TORNADO')).toBe('tornado');
    expect(reportKind('FUNNEL CLOUD')).toBe('tornado');
    expect(reportKind('MARINE HAIL')).toBe('hail');
    expect(reportKind('TSTM WND DMG')).toBe('wind');
    expect(reportKind('FLASH FLOOD')).toBe('flood');
    expect(reportKind('SNOW')).toBe('other');
  });
});

describe('live lightning', () => {
  it('reads RealEarth frame times and flash colors', async () => {
    const { realEarthTime, flashLevel } = await import('../src/data/lightning');
    expect(new Date(realEarthTime('20261008.222400')).toISOString()).toBe('2026-10-08T22:24:00.000Z');
    expect(realEarthTime('nope')).toBeNaN();
    // Dark blue is a flash or two; brighter blue more; cyan and beyond many.
    expect(flashLevel(0, 0, 150)).toBe(1);
    expect(flashLevel(0, 28, 255)).toBe(2);
    expect(flashLevel(0, 140, 255)).toBe(3);
    expect(flashLevel(200, 200, 255)).toBe(4);
  });
});
