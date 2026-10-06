import { describe, expect, it } from 'vitest';
import { parseADeck, selectModels } from '../scripts/tropical.mjs';
import { binBase, category, modelLines, stormTitle, type ModelGroup, type Storm } from '../src/data/tropical';

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
