import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { StopForecast } from '../src/data/openmeteo';
import { sampleRoute, toRoute, type RoutePoint } from '../src/data/route';
import { stopSpacing } from '../src/data/trip';
import { forecastHazards, inPolygon, overlaps, sortHazards, stopFlags, windowIn, type Hazard } from '../src/data/tripHazards';
import { durationText, lightWeather } from '../src/ui/trip';

const MIN = 60_000;

/** Three vertices due east: 10 minutes, then 20 minutes. */
const route = toRoute({
  geometry: {
    coordinates: [
      [0, 0],
      [1, 0],
      [3, 0],
    ],
  },
  legs: [{ annotation: { duration: [600, 1200], distance: [1000, 2000] } }],
});

const dry: StopForecast = {
  tempF: 70,
  precipProbability: 0,
  precipitation: 0,
  weatherCode: 1,
  gustMph: 10,
  visibilityM: 20_000,
  isDay: true,
};

const at = (min: number, lon = min): RoutePoint => ({ lat: 0, lon, at: min * MIN, m: min * 100 });

describe('route', () => {
  it('accumulates time and distance along the geometry', () => {
    expect(route.secs).toEqual([0, 600, 1800]);
    expect(route.meters).toEqual([0, 1000, 3000]);
    expect(route.duration).toBe(1800);
  });

  it('samples by drive time, interpolating between vertices, and ends at the destination', () => {
    const pts = sampleRoute(route, 0, 5);
    expect(pts.map((p) => p.at / MIN)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(pts[1].lon).toBeCloseTo(0.5); // halfway through the first 10 minutes
    expect(pts[3].lon).toBeCloseTo(1.5); // a quarter into the second segment
    expect(pts[pts.length - 1]).toMatchObject({ lon: 3, m: 3000 });
  });

  it('spaces forecast stops every 30 minutes, hourly on very long drives', () => {
    expect(stopSpacing(10 * 3600)).toBe(30);
    expect(stopSpacing(40 * 3600)).toBe(60);
  });
});

describe('hazard areas', () => {
  const square: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [9.5, -1],
        [20.5, -1],
        [20.5, 1],
        [9.5, 1],
        [9.5, -1],
      ],
      [
        [14, -0.5],
        [16, -0.5],
        [16, 0.5],
        [14, 0.5],
        [14, -0.5],
      ],
    ],
  };

  it('tests points against polygons, holes included', () => {
    expect(inPolygon(12, 0, square)).toBe(true);
    expect(inPolygon(15, 0, square)).toBe(false); // in the hole
    expect(inPolygon(25, 0, square)).toBe(false);
  });

  it('finds when the route is inside an area', () => {
    const samples = Array.from({ length: 31 }, (_, i) => at(i));
    const w = windowIn(samples, square)!;
    expect(w.from).toBe(10 * MIN);
    expect(w.to).toBe(20 * MIN);
    expect(w.where.lon).toBe(10);
  });

  it('falls back to the nearest sample when the line only clips an area', () => {
    const tiny: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [7.4, -0.1],
          [7.6, -0.1],
          [7.6, 0.1],
          [7.4, 0.1],
          [7.4, -0.1],
        ],
      ],
    };
    const w = windowIn([at(0), at(5), at(10)], tiny)!;
    expect(w.where.lon).toBe(5);
  });

  it('compares time windows', () => {
    expect(overlaps(0, 10, 10, 20)).toBe(true);
    expect(overlaps(0, 10, 11, 20)).toBe(false);
  });
});

describe('forecast hazards', () => {
  it('flags driving weather', () => {
    expect(stopFlags(dry)).toEqual([]);
    expect(stopFlags({ ...dry, weatherCode: 95 }).map((f) => f.title)).toEqual(['Thunderstorms']);
    expect(stopFlags({ ...dry, weatherCode: 99 })[0].level).toBe('severe');
    expect(stopFlags({ ...dry, weatherCode: 66 })[0].title).toBe('Freezing rain');
    expect(stopFlags({ ...dry, weatherCode: 63, precipitation: 8 }).map((f) => f.title)).toEqual(['Heavy rain']);
    expect(stopFlags({ ...dry, weatherCode: 61, precipitation: 1 }).map((f) => f.title)).toEqual(['Rain']);
    expect(stopFlags({ ...dry, visibilityM: 400 }).map((f) => f.title)).toEqual(['Fog']);
    expect(stopFlags({ ...dry, gustMph: 45 }).map((f) => f.title)).toEqual(['Strong wind gusts']);
    // Thunderstorms already say rain.
    expect(stopFlags({ ...dry, weatherCode: 95, precipitation: 2, precipProbability: 80 }).map((f) => f.title)).toEqual(['Thunderstorms']);
  });

  it('joins nearby stretches of the same weather and splits distant ones', () => {
    const rain = [{ kind: 'rain' as const, level: 'info' as const, title: 'Rain' }];
    // Rain at 0 and 120, dry between: two stretches.
    const apart = [0, 30, 60, 90, 120].map((m, i) => ({ ...at(m), flags: i === 0 || i === 4 ? rain : [] }));
    expect(forecastHazards(apart).map((h) => [h.from / MIN, h.to / MIN])).toEqual([
      [0, 0],
      [120, 120],
    ]);
    // Rain at 0 and 60 with one dry stop between: one stretch.
    const gappy = [0, 30, 60].map((m, i) => ({ ...at(m), flags: i === 1 ? [] : rain }));
    expect(forecastHazards(gappy).map((h) => [h.from / MIN, h.to / MIN])).toEqual([[0, 60]]);
  });

  it('sorts worst and soonest first, things that won’t affect you last', () => {
    const base: Hazard = { kind: 'rain', level: 'info', source: 'Forecast', title: '', detail: '', from: 0, to: 0, where: at(0), active: true };
    const sorted = sortHazards([
      { ...base, title: 'past', level: 'severe', active: false },
      { ...base, title: 'info' },
      { ...base, title: 'late caution', level: 'caution', from: 50 },
      { ...base, title: 'early caution', level: 'caution', from: 10 },
    ]);
    expect(sorted.map((h) => h.title)).toEqual(['early caution', 'late caution', 'info', 'past']);
  });
});

describe('trip text', () => {
  it('formats drive time', () => {
    expect(durationText(45 * 60)).toBe('45 min');
    expect(durationText(6 * 3600 + 37 * 60)).toBe('6 h 37 min');
    expect(durationText(3 * 3600)).toBe('3 h');
  });

  it('sums up light weather in a sentence', () => {
    expect(lightWeather([{ kind: 'rain', title: 'Rain' }])).toBe('Some rain.');
    expect(
      lightWeather([
        { kind: 'thunder', title: 'Thunderstorms possible' },
        { kind: 'flood', title: 'Flash flooding possible' },
        { kind: 'rain', title: 'Rain' },
        { kind: 'rain', title: 'Rain' },
      ]),
    ).toBe('A chance of storms, a low flash-flood risk, and some rain.');
  });
});
