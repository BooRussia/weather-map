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

describe('single-site radar', () => {
  it('picks the newest scan at or before a moment', async () => {
    const { scanAt } = await import('../src/data/radarSites');
    expect(scanAt([10, 20, 30], 25)).toBe(20);
    expect(scanAt([10, 20, 30], Infinity)).toBe(30);
    expect(scanAt([10, 20, 30], 5)).toBe(10);
    expect(scanAt([], 5)).toBeNull();
  });

  it('names towers the way NWS does', async () => {
    const { siteCall } = await import('../src/data/radarSites');
    expect(siteCall({ id: 'MOB', state: 'AL' })).toBe('KMOB');
    expect(siteCall({ id: 'ABC', state: 'AK' })).toBe('PABC');
    expect(siteCall({ id: 'JUA', state: 'PR' })).toBe('TJUA');
  });

  it('shows the site’s own scans for the past and now, the model ahead', async () => {
    const { makeTimeline, frameSource } = await import('../src/data/timeline');
    const now = Date.parse('2026-10-08T22:40:00Z');
    const init = Date.parse('2026-10-08T22:00:00Z');
    const scans = [Date.parse('2026-10-08T22:21:00Z'), Date.parse('2026-10-08T22:28:00Z'), Date.parse('2026-10-08T22:34:00Z')];
    const t = makeTimeline(now, init, now, { id: 'MOB', product: 'N0B', scans });
    expect(frameSource(t, 0).url).toContain('ridge::MOB-N0B-202610082234');
    expect(frameSource(t, -0.25).url).toContain('ridge::MOB-N0B-202610082221');
    expect(frameSource(t, 1).url).toContain('hrrr::REFD');
    // Velocity has no forecast: the timeline ends at now.
    expect(makeTimeline(now, init, now, { id: 'MOB', product: 'N0S', scans }).maxOffset).toBe(0);
    expect(makeTimeline(now, init, now).maxOffset).toBeGreaterThan(0);
  });

  it('decodes velocity tile colors and colors them toward green, away red', async () => {
    const { buildVelocityLut, buildVelocityRamp, LUT_BITS, LUT_SIZE } = await import('../src/map/radarPalette');
    const lut = buildVelocityLut();
    const slot = (r: number, g: number, b: number) => {
      const s = 8 - LUT_BITS;
      return lut[((b >> s) * LUT_SIZE + (g >> s)) * LUT_SIZE + (r >> s)];
    };
    const toward = slot(2, 252, 2);
    const away = slot(254, 0, 0);
    expect(toward).toBeGreaterThan(0);
    expect(away).toBeGreaterThan(toward);
    expect(slot(10, 20, 30)).toBe(0);
    const ramp = buildVelocityRamp();
    expect(ramp[toward * 4 + 1]).toBeGreaterThan(ramp[toward * 4]);
    expect(ramp[away * 4]).toBeGreaterThan(ramp[away * 4 + 1]);
  });

  it('draws the range ring around the tower', async () => {
    const { ring } = await import('../src/map/radarSitesLayer');
    const r = ring(-88, 30, 110.57);
    const lats = r.geometry.coordinates[0].map((c) => c[1]);
    expect(Math.max(...lats)).toBeCloseTo(31, 1);
    expect(Math.min(...lats)).toBeCloseTo(29, 1);
  });
});

describe('MRMS radar', () => {
  const at = (iso: string) => Date.parse(iso);

  it('reads frame times from the WMS capabilities', async () => {
    const { parseMrmsTimes } = await import('../src/data/mrms');
    const { nearestFrame } = await import('../src/data/frames');
    const xml = '<Layer><Dimension name="time" default="2026-10-09T11:22:12Z" units="ISO8601" nearestValue="1">2026-10-09T11:20:05.000Z,2026-10-09T11:18:13.000Z,2026-10-09T11:22:12.000Z</Dimension></Layer>';
    const times = parseMrmsTimes(xml);
    expect(times.map((t) => new Date(t).toISOString())).toEqual(['2026-10-09T11:18:13.000Z', '2026-10-09T11:20:05.000Z', '2026-10-09T11:22:12.000Z']);
    expect(parseMrmsTimes('<Layer/>')).toEqual([]);
    expect(nearestFrame(times, at('2026-10-09T11:19:30Z'), 180_000)).toBe(at('2026-10-09T11:20:05Z'));
    expect(nearestFrame(times, at('2026-10-09T11:00:00Z'), 180_000)).toBeNull();
  });

  it('shows MRMS now and for the last 2 hours, the IEM archive before, HRRR after', async () => {
    const { makeTimeline, frameSource, tilePalette } = await import('../src/data/timeline');
    const now = at('2026-10-09T11:24:00Z');
    const mrms: number[] = [];
    for (let t = at('2026-10-09T09:24:16Z'); t <= at('2026-10-09T11:22:12Z'); t += 2 * 60_000) mrms.push(t);
    // Satellite rain every 15 minutes, running ~40 minutes behind.
    const sat: number[] = [];
    for (let t = at('2026-10-08T12:00:00Z'); t <= at('2026-10-09T10:45:00Z'); t += 15 * 60_000) sat.push(t);
    const t = makeTimeline(now, at('2026-10-09T10:00:00Z'), at('2026-10-09T11:20:00Z'), null, mrms, sat);
    const live = frameSource(t, 0);
    expect(live.url).toContain('opengeo.ncep.noaa.gov');
    expect(live.url).toContain(`time=${new Date(mrms[mrms.length - 1]).toISOString()}`);
    expect(live.url).toContain('bbox={bbox-epsg-3857}');
    expect(tilePalette(live.url)).toBe('mrms');
    // 11:00 → the 11:00:16 frame.
    const past = frameSource(t, -0.25);
    expect(past.at).toBe(at('2026-10-09T11:00:16Z'));
    expect(tilePalette(past.url)).toBe('mrms');
    // Older than MRMS keeps: the IEM archive.
    const old = frameSource(t, -3);
    expect(old.url).toContain('ridge::USCOMP-N0Q-202610090815');
    expect(tilePalette(old.url)).toBe('n0q');
    expect(frameSource(t, 1).url).toContain('hrrr::REFD');
    // Satellite rain rides along with every observed frame (the newest one it has), never the forecast.
    expect(live.sat).toContain('products=NESDIS-GHE-HourlyRainfall_20261009_104500');
    expect(tilePalette(live.sat!)).toBe('sat');
    expect(old.sat).toContain('_20261009_081500');
    expect(frameSource(t, 1).sat).toBeNull();
    expect(frameSource(makeTimeline(now, null, null, null, mrms, []), 0).sat).toBeNull();
    // No MRMS list: the composite, as before.
    expect(frameSource(makeTimeline(now, null, at('2026-10-09T11:20:00Z')), 0).url).toContain('nexrad-n0q-900913');
    expect(tilePalette('https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::MOB-N0S-202610091100/{z}/{x}/{y}.png')).toBe('velocity');
  });

  it('decodes MRMS colors to dBZ, rounding included, and ignores colors off the ramp', async () => {
    const { buildMrmsLut, MRMS_ANCHORS, entryOf, LUT_BITS, LUT_SIZE } = await import('../src/map/radarPalette');
    const lut = buildMrmsLut();
    const look = (r: number, g: number, b: number) => {
      const s = 8 - LUT_BITS;
      return lut[((b >> s) * LUT_SIZE + (g >> s)) * LUT_SIZE + (r >> s)];
    };
    for (const [dbz, r, g, b] of MRMS_ANCHORS) expect(Math.abs(look(r, g, b) - entryOf(dbz))).toBeLessThanOrEqual(1);
    // Seen on the server: 13,191,19 is three steps past 30 dBZ; 255,142,0 two past 50.
    expect(Math.abs(look(13, 191, 19) - entryOf(31.5))).toBeLessThanOrEqual(1);
    expect(Math.abs(look(255, 142, 0) - entryOf(51))).toBeLessThanOrEqual(1);
    expect(look(0, 0, 255)).toBe(0);
    expect(look(255, 0, 255)).toBe(0);
  });

  it('asks the WMS for each tile by its Mercator bounds', async () => {
    const { tileBbox } = await import('../src/map/radarLayer');
    expect(tileBbox(0, 0, 0)).toBe('-20037508.34,-20037508.34,20037508.34,20037508.34');
    expect(tileBbox(1, 1, 0)).toBe('0.00,0.00,20037508.34,20037508.34');
  });

  it('plans motion tracking only where storms can be followed', async () => {
    const { RadarFlow } = await import('../src/map/radarFlow');
    const field = {} as WebGLTexture;
    // A regional view: ~2 km pixels, 1200 × 800.
    const p = RadarFlow.plan({ field, fieldW: 1200, fieldH: 800, pxKm: 2, minutes: 15 })!;
    expect(p.w * p.h).toBeLessThanOrEqual(16_500);
    expect(p.texKm).toBeGreaterThanOrEqual(2);
    expect(p.reachKm).toBeCloseTo(37.5);
    // Zoomed to a few km across: a storm could cross the view between frames.
    expect(RadarFlow.plan({ field, fieldW: 400, fieldH: 800, pxKm: 0.1, minutes: 15 })).toBeNull();
    // The same frame twice: nothing to track.
    expect(RadarFlow.plan({ field, fieldW: 1200, fieldH: 800, pxKm: 2, minutes: 0 })).toBeNull();
  });
});

describe('satellite rain beyond radar range', () => {
  it('names RealEarth frames and picks the newest one not too old', async () => {
    const { realEarthStamp, realEarthTiles, realEarthTime } = await import('../src/data/realearth');
    const { frameBefore } = await import('../src/data/frames');
    const t = Date.parse('2026-10-09T10:45:00Z');
    expect(realEarthStamp(t)).toBe('20261009_104500');
    expect(realEarthTime('20261009.104500')).toBe(t);
    expect(realEarthTiles('X', t)).toContain('products=X_20261009_104500&x={x}&y={y}&z={z}');
    const times = [t - 30 * 60_000, t - 15 * 60_000, t];
    expect(frameBefore(times, t + 10 * 60_000, 75 * 60_000)).toBe(t);
    expect(frameBefore(times, t - 20 * 60_000, 75 * 60_000)).toBe(t - 30 * 60_000);
    expect(frameBefore(times, t + 2 * 3_600_000, 75 * 60_000)).toBeNull();
  });

  it('reads the satellite rain-rate colors as radar-like reflectivity, and drops the faint blues', async () => {
    const { buildSatLut, SAT_RAIN_BINS, rainDbz, entryOf, LUT_BITS, LUT_SIZE } = await import('../src/map/radarPalette');
    const lut = buildSatLut();
    const sh = 8 - LUT_BITS;
    const look = (r: number, g: number, b: number) => lut[((b >> sh) * LUT_SIZE + (g >> sh)) * LUT_SIZE + (r >> sh)];
    for (const [r, g, b, mmh] of SAT_RAIN_BINS) expect(look(r, g, b)).toBe(entryOf(rainDbz(mmh)));
    expect(rainDbz(10)).toBeCloseTo(39, 0);
    expect(look(0, 82, 255)).toBe(0);
  });

  it('knows where the radars reach', async () => {
    const { RadarCoverage } = await import('../src/map/radarCoverage');
    const cov = new RadarCoverage();
    // Before the radar list arrives nothing is "uncovered" (no satellite over a dry radar).
    expect(cov.open(6, 16, 26)).toBe(false);
    cov.setSites([{ lon: -85.92, lat: 30.56 }]); // KEVX
    expect(cov.ready).toBe(true);
    // z8 tile right over the radar: covered. A tile far out in the Gulf: open.
    const tile = (lon: number, lat: number, z: number) => {
      const n = 2 ** z;
      const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * n;
      return [z, Math.floor(((lon + 180) / 360) * n), Math.floor(y)] as const;
    };
    expect(cov.open(...tile(-85.92, 30.56, 8))).toBe(false);
    expect(cov.open(...tile(-87.8, 26.6, 8))).toBe(true);
  });
});

describe('precipitation type', () => {
  it('reads what is falling from the HRRR tiles: rain, snow, ice, mix', async () => {
    const { buildPtypeLut, PTYPE_CODES, LUT_BITS, LUT_SIZE, buildTypeRamps } = await import('../src/map/radarPalette');
    const lut = buildPtypeLut();
    const sh = 8 - LUT_BITS;
    const look = (r: number, g: number, b: number) => lut[((b >> sh) * LUT_SIZE + (g >> sh)) * LUT_SIZE + (r >> sh)];
    expect(look(0, 108, 44)).toBe(PTYPE_CODES.rain); // dark green
    expect(look(0, 51, 119)).toBe(PTYPE_CODES.snow); // navy
    expect(look(209, 30, 31)).toBe(PTYPE_CODES.ice); // freezing rain red
    expect(look(126, 121, 184)).toBe(PTYPE_CODES.mix); // sleet purple
    expect(look(10, 10, 10)).toBe(0);
    // Four ramps, one row each: snow is blue where rain is green.
    const rows = buildTypeRamps('color');
    const at = (row: number, dbz: number) => [...rows.subarray((row * 256 + Math.round((dbz + 32) * 2)) * 4, (row * 256 + Math.round((dbz + 32) * 2)) * 4 + 4)];
    const [rr, rg] = at(0, 25);
    const [sr, , sb] = at(1, 25);
    expect(rg).toBeGreaterThan(rr);
    expect(sb).toBeGreaterThan(sr);
    // Snow shows from fainter echoes than rain.
    expect(at(1, 12)[3]).toBeGreaterThan(0);
    expect(at(0, 11)[3]).toBe(0);
  });

  it('picks the archived run for the past and the latest run ahead', async () => {
    const { makeTimeline, frameSource, ptypeTiles, tilePalette } = await import('../src/data/timeline');
    const now = Date.parse('2026-10-09T16:10:00Z');
    const t = makeTimeline(now, Date.parse('2026-10-09T14:00:00Z'), null, null, [], []);
    expect(ptypeTiles(t, Date.parse('2026-10-09T09:30:00Z'))).toContain('hrrr::REFP-F0030-202610090900/');
    expect(ptypeTiles(t, Date.parse('2026-10-09T15:45:00Z'))).toContain('hrrr::REFP-F0105-202610091400/');
    expect(frameSource(t, 2).ptype).toContain('hrrr::REFP-F0240-202610091400/');
    expect(tilePalette(frameSource(t, 2).ptype!)).toBe('ptype');
    expect(ptypeTiles(makeTimeline(now, null), now)).toBeNull();
  });
});

describe('satellite clouds (beta)', () => {
  it('keeps clouds and drops the sea and land, by day and by night', async () => {
    const { cloudPixel } = await import('../src/map/cloudCutout');
    // Open sea and land: clear.
    expect(cloudPixel(38, 57, 1)[1]).toBe(0);
    expect(cloudPixel(58, 55, 1)[1]).toBe(0);
    // A thick cloud top: nearly opaque, bright.
    const [lum, alpha] = cloudPixel(200, 228, 1);
    expect(alpha).toBeGreaterThan(220);
    expect(lum).toBeGreaterThan(230);
    // Night: the visible band is dark, the infrared still finds the cold cloud.
    expect(cloudPixel(0, 228, 0)[1]).toBeGreaterThan(220);
    expect(cloudPixel(0, 57, 0)[1]).toBe(0);
  });

  it('knows day from night', async () => {
    const { sunElevation } = await import('../src/map/cloudCutout');
    // Equinox noon on the equator at 0°: sun overhead. Midnight: below the horizon.
    expect(sunElevation(0, 0, Date.parse('2026-03-20T12:07:00Z'))).toBeGreaterThan(85);
    expect(sunElevation(0, 0, Date.parse('2026-03-20T00:07:00Z'))).toBeLessThan(-80);
    // Gulf of Mexico, 12:30 PM CDT in October: well up.
    expect(sunElevation(27, -87, Date.parse('2026-10-09T17:30:00Z'))).toBeGreaterThan(50);
  });
});
