import { describe, expect, it } from 'vitest';
import { mean, parseOutlooks, windowFor } from '../src/data/climate';
import { stationName, tideAt, type TideEvent } from '../src/data/tides';
import { pollenWord } from '../src/data/airQuality';
import { fireName } from '../src/data/hazards';
import { ovationGrid } from '../src/maps/auroraSource';

describe('averages', () => {
  it('averages only real numbers', () => {
    expect(mean([80, null, 84, undefined])).toBe(82);
    expect(mean([null])).toBeNull();
  });

  it('takes a week either side of the same date, years back', () => {
    expect(windowFor('2026-10-29', 1)).toEqual({ start: '2025-10-22', end: '2025-11-05' });
    // A leap day in a year without one rolls into March, which is close enough for an average.
    expect(windowFor('2028-02-29', 1)).toEqual({ start: '2027-02-22', end: '2027-03-08' });
  });
});

describe('forecast models', () => {
  it('reads yesterday from the blend and each model by day, null past its range', () => {
    const o = parseOutlooks({
      time: ['2026-10-28', '2026-10-29', '2026-10-30'],
      temperature_2m_max_best_match: [83, 86, 85],
      temperature_2m_min_best_match: [68, 70, 71],
      temperature_2m_max_ecmwf_ifs025: [83, 86, 85],
      temperature_2m_min_ecmwf_ifs025: [68, 70, 71],
      precipitation_probability_max_ecmwf_ifs025: [10, 37, 78],
      temperature_2m_max_gfs_seamless: [83, 86, 86],
      temperature_2m_min_gfs_seamless: [68, 69, 70],
      precipitation_probability_max_gfs_seamless: [1, 4, 7],
      temperature_2m_max_icon_seamless: [83, 86, null],
      temperature_2m_min_icon_seamless: [68, 70, null],
      precipitation_probability_max_icon_seamless: [0, 0, null],
    });
    expect(o.yesterday).toEqual({ hiF: 83, loF: 68 });
    expect(o.days.map((d) => d.date)).toEqual(['2026-10-29', '2026-10-30']);
    expect(o.days[0].models[0]).toEqual({ hiF: 86, loF: 70, pop: 37 });
    expect(o.days[1].models[2]).toBeNull();
  });
});

describe('tides', () => {
  const events: TideEvent[] = [
    { time: '2026-10-29T03:58', ft: 3.3, high: true },
    { time: '2026-10-29T12:22', ft: -0.1, high: false },
    { time: '2026-10-29T20:21', ft: 1.8, high: true },
  ];

  it('eases between a high and a low', () => {
    expect(tideAt(events, '2026-10-29T03:58')).toBeCloseTo(3.3);
    expect(tideAt(events, '2026-10-29T12:22')).toBeCloseTo(-0.1);
    // Halfway in time is halfway in height.
    expect(tideAt(events, '2026-10-29T08:10')).toBeCloseTo(1.6, 1);
    expect(tideAt(events, '2026-10-29T01:00')).toBeNull();
  });

  it('names stations in title case', () => {
    expect(stationName('HILLSBOROUGH RIVER ENTRANCE')).toBe('Hillsborough River Entrance');
    expect(stationName('ST. PETERSBURG, TAMPA BAY')).toBe('St. Petersburg, Tampa Bay');
  });
});

describe('pollen', () => {
  it('words the counts', () => {
    expect(pollenWord(3)).toBe('Low');
    expect(pollenWord(30)).toBe('Moderate');
    expect(pollenWord(120)).toBe('High');
    expect(pollenWord(400)).toBe('Very high');
  });
});

describe('fire, flood, and aurora', () => {
  it('names fires once, in title case', () => {
    expect(fireName('GOLD MOUNTAIN')).toBe('Gold Mountain Fire');
    expect(fireName('elk fire')).toBe('Elk Fire');
  });

  it('lays the aurora forecast out west to east from −180°, north to south', () => {
    const g = ovationGrid({
      'Forecast Time': '2026-10-29T18:14:00Z',
      coordinates: [
        [0, 90, 7],
        [180, 65, 40],
        [359, -90, 3],
      ],
    });
    expect([g.cols, g.rows, g.west, g.north]).toEqual([360, 181, -180, 90]);
    expect(g.values[180]).toBe(7); // 0°E at the top row
    expect(g.values[25 * 360 + 0]).toBe(40); // 180° wraps to −180°, 65°N is row 25
    expect(g.values[180 * 360 + 179]).toBe(3); // 359°E is −1°
  });
});
