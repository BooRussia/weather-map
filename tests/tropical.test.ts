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
  type ModelGroup,
  type Storm,
} from '../src/data/tropical';
import { createStore, DEFAULT_TROPICS } from '../src/state';

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
    const lines = modelLines(storm, new Set<ModelGroup>(['official']));
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-96, 22], [-93, 23]] });
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

  it('fills choices saved by an older version with the defaults', () => {
    vi.stubGlobal('localStorage', storage({ 'weather-map:prefs:v2': JSON.stringify({ tropics: { models: false } }) }));
    const store = createStore({ lat: 0, lon: 0 }, false);
    expect(store.get().tropics).toEqual({ ...DEFAULT_TROPICS, models: false });
  });

  it('moves model groups saved under the old key, and saves changes', () => {
    const ls = storage({ 'weather-map:models:v1': JSON.stringify(['official', 'member']) });
    vi.stubGlobal('localStorage', ls);
    const store = createStore({ lat: 0, lon: 0 }, false);
    expect(store.get().modelGroups).toEqual(['official', 'member']);
    store.set({ tropics: { ...store.get().tropics, cone: false, windProb: 64 } });
    const saved = JSON.parse(ls.dump.get('weather-map:prefs:v2')!);
    expect(saved.tropics.cone).toBe(false);
    expect(saved.tropics.windProb).toBe(64);
    expect(saved.modelGroups).toEqual(['official', 'member']);
  });
});
