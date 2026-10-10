import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseADeck, selectModels } from '../scripts/tropical.mjs';
import {
  binBase,
  category,
  floater,
  modelLines,
  nhcGraphicsPage,
  SLOT,
  stormGraphics,
  stormTitle,
  surgeTiles,
  trackFromNow,
  type ModelGroup,
  type ModelTrack,
  type Storm,
} from '../src/data/tropical';
import { createStore, DEFAULT_MODEL_GROUPS, DEFAULT_TROPICS } from '../src/state';

/** A few a-deck lines: two OFCL runs, one interpolated GFS, its raw run, a stale model, members, an intensity-only aid. */
const ADECK = [
  'AL, 09, 2026100612, 03, OFCL,   0, 220N,  960W,  25, 1008, TD',
  'AL, 09, 2026100612, 03, OFCL,  12, 221N,  955W,  30, 1006, TD',
  'AL, 09, 2026100618, 03, OFCL,   0, 221N,  958W,  30, 1007, TD,  34, NEQ',
  'AL, 09, 2026100618, 03, OFCL,   0, 221N,  958W,  30, 1007, TD,  50, NEQ', // a second radii row for the same tau
  'AL, 09, 2026100618, 03, OFCL,  12, 221N,  950W,  35, 1005, TS',
  'AL, 09, 2026100618, 03, OFCL,  24, 226N,  934W,  45, 1000, TS',
  'AL, 09, 2026100618, 03, AVNI,   0, 221N,  958W,  28,    0, XX',
  'AL, 09, 2026100618, 03, AVNI,  24, 229N,  931W,  40,    0, XX',
  'AL, 09, 2026100612, 03, AVNO,   0, 220N,  960W,  25,    0, XX',
  'AL, 09, 2026100612, 03, AVNO,  24, 228N,  935W,  35,    0, XX',
  'AL, 09, 2026100512, 03, CMCI,   0, 219N,  965W,  20,    0, XX', // 30 h old: stale
  'AL, 09, 2026100512, 03, CMCI,  24, 225N,  950W,  25,    0, XX',
  'AL, 09, 2026100612, 03, AP01,   0, 220N,  960W,  25,    0, XX',
  'AL, 09, 2026100612, 03, AP01,  24, 230N,  940W,  35,    0, XX',
  'AL, 09, 2026100618, 03, SHIP,   0, 221N,  958W,  30,    0, XX',
  'AL, 09, 2026100618, 03, SHIP,  24, 226N,  934W,  50,    0, XX',
  'AL, 09, 2026100618, 03, BAD ,  12,    0,     0,   0,    0, XX', // no position
].join('\n');

describe('ATCF guidance (the data job)', () => {
  const latest = parseADeck(ADECK);

  it("keeps each aid's latest run, one point per tau, positions signed by hemisphere", () => {
    expect(latest.OFCL.init).toBe(Date.UTC(2026, 9, 6, 18));
    expect(latest.OFCL.pts).toEqual([
      [0, 22.1, -95.8, 30],
      [12, 22.1, -95, 35],
      [24, 22.6, -93.4, 45],
    ]);
    expect(latest.BAD).toBeUndefined();
  });

  it('draws only track guidance, prefers interpolated runs, and drops stale ones', () => {
    const picked = selectModels(latest);
    const techs = picked.map((m) => m.tech);
    expect(techs).toContain('OFCL');
    expect(techs).toContain('AVNI'); // the interpolated GFS…
    expect(techs).not.toContain('AVNO'); // …stands in for the raw run
    expect(techs).not.toContain('CMCI'); // 30 hours old
    expect(techs).not.toContain('SHIP'); // intensity-only aid
    expect(picked.find((m) => m.tech === 'AP01')?.group).toBe('member');
    expect(picked.find((m) => m.tech === 'AVNI')?.group).toBe('global');
  });
});

describe('storms', () => {
  it('finds the GIS layers for a storm slot', () => {
    expect(binBase('AT1')).toBe(4);
    expect(binBase('AT4')).toBe(82);
    expect(binBase('EP1')).toBe(134);
    expect(binBase('CP5')).toBe(368);
    expect(binBase('WP1')).toBeNull();
  });

  it('names Saffir–Simpson categories from sustained wind', () => {
    expect(category(30)).toBe('TD');
    expect(category(34)).toBe('TS');
    expect(category(64)).toBe('1');
    expect(category(85)).toBe('2');
    expect(category(100)).toBe('3');
    expect(category(120)).toBe('4');
    expect(category(140)).toBe('5');
  });

  it('titles storms, majors included', () => {
    expect(stormTitle({ classification: 'TD', name: 'Nine', intensityKt: 30 })).toBe('Tropical Depression Nine');
    expect(stormTitle({ classification: 'HU', name: 'Rachel', intensityKt: 70 })).toBe('Hurricane Rachel');
    expect(stormTitle({ classification: 'HU', name: 'Milton', intensityKt: 140 })).toBe('Major Hurricane Milton');
  });

  it('turns the chosen model groups into map lines', () => {
    const storm = {
      models: [
        { tech: 'OFCL', group: 'official', init: 0, pts: [[0, 22, -96, 30], [24, 23, -93, 45]] },
        { tech: 'AP01', group: 'member', init: 0, pts: [[0, 22, -96, 30], [24, 24, -94, 40]] },
      ],
    } as unknown as Storm;
    const lines = modelLines(storm, new Set<ModelGroup>(['official']), 0);
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-96, 22], [-93, 23]] });
  });

  it('draws each model from now on, starting where its run puts the storm now', () => {
    const H = 3_600_000;
    const run = { tech: 'HWRF', group: 'hurricane', init: 0, pts: [[0, 20, -90, 60], [12, 22, -90, 70], [24, 24, -88, 80], [36, 26, -86, 75]] } as const;
    const pts = trackFromNow(run as unknown as ModelTrack, 18 * H);
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(18);
    expect(pts[0][1]).toBeCloseTo(23);
    expect(pts[0][2]).toBeCloseTo(-89);
    expect(pts[0][3]).toBeCloseTo(75);
    expect(pts.slice(1).map((p) => p[0])).toEqual([24, 36]);
    // Exactly on a point: no duplicate; before the run: all of it; after it: nothing.
    expect(trackFromNow(run as unknown as ModelTrack, 24 * H).map((p) => p[0])).toEqual([24, 36]);
    expect(trackFromNow(run as unknown as ModelTrack, -H)).toHaveLength(4);
    expect(trackFromNow(run as unknown as ModelTrack, 40 * H)).toEqual([]);
    // A run entirely in the past isn't drawn.
    const storm = { models: [run] } as unknown as Storm;
    expect(modelLines(storm, new Set<ModelGroup>(['hurricane']), 40 * H).features).toHaveLength(0);
    expect(modelLines(storm, new Set<ModelGroup>(['hurricane']), 30 * H).features[0].geometry).toMatchObject({ type: 'LineString' });
  });
});

describe('what hurricanes show', () => {
  it('finds each part of a storm in its NHC map-service slot', () => {
    // AT1's group is layer 4: its cone is 8, wind field 17, surge image 25.
    expect(binBase('AT1')! + SLOT.cone).toBe(8);
    expect(binBase('AT1')! + SLOT.windField).toBe(17);
    expect(binBase('AT4')! + SLOT.points).toBe(84);
    const tiles = surgeTiles('AT1')!;
    expect(tiles).toContain('layers=show:25');
    expect(tiles).toContain('bbox={bbox-epsg-3857}');
    expect(surgeTiles('WP1')).toBeNull();
  });

  it("links NHC's graphics and NOAA's satellite floater for a storm", () => {
    const g = stormGraphics('al092026');
    expect(g[0].thumb).toBe('https://www.nhc.noaa.gov/storm_graphics/AT09/AL092026_key_messages_sm2.png');
    expect(g[0].full).toBe('https://www.nhc.noaa.gov/storm_graphics/AT09/AL092026_key_messages.png');
    expect(g.at(-1)!.full).toBe('https://www.nhc.noaa.gov/storm_graphics/AT09/AL0926WPCQPF.gif');
    expect(stormGraphics('ep182026')[1].thumb).toContain('/storm_graphics/EP18/EP182026_5day_cone_sm2.png');
    expect(stormGraphics('invest')).toEqual([]);

    const f = floater('ep182026', '13');
    expect(f.still).toBe('https://cdn.star.nesdis.noaa.gov/FLOATER/data/EP182026/13/500x500.jpg');
    expect(f.loop).toBe('https://cdn.star.nesdis.noaa.gov/FLOATER/data/EP182026/13/EP182026-13-1000x1000.gif');
    expect(nhcGraphicsPage('AT4')).toBe('https://www.nhc.noaa.gov/graphics_at4.shtml');
  });
});

describe('hurricane choices are remembered', () => {
  const storage = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      dump: m,
    };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('first load shows only the essentials', () => {
    vi.stubGlobal('localStorage', storage({}));
    const s = createStore({ lat: 0, lon: 0 }, false).get();
    expect(s.layers.tropics).toBe(true);
    const on = Object.entries(s.tropics).filter(([, v]) => v === true).map(([k]) => k).sort();
    expect(on).toEqual(['cone', 'outlook', 'past', 'track', 'warnings']);
    expect(s.tropics.windProb).toBe(0);
    expect(s.modelGroups).toEqual(DEFAULT_MODEL_GROUPS);
    expect(s.modelGroups).not.toContain('member');
  });

  it('fills choices saved by this version with the defaults', () => {
    vi.stubGlobal('localStorage', storage({ 'weather-map:prefs:v2': JSON.stringify({ tropicsV: 2, tropics: { models: true } }) }));
    const store = createStore({ lat: 0, lon: 0 }, false);
    expect(store.get().tropics).toEqual({ ...DEFAULT_TROPICS, models: true });
  });

  it('starts choices saved under the old everything-on defaults over, once', () => {
    const old = { theme: 'classic', tropics: { ...DEFAULT_TROPICS, models: true, windField: true, surge: true }, modelGroups: ['official', 'member'] };
    vi.stubGlobal('localStorage', storage({ 'weather-map:prefs:v2': JSON.stringify(old) }));
    const s = createStore({ lat: 0, lon: 0 }, false).get();
    expect(s.tropics).toEqual(DEFAULT_TROPICS);
    expect(s.modelGroups).toEqual(DEFAULT_MODEL_GROUPS);
    expect(s.theme).toBe('classic');
  });

  it('saves changes and reads them back', () => {
    const ls = storage({});
    vi.stubGlobal('localStorage', ls);
    const store = createStore({ lat: 0, lon: 0 }, false);
    store.set({ tropics: { ...store.get().tropics, cone: false, models: true, windProb: 64 }, modelGroups: ['official', 'member'] });
    const saved = JSON.parse(ls.dump.get('weather-map:prefs:v2')!);
    expect(saved.tropicsV).toBe(2);
    const again = createStore({ lat: 0, lon: 0 }, false).get();
    expect(again.tropics).toEqual({ ...DEFAULT_TROPICS, cone: false, models: true, windProb: 64 });
    expect(again.modelGroups).toEqual(['official', 'member']);
  });
});
