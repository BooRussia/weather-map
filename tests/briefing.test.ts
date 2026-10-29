import { describe, expect, it } from 'vitest';
import { briefing, chanceWord } from '../src/data/briefing';
import type { HourDetail, PointForecast } from '../src/data/openmeteo';

/** Two days of hours: cloud cover and rain chance by hour, everything else plain. */
function forecast(now: string, cloud: (h: number, day: number) => number, pop: (h: number, day: number) => number, code = 2): PointForecast {
  const week: HourDetail[] = [];
  for (const [day, date] of ['2026-10-29', '2026-10-30'].entries()) {
    for (let h = 0; h < 24; h++) {
      week.push({
        time: `${date}T${String(h).padStart(2, '0')}:00`,
        tempF: 75,
        precipitation: 0,
        precipProbability: pop(h, day),
        weatherCode: pop(h, day) >= 20 ? 61 : code,
        windMph: 8,
        windFromDeg: 90,
        gustMph: 12,
        isDay: h >= 7 && h < 19,
        feelsF: 75,
        uv: 3,
        humidity: 60,
        dewF: 60,
        visibilityM: 16000,
        pressureHpa: 1015,
        cloudCover: cloud(h, day),
      });
    }
  }
  const daily = [
    { date: '2026-10-29', hiF: 83, loF: 68, precipProbability: 25, weatherCode: 2, sunrise: '2026-10-29T07:40', sunset: '2026-10-29T18:47', uvMax: 5 },
    { date: '2026-10-30', hiF: 84, loF: 66, precipProbability: 10, weatherCode: 1, sunrise: '2026-10-30T07:41', sunset: '2026-10-30T18:46', uvMax: 5 },
  ];
  return { current: { time: now } as PointForecast['current'], hourly: [], week, daily, minutely: [], utcOffsetSeconds: -4 * 3600 };
}

const deg = (f: number) => `${Math.round(f)}°`;

describe('the day in a sentence', () => {
  it('reads like the owner\'s example in the daytime', () => {
    const f = forecast('2026-10-29T10:00', () => 30, (h, d) => (d === 0 && h >= 13 && h < 16 ? 25 : 0));
    expect(briefing(f, deg)).toBe('Mostly sunny, high of 83°. Slight chance of rain after 1 PM, then mostly clear overnight.');
  });

  it('says so when no rain is expected, and leaves out what has passed', () => {
    const f = forecast('2026-10-29T15:00', (h) => (h >= 18 || h < 6 ? 5 : 80), (h, d) => (d === 0 && h < 12 ? 70 : 0));
    expect(briefing(f, deg)).toBe('Mostly cloudy, high of 83°. No rain expected, then clear overnight.');
  });

  it('leads with the rain when it\'s likely', () => {
    const f = forecast('2026-10-29T09:00', () => 95, (h, d) => (d === 0 && h >= 14 && h < 17 ? 80 : 0));
    expect(briefing(f, deg)).toBe('Rain likely this afternoon, high of 83°. Cloudy tonight, low of 66°.');
  });

  it('turns to tonight and tomorrow from 5 PM', () => {
    const f = forecast('2026-10-29T19:00', (h, d) => (d === 0 || h < 6 ? 5 : 35), (h, d) => (d === 1 && h >= 14 ? 40 : 0));
    expect(briefing(f, deg)).toBe('Clear tonight, low of 66°. Tomorrow mostly sunny, high of 84°, chance of rain after 2 PM.');
  });

  it('words the chances', () => {
    expect(chanceWord(25)).toBe('slight chance');
    expect(chanceWord(45)).toBe('chance');
    expect(chanceWord(70)).toBe('likely');
  });
});
