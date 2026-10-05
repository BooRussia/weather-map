import { describe, expect, it } from 'vitest';
import { clockLabel, formatMinutes, glyphFor, hourlyCells, nextRain, uvWord, weekRows } from '../src/data/outlook';
import type { DailyPoint, HourlyPoint, MinutelyPoint } from '../src/data/openmeteo';

const slots = (mm: number[]): MinutelyPoint[] =>
  mm.map((precipitation, i) => ({ time: `2026-10-05T18:${String(i * 15).padStart(2, '0')}`, precipitation }));

describe('next 2 hours', () => {
  it('says so when it stays dry', () => {
    expect(nextRain(slots([0, 0, 0, 0, 0, 0, 0, 0])).sentence).toBe('No rain expected in the next 2 hr.');
  });

  it('names heavy rain that lasts the whole window', () => {
    // 2 mm per 15 min = 8 mm/h, over the NWS heavy threshold.
    expect(nextRain(slots([2, 2, 2.1, 1.2, 0.6, 0.9, 0.7, 0.5])).sentence).toBe('Heavy rain for the next 2 hr.');
  });

  it('says when rain stops', () => {
    expect(nextRain(slots([1, 1, 0, 0, 0, 0, 0, 0])).sentence).toBe('Rain stopping in about 30 min.');
  });

  it('says when rain starts, using the intensity of that rain', () => {
    expect(nextRain(slots([0, 0, 0, 0.1, 0.2, 0, 0, 0])).sentence).toBe('Light rain starting in about 45 min.');
    expect(nextRain(slots([0, 0, 0, 0, 0, 0, 3, 3])).sentence).toBe('Heavy rain starting in about 1 hr 30 min.');
  });

  it('scales bars with a floor at zero and a cap at one', () => {
    const r = nextRain(slots([0, 0.01, 10, 0, 0, 0, 0, 0]));
    expect(r.levels[0]).toBe(0);
    expect(r.levels[1]).toBeGreaterThan(0);
    expect(r.levels[2]).toBe(1);
  });

  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(90)).toBe('1 hr 30 min');
  });
});

describe('glyphs', () => {
  it('maps WMO codes to day/night glyphs', () => {
    expect(glyphFor(0, true)).toBe('clear-day');
    expect(glyphFor(1, false)).toBe('clear-night');
    expect(glyphFor(2, false)).toBe('partly-night');
    expect(glyphFor(3)).toBe('cloudy');
    expect(glyphFor(45)).toBe('fog');
    expect(glyphFor(63)).toBe('rain');
    expect(glyphFor(81)).toBe('rain');
    expect(glyphFor(73)).toBe('snow');
    expect(glyphFor(95)).toBe('thunder');
  });
});

describe('hourly strip', () => {
  const hour = (h: number): HourlyPoint => ({
    time: `2026-10-05T${String(h).padStart(2, '0')}:00`,
    tempF: 80 - (h - 18),
    precipitation: 0,
    precipProbability: 40,
    weatherCode: 3,
    windMph: 5,
    windFromDeg: 90,
    gustMph: 10,
    isDay: h < 19,
  });
  const day: DailyPoint = {
    date: '2026-10-05',
    hiF: 87,
    loF: 72,
    precipProbability: 50,
    weatherCode: 61,
    sunrise: '2026-10-05T07:25',
    sunset: '2026-10-05T19:17',
    uvMax: 5,
  };

  it('drops sunset in right after the hour it falls in', () => {
    const cells = hourlyCells([hour(18), hour(19), hour(20)], [day]);
    expect(cells.map((c) => c.label)).toEqual(['Now', '7 PM', '7:17 PM', '8 PM']);
    expect(cells[2]).toMatchObject({ kind: 'sun', event: 'Sunset' });
  });

  it('labels clock times', () => {
    expect(clockLabel('2026-10-05T00:00', false)).toBe('12 AM');
    expect(clockLabel('2026-10-05T12:30')).toBe('12:30 PM');
    expect(clockLabel('2026-10-05T19:00')).toBe('7 PM');
  });
});

describe('7 days', () => {
  const d = (date: string, loF: number, hiF: number): DailyPoint => ({
    date,
    hiF,
    loF,
    precipProbability: 30,
    weatherCode: 3,
    sunrise: `${date}T07:25`,
    sunset: `${date}T19:17`,
    uvMax: 4,
  });

  it('puts every day on one shared scale with a now tick on today', () => {
    const rows = weekRows([d('2026-10-05', 70, 80), d('2026-10-06', 60, 90)], 75);
    expect(rows[0].label).toBe('Today');
    expect(rows[1].label).toBe('Tue');
    expect(rows[1].left).toBe(0);
    expect(rows[1].width).toBe(1);
    expect(rows[0].left).toBeCloseTo(10 / 30);
    expect(rows[0].now).toBeCloseTo(15 / 30);
    expect(rows[1].now).toBeNull();
  });

  it('names UV levels', () => {
    expect(uvWord(1)).toBe('Low');
    expect(uvWord(6)).toBe('High');
    expect(uvWord(11)).toBe('Extreme');
  });
});
