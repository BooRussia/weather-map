import { describe, expect, it } from 'vitest';
import { cloudWord, dayHours, dayOutlook, extremes, hourOfDay, meanDirection, niceScale } from '../src/data/dayDetail';
import { moonPhase, moonTimes } from '../src/data/moon';
import { aqiNote, aqiWord } from '../src/data/airQuality';
import { watchLabels } from '../src/map/alertAreas';
import type { HourDetail } from '../src/data/openmeteo';

const hour = (time: string, tempF = 60): HourDetail => ({
  time,
  tempF,
  precipitation: 0,
  precipProbability: 0,
  weatherCode: 0,
  windMph: 5,
  windFromDeg: 180,
  gustMph: 10,
  isDay: true,
  feelsF: tempF,
  uv: 0,
  humidity: 50,
  dewF: 45,
  visibilityM: 16000,
  pressureHpa: 1015,
  cloudCover: 30,
});

const week = ['2026-10-18', '2026-10-19'].flatMap((d) => Array.from({ length: 24 }, (_, i) => hour(`${d}T${String(i).padStart(2, '0')}:00`, 50 + i)));

describe('day detail', () => {
  it("takes one day's hours plus the next midnight", () => {
    const { hours, own } = dayHours(week, '2026-10-18');
    expect(own).toBe(24);
    expect(hours).toHaveLength(25);
    expect(hours[24].time).toBe('2026-10-19T00:00');
  });

  it('stops at the end of the forecast', () => {
    const { hours, own } = dayHours(week, '2026-10-19');
    expect(own).toBe(24);
    expect(hours).toHaveLength(24);
    expect(dayHours(week, '2026-10-25').own).toBe(0);
  });

  it('places now within today only', () => {
    expect(hourOfDay('2026-10-18T13:45', '2026-10-18')).toBe(13.75);
    expect(hourOfDay('2026-10-18T13:45', '2026-10-19')).toBeNull();
  });

  it('finds the low, the high, and when', () => {
    const e = extremes([5, 2, 9, 4]);
    expect(e).toMatchObject({ lo: 2, loAt: 1, hi: 9, hiAt: 2, sum: 20, avg: 5 });
  });

  it('rounds the scale to friendly steps', () => {
    expect(niceScale(55, 74)).toEqual({ min: 55, max: 75, step: 5 });
    expect(niceScale(0, 0.13)).toEqual({ min: 0, max: 0.15, step: 0.05 });
    expect(niceScale(3, 3).max).toBeGreaterThan(3);
  });

  it('averages wind directions across north', () => {
    expect(Math.round(meanDirection([350, 10]))).toBe(0);
    expect(Math.round(meanDirection([80, 100]))).toBe(90);
  });
});

describe('banner and new tiles', () => {
  it("gives the banner today's highest wind and gusts", () => {
    const hours = week.map((x, i) => ({ ...x, windMph: i === 5 ? 18 : 6, gustMph: i === 5 ? 27 : 10 }));
    expect(dayOutlook(hours, '2026-10-18', 40)).toEqual({ maxWindMph: 18, maxGustMph: 27, pop: 40 });
    expect(dayOutlook(hours, '2026-10-30', 40)).toBeNull();
  });

  it('words cloud cover the way Apple does', () => {
    expect(cloudWord(5)).toBe('Clear');
    expect(cloudWord(55)).toBe('Partly cloudy');
    expect(cloudWord(95)).toBe('Overcast');
  });

  it('knows the moon phase', () => {
    // Full moon 2026-10-26 04:12 UTC; new moon 2026-10-10 15:50 UTC.
    expect(moonPhase(new Date(Date.UTC(2026, 9, 26, 4))).name).toBe('Full moon');
    expect(moonPhase(new Date(Date.UTC(2026, 9, 10, 16))).name).toBe('New moon');
    const q = moonPhase(new Date(Date.UTC(2026, 9, 22, 12)));
    expect(q.name).toBe('Waxing gibbous');
    expect(q.daysToFull).toBe(4);
    expect(q.illumination).toBeGreaterThan(0.6);
  });
});

describe('watch labels', () => {
  it('names each watch once, in the middle of its area, and leaves warnings and tropical alerts alone', () => {
    const item = (sig: 'W' | 'A', phenom: string, prod: string) => ({
      id: prod,
      props: { prod_type: prod, sig, phenom, url: '', expiration: '', ends: '', wfo: 'KTBW', cap_id: prod } as never,
      box: { west: -84, east: -82, south: 28, north: 30 },
    });
    const fc = watchLabels([item('A', 'TO', 'Tornado Watch'), item('W', 'TO', 'Tornado Warning'), item('A', 'TR', 'Tropical Storm Watch')]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-83, 29] });
    expect(fc.features[0].properties?.prod_type).toBe('Tornado Watch');
  });
});

describe('moon and air for the long cards', () => {
  // Ocala, 23 October 2026 (Eastern Daylight Time, UTC-4): Apple shows moonrise 17:11 and the full moon in 3 days.
  const midnight = Date.UTC(2026, 9, 23, 4);
  it('times the moonrise within a few minutes of Apple', () => {
    const { rise } = moonTimes(midnight, 29.19, -82.14);
    const local = (rise! - midnight) / 3_600_000;
    expect(local).toBeGreaterThan(16.9);
    expect(local).toBeLessThan(17.4);
  });

  it('counts calendar days to the full moon', () => {
    const m = moonPhase(new Date(Date.UTC(2026, 9, 23, 17, 47)));
    const fullLocal = new Date(m.nextFull.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
    expect(fullLocal).toBe('2026-10-26');
  });

  it('words the air quality like Apple', () => {
    expect(aqiWord(54)).toBe('Moderate');
    expect(aqiNote({ aqi: 54, yesterday: 50, pollen: null })).toBe('Air quality index is 54, which is similar to yesterday at about this time.');
    expect(aqiNote({ aqi: 120, yesterday: 60, pollen: null })).toContain('worse than yesterday');
  });
});
