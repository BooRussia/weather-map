import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { StopForecast } from '../src/data/openmeteo';
import { pointAt, toRoute, type RoutePoint } from '../src/data/route';
import { clockAt, dayCount, nextLeave, sampleSchedule, scheduleDrive, zoneOffsetS } from '../src/data/schedule';
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

  it('finds the spot at a given drive time', () => {
    expect(pointAt(route, 300).lon).toBeCloseTo(0.5); // halfway through the first 10 minutes
    expect(pointAt(route, 900)).toMatchObject({ lon: 1.5, m: 1500 }); // a quarter into the second segment
    expect(pointAt(route, 5000)).toMatchObject({ lon: 3, m: 3000 }); // past the end: the destination
  });

  it('samples a nonstop drive by drive time and ends at the destination', () => {
    const [pts] = sampleSchedule(route, { days: [{ fromS: 0, toS: route.duration, leave: 0 }] }, 5);
    expect(pts.map((p) => p.at / MIN)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(pts[pts.length - 1]).toMatchObject({ lon: 3, m: 3000 });
  });

  it('spaces forecast stops every 30 minutes, hourly on very long drives', () => {
    expect(stopSpacing(10 * 3600)).toBe(30);
    expect(stopSpacing(40 * 3600)).toBe(60);
  });
});

describe('overnight stops', () => {
  const H = 3_600_000;
  /** 25 hours of driving due east, one degree an hour. */
  const long = toRoute({
    geometry: {
      coordinates: [
        [0, 0],
        [25, 0],
      ],
    },
    legs: [{ annotation: { duration: [25 * 3600], distance: [2_500_000] } }],
  });
  const utc = async () => 'UTC';
  const depart = Date.UTC(2026, 9, 6, 9); // 9 AM UTC

  it('starts the next day at the morning hour, after at least eight hours of rest', () => {
    // Arrive 11:49 PM: 8 AM is more than 8 h away.
    expect(nextLeave(Date.UTC(2026, 9, 6, 23, 49), 8, 0)).toBe(Date.UTC(2026, 9, 7, 8));
    // Arrive 2 AM: 8 AM is too soon, so 10 AM.
    expect(nextLeave(Date.UTC(2026, 9, 7, 2), 8, 0)).toBe(Date.UTC(2026, 9, 7, 10));
    // 8 AM in a town five hours behind UTC is 13:00 UTC.
    expect(nextLeave(Date.UTC(2026, 9, 6, 23), 8, -5 * 3600)).toBe(Date.UTC(2026, 9, 7, 13));
    // Rounded up to a quarter hour.
    expect(nextLeave(Date.UTC(2026, 9, 7, 2, 7), 8, 0)).toBe(Date.UTC(2026, 9, 7, 10, 15));
  });

  it('reads time-zone offsets, daylight saving included', () => {
    expect(zoneOffsetS('America/Denver', Date.UTC(2026, 9, 6, 12))).toBe(-6 * 3600);
    expect(zoneOffsetS('America/Denver', Date.UTC(2026, 0, 6, 12))).toBe(-7 * 3600);
    expect(zoneOffsetS('UTC', Date.UTC(2026, 9, 6, 12))).toBe(0);
  });

  it('needs the fewest days that fit the limit, finishing a little over rather than adding a short day', () => {
    expect(dayCount(25 * 3600, 10)).toBe(3);
    expect(dayCount(25 * 3600, 12)).toBe(3); // not 12 + 12 + 1… but 24 h 15 min would fit in 2
    expect(dayCount(24.5 * 3600, 12)).toBe(2);
    expect(dayCount(10.5 * 3600, 10)).toBe(1);
    expect(dayCount(40 * 3600, null)).toBe(1);
  });

  it('splits a long drive into equal days, each starting at the morning hour', async () => {
    const sch = await scheduleDrive(long, depart, { maxDriveH: 10, startHour: 8 }, utc);
    const third = 25 / 3;
    expect(sch.days.map((d) => [d.fromS / 3600, d.toS / 3600])).toEqual([
      [0, third],
      [third, 2 * third],
      [2 * third, 25],
    ]);
    // 9 AM start, 8 h 20 min a day: arrive 5:20 PM, leave 8 AM.
    expect(sch.days.map((d) => new Date(d.leave).toISOString().slice(11, 16))).toEqual(['09:00', '08:00', '08:00']);
    expect(clockAt(sch, sch.days[0].toS)).toBe(Date.UTC(2026, 9, 6, 17, 20)); // the boundary is the evening arrival
    expect(clockAt(sch, 25 * 3600)).toBe(Date.UTC(2026, 9, 8, 16, 20));
  });

  it('starts mornings at local time where each night falls', async () => {
    const sch = await scheduleDrive(long, depart, { maxDriveH: 10, startHour: 8 }, async () => 'America/Denver');
    expect(new Date(sch.days[1].leave).toISOString().slice(11, 16)).toBe('14:00'); // 8 AM MDT
  });

  it('drives straight through when nonstop', async () => {
    const sch = await scheduleDrive(long, depart, { maxDriveH: null, startHour: 8 }, utc);
    expect(sch.days).toHaveLength(1);
  });

  it('samples each night as an arrival and a morning departure at the same spot', async () => {
    const sch = await scheduleDrive(long, depart, { maxDriveH: 10, startHour: 8 }, utc);
    const days = sampleSchedule(long, sch, 60);
    const arrive = days[0][days[0].length - 1];
    const leave = days[1][0];
    expect(arrive.lon).toBeCloseTo(25 / 3);
    expect(leave.lon).toBeCloseTo(25 / 3);
    expect(leave.at - arrive.at).toBe(14 * H + 40 * MIN); // 5:20 PM to 8 AM
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

describe('alerts at each stop', () => {
  const box = (w: number, s: number, e: number, n: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  const feature = (props: Record<string, string | null>, g = box(-86, 30, -85, 31)) => ({ type: 'Feature' as const, geometry: g, properties: props });

  it('reads alert times, blank as missing, tropical alerts open-ended', async () => {
    const { alertTimes } = await import('../src/data/tripHazards');
    const t = alertTimes({ phenom: 'TR', onset: '2026-10-09T08:28:00-04:00', ends: ' ', expiration: '2026-10-09T16:30:00-04:00' });
    expect(t.on).toBe(Date.parse('2026-10-09T12:28:00Z'));
    expect(t.off).toBeNull();
    const f = alertTimes({ phenom: 'FA', onset: ' ', ends: ' ', expiration: '2026-10-09T16:30:00-04:00' });
    expect(f.on).toBeNull();
    expect(f.off).toBe(Date.parse('2026-10-09T20:30:00Z'));
  });

  it('lists the alerts over a stop while you are there, warnings first, one line per kind', async () => {
    const { alertsAtStops } = await import('../src/data/tripHazards');
    const at = Date.parse('2026-10-09T15:00:00Z');
    const fc = {
      type: 'FeatureCollection' as const,
      features: [
        feature({ prod_type: 'Flood Watch', phenom: 'FA', sig: 'A', onset: '2026-10-09T12:00:00Z', ends: '2026-10-10T06:00:00Z', expiration: null, url: 'a' }),
        feature({ prod_type: 'Tornado Warning', phenom: 'TO', sig: 'W', onset: '2026-10-09T14:30:00Z', ends: '2026-10-09T15:15:00Z', expiration: null, url: 'b' }),
        // Over, by the time you get there.
        feature({ prod_type: 'Wind Advisory', phenom: 'WI', sig: 'Y', onset: '2026-10-09T08:00:00Z', ends: '2026-10-09T12:00:00Z', expiration: null, url: 'c' }),
        // Somewhere else.
        feature({ prod_type: 'Heat Advisory', phenom: 'HT', sig: 'Y', onset: null, ends: '2026-10-10T00:00:00Z', expiration: null, url: 'd' }, box(-90, 35, -89, 36)),
        // The same statement from two offices.
        feature({ prod_type: 'Tropical Cyclone Local Statement', phenom: 'TR', sig: 'S', onset: null, ends: ' ', expiration: null, url: 'e' }),
        feature({ prod_type: 'Tropical Cyclone Local Statement', phenom: 'TR', sig: 'S', onset: null, ends: ' ', expiration: null, url: 'f' }),
      ],
    };
    const [here, away] = alertsAtStops(fc as never, [
      { lat: 30.5, lon: -85.5, from: at, to: at },
      { lat: 40, lon: -100, from: at, to: at },
    ]);
    expect(here.map((a) => a.title)).toEqual(['Tornado Warning', 'Flood Watch', 'Tropical Cyclone Local Statement']);
    expect(here[0].off).toBe(Date.parse('2026-10-09T15:15:00Z'));
    expect(away).toEqual([]);
  });
});
