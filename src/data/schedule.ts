import type { LatLon } from '../config';
import { pointAt, type Route, type RoutePoint } from './route';

/**
 * When the drive actually happens: a day's driving up to a daily limit, a
 * night where the limit runs out, and the next day starting at a set morning
 * hour in that stop's own time zone. Positions along the route are measured
 * in seconds of driving; the schedule turns those into clock times.
 */

/** Don't stop for the night with less than this much driving left: finish instead. */
const FINISH_SLACK_S = 45 * 60;
/** Rest at least this long overnight, even if the morning hour comes sooner. */
const MIN_REST_S = 8 * 3600;
/** A runaway guard: no plan has more nights than this. */
const MAX_DAYS = 14;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const QUARTER_MS = HOUR_MS / 4;

export interface DriveDay {
  /** Seconds of driving along the route where this day starts and ends. */
  fromS: number;
  toS: number;
  /** When the day's driving starts, epoch ms. */
  leave: number;
}

export interface Schedule {
  days: DriveDay[];
}

export interface DriveOptions {
  /** Hours of driving a day; null drives straight through. */
  maxDriveH: number | null;
  /** Local hour (0–23) to start each day after the first. */
  startHour: number;
}

/** Clock time at `s` seconds of driving. A day boundary belongs to the arriving day. */
export function clockAt(sch: Schedule, s: number): number {
  const d = sch.days.find((day) => s <= day.toS) ?? sch.days[sch.days.length - 1];
  return d.leave + (s - d.fromS) * 1000;
}

/**
 * The next morning's start after arriving at `arrive`: the first `hour`:00
 * local time (UTC offset `offsetS`) after arriving, or later if that leaves
 * less than eight hours' rest; rounded up to a quarter hour.
 */
export function nextLeave(arrive: number, hour: number, offsetS: number): number {
  const local = arrive + offsetS * 1000;
  let morning = Math.floor(local / DAY_MS) * DAY_MS + hour * HOUR_MS;
  if (morning <= local) morning += DAY_MS;
  const leave = Math.max(morning - offsetS * 1000, arrive + MIN_REST_S * 1000);
  return Math.ceil(leave / QUARTER_MS) * QUARTER_MS;
}

/** UTC offset of an IANA time zone at a moment, seconds (DST included). */
export function zoneOffsetS(zone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 1000);
}

/** Driving days needed: the fewest that keep each within the limit (finishing a little over it beats a short extra day). */
export function dayCount(durationS: number, maxDriveH: number | null): number {
  if (!maxDriveH) return 1;
  return Math.min(MAX_DAYS, Math.max(1, Math.ceil((durationS - FINISH_SLACK_S) / (maxDriveH * 3600))));
}

/**
 * Lay the drive out over days of equal driving: 25 hours at up to 12 a day
 * is three days of 8 h 20 min, not 12 + 12 + 1. `zoneAt` names the time zone
 * of each night's stop (so "8 AM" is that town's 8 AM); nights are found one
 * after another, since each morning's start moves everything after it.
 */
export async function scheduleDrive(
  route: Route,
  depart: number,
  opts: DriveOptions,
  zoneAt: (p: LatLon) => Promise<string>,
): Promise<Schedule> {
  const n = dayCount(route.duration, opts.maxDriveH);
  const perDay = route.duration / n;
  const days: DriveDay[] = [];
  let fromS = 0;
  let leave = depart;
  for (let k = 1; k < n; k++) {
    const toS = k * perDay;
    days.push({ fromS, toS, leave });
    const arrive = leave + (toS - fromS) * 1000;
    const zone = await zoneAt(pointAt(route, toS));
    leave = nextLeave(arrive, opts.startHour, zoneOffsetS(zone, arrive));
    fromS = toS;
  }
  days.push({ fromS, toS: route.duration, leave });
  return { days };
}

/**
 * Points every `stepMin` minutes of each day's driving, each with its clock
 * time. Every day's first and last point are included, so a night shows up as
 * an arrival and, at the same spot, the next morning's departure.
 */
export function sampleSchedule(route: Route, sch: Schedule, stepMin: number): RoutePoint[][] {
  const step = stepMin * 60;
  return sch.days.map((d) => {
    const pts: RoutePoint[] = [];
    let s = d.fromS;
    for (; s < d.toS; s += step) pts.push(pointAt(route, s, d.leave + (s - d.fromS) * 1000));
    // A regular point just short of the day's end would repeat it.
    if (pts.length > 1 && d.toS - (s - step) < step / 6) pts.pop();
    pts.push(pointAt(route, d.toS, d.leave + (d.toS - d.fromS) * 1000));
    return pts;
  });
}
