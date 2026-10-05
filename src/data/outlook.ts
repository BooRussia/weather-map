import type { DailyPoint, HourlyPoint, MinutelyPoint } from './openmeteo';

/* ---------- condition glyphs ---------- */

export type Glyph = 'clear-day' | 'clear-night' | 'partly-day' | 'partly-night' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunder';

/** WMO weather code → one of nine line glyphs. */
export function glyphFor(code: number, isDay = true): Glyph {
  if (code <= 1) return isDay ? 'clear-day' : 'clear-night';
  if (code === 2) return isDay ? 'partly-day' : 'partly-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}

/* ---------- next 2 hours ---------- */

/** mm/h at which a 15-minute bar is full height. */
const FULL_BAR_MM_H = 10;
const WET_MM_H = 0.1;
/** NWS thresholds: heavy ≥ 0.3 in/h (7.6 mm/h), light < 0.1 in/h (2.5 mm/h). */
const HEAVY_MM_H = 7.6;
const LIGHT_MM_H = 2.5;

export interface NextRain {
  /** One plain sentence, e.g. "Heavy rain stopping in about 45 min." */
  sentence: string;
  /** Bar heights 0..1, one per 15-minute slot (sqrt scale so drizzle still shows). */
  levels: number[];
  /** mm/h per slot, for labels and the accessible table. */
  rates: number[];
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function nextRain(slots: MinutelyPoint[]): NextRain {
  const rates = slots.map((s) => s.precipitation * 4);
  const levels = rates.map((r) => (r <= 0 ? 0 : Math.min(1, Math.sqrt(r / FULL_BAR_MM_H))));
  const wet = rates.map((r) => r >= WET_MM_H);
  const span = formatMinutes(slots.length * 15);
  if (!wet.some(Boolean)) return { sentence: `No rain expected in the next ${span}.`, levels, rates };

  const word = (from: number, to: number) => {
    const max = Math.max(...rates.slice(from, to));
    return max >= HEAVY_MM_H ? 'Heavy rain' : max < LIGHT_MM_H ? 'Light rain' : 'Rain';
  };
  if (wet[0]) {
    const stop = wet.indexOf(false);
    if (stop === -1) return { sentence: `${word(0, wet.length)} for the next ${span}.`, levels, rates };
    return { sentence: `${word(0, stop)} stopping in about ${formatMinutes(stop * 15)}.`, levels, rates };
  }
  const start = wet.indexOf(true);
  let end = wet.indexOf(false, start);
  if (end === -1) end = wet.length;
  return { sentence: `${word(start, end)} starting in about ${formatMinutes(start * 15)}.`, levels, rates };
}

/* ---------- hourly strip ---------- */

export type HourCell =
  | { kind: 'hour'; label: string; tempF: number; pop: number; glyph: Glyph }
  | { kind: 'sun'; label: string; event: 'Sunrise' | 'Sunset' };

/** "2026-10-05T19:17" → "7:17 PM"; minutes dropped on the hour. */
export function clockLabel(isoLocal: string, withMinutes = true): string {
  const hh = Number(isoLocal.slice(11, 13));
  const mm = isoLocal.slice(14, 16);
  const h12 = hh % 12 || 12;
  const ampm = hh < 12 ? 'AM' : 'PM';
  return withMinutes && mm !== '00' ? `${h12}:${mm} ${ampm}` : `${h12} ${ampm}`;
}

/**
 * Next 24 hours, with sunrise/sunset dropped in as their own cells (the way
 * Apple does). Times are the location's local time, so string order is time order.
 */
export function hourlyCells(hourly: HourlyPoint[], daily: DailyPoint[]): HourCell[] {
  if (!hourly.length) return [];
  const first = hourly[0].time;
  const last = hourly[hourly.length - 1].time.slice(0, 13) + ':59';
  const events = daily
    .flatMap((d) => [
      { time: d.sunrise, event: 'Sunrise' as const },
      { time: d.sunset, event: 'Sunset' as const },
    ])
    .filter((e) => e.time > first && e.time <= last)
    .sort((a, b) => a.time.localeCompare(b.time));

  const cells: HourCell[] = [];
  let e = 0;
  hourly.forEach((h, i) => {
    while (e < events.length && events[e].time.slice(0, 13) < h.time.slice(0, 13)) {
      cells.push({ kind: 'sun', label: clockLabel(events[e].time), event: events[e].event });
      e++;
    }
    cells.push({
      kind: 'hour',
      label: i === 0 ? 'Now' : clockLabel(h.time, false),
      tempF: h.tempF,
      pop: h.precipProbability,
      glyph: glyphFor(h.weatherCode, h.isDay),
    });
    // An event inside this hour goes right after it.
    while (e < events.length && events[e].time.slice(0, 13) === h.time.slice(0, 13)) {
      cells.push({ kind: 'sun', label: clockLabel(events[e].time), event: events[e].event });
      e++;
    }
  });
  return cells;
}

/* ---------- 7 days ---------- */

export interface DayRow {
  label: string;
  glyph: Glyph;
  pop: number;
  loF: number;
  hiF: number;
  /** Segment start and width on the week's low→high scale, 0..1. */
  left: number;
  width: number;
  /** Today only: where the current temperature sits on the same scale. */
  now: number | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekRows(daily: DailyPoint[], currentF: number | null): DayRow[] {
  if (!daily.length) return [];
  const lo = Math.min(...daily.map((d) => d.loF), currentF ?? Infinity);
  const hi = Math.max(...daily.map((d) => d.hiF), currentF ?? -Infinity);
  const span = Math.max(1, hi - lo);
  return daily.map((d, i) => ({
    label: i === 0 ? 'Today' : WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()],
    glyph: glyphFor(d.weatherCode),
    pop: d.precipProbability,
    loF: d.loF,
    hiF: d.hiF,
    left: (d.loF - lo) / span,
    width: (d.hiF - d.loF) / span,
    now: i === 0 && currentF != null ? Math.max(0, Math.min(1, (currentF - lo) / span)) : null,
  }));
}

/* ---------- details ---------- */

export function uvWord(uv: number): string {
  const u = Math.round(uv);
  if (u <= 2) return 'Low';
  if (u <= 5) return 'Moderate';
  if (u <= 7) return 'High';
  if (u <= 10) return 'Very high';
  return 'Extreme';
}
