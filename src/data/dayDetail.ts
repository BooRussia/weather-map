import type { HourDetail } from './openmeteo';

/** What the day-detail panel charts (Apple Weather's detail views). */
export type Metric = 'conditions' | 'uv' | 'wind' | 'precip' | 'humidity' | 'visibility' | 'pressure';

export const METRICS: { id: Metric; label: string }[] = [
  { id: 'conditions', label: 'Conditions' },
  { id: 'uv', label: 'UV Index' },
  { id: 'wind', label: 'Wind' },
  { id: 'precip', label: 'Precipitation' },
  { id: 'humidity', label: 'Humidity' },
  { id: 'visibility', label: 'Visibility' },
  { id: 'pressure', label: 'Pressure' },
];

/**
 * One local day's hours, plus the next midnight when there is one so the line reaches 24:00.
 * `own` is how many of them belong to the day (what you can scrub).
 */
export function dayHours(week: HourDetail[], date: string): { hours: HourDetail[]; own: number } {
  const start = week.findIndex((x) => x.time.startsWith(date));
  if (start < 0) return { hours: [], own: 0 };
  let end = start;
  while (end < week.length && week[end].time.startsWith(date)) end++;
  return { hours: week.slice(start, Math.min(week.length, end + 1)), own: end - start };
}

/** Where now falls in the day, in hours from midnight (fractional), or null on another day. */
export function hourOfDay(nowLocal: string, date: string): number | null {
  if (!nowLocal.startsWith(date)) return null;
  return Number(nowLocal.slice(11, 13)) + Number(nowLocal.slice(14, 16)) / 60;
}

export interface Extremes {
  lo: number;
  loAt: number;
  hi: number;
  hiAt: number;
  avg: number;
  sum: number;
}

export function extremes(values: number[]): Extremes {
  let lo = Infinity;
  let hi = -Infinity;
  let loAt = 0;
  let hiAt = 0;
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (v < lo) [lo, loAt] = [v, i];
    if (v > hi) [hi, hiAt] = [v, i];
  });
  return { lo, loAt, hi, hiAt, avg: values.length ? sum / values.length : 0, sum };
}

/** Axis bounds on round numbers, about `ticks` steps apart. */
export function niceScale(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.25 };
  if (hi - lo < 1e-6) hi = lo + 1;
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw - 1e-9) ?? 10 * mag;
  // toPrecision drops float dust (0.15000000000000002).
  const r = (v: number) => +v.toPrecision(12);
  return { min: r(Math.floor(lo / step + 1e-9) * step), max: r(Math.ceil(hi / step - 1e-9) * step), step: r(step) };
}

/** Mean wind direction (vector average), degrees the wind comes from. */
export function meanDirection(degs: number[]): number {
  let x = 0;
  let y = 0;
  for (const d of degs) {
    x += Math.sin((d * Math.PI) / 180);
    y += Math.cos((d * Math.PI) / 180);
  }
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}
