import type { LatLon } from '../config';
import { getStopForecasts, getTimeZones, type StopForecast } from './openmeteo';
import { getRoute, type Route, type RoutePoint } from './route';
import { sampleSchedule, scheduleDrive, type DriveOptions, type Schedule } from './schedule';
import {
  forecastHazards,
  getRouteHazards,
  sortHazards,
  stopFlags,
  worse,
  type Hazard,
  type HazardSource,
  type Level,
  type StopFlag,
} from './tripHazards';

/** Hazard areas are tested every this many minutes of driving (~3 km at highway speed). */
const FINE_MIN = 2;

/** Where you stay the night. */
export interface Night {
  /** 1 for the first night. */
  n: number;
  /** When you set off again, epoch ms. */
  leave: number;
  /** The weather when you set off, and anything in it to flag (icy mornings, fog). */
  leaveForecast: StopForecast | null;
  leaveFlags: StopFlag[];
}

/** A forecast stop: where you'll be, when, and the weather then. */
export interface TripStop extends RoutePoint {
  forecast: StopForecast | null;
  flags: StopFlag[];
  /** Worst flag (arriving or, for a night, leaving), or null when the drive looks fine there. */
  level: Level | null;
  /** IANA time zone, for local clock times. Null if it couldn't be looked up. */
  zone: string | null;
  /** Driving day, from 0. */
  day: number;
  /** On the last stop of every day but the final one: you stay here overnight. */
  night: Night | null;
}

export interface TripPlan {
  depart: number;
  arrive: number;
  route: Route;
  schedule: Schedule;
  stops: TripStop[];
  hazards: Hazard[];
  /** Sources that couldn't be checked (the plan is still useful without them). */
  failed: HazardSource[];
}

/** Forecast stops every 30 minutes of driving; hourly on very long drives. */
export const stopSpacing = (durationS: number) => (durationS > 36 * 3600 ? 60 : 30);

export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Route `from` → `to` leaving at `depart` (epoch ms), laid out over days by
 * `opts`, then everything along it at the time you'll get there.
 */
export async function planTrip(
  from: LatLon,
  to: LatLon,
  depart: number,
  opts: DriveOptions,
  signal?: AbortSignal,
): Promise<TripPlan> {
  const route = await getRoute(from, to, signal);
  const schedule = await scheduleDrive(route, depart, opts, (p) =>
    getTimeZones([p], signal)
      .then((z) => z[0] ?? deviceZone())
      .catch(() => deviceZone()),
  );

  // Hazard samples include each night's arrival and departure at the same
  // spot, so an alert over your motel overnight counts.
  const fine = sampleSchedule(route, schedule, FINE_MIN).flat();

  // Forecast stops by day; a later day's first point is the morning departure
  // from the night before, which rides on that night's stop.
  const days = sampleSchedule(route, schedule, stopSpacing(route.duration));
  const base = days.flatMap((pts, day) =>
    pts
      .map((p, j) => ({
        ...p,
        day,
        leave: j === pts.length - 1 && day < days.length - 1 ? schedule.days[day + 1].leave : null,
      }))
      .filter((_, j) => day === 0 || j > 0),
  );
  const nights = base.flatMap((s, i) => (s.leave != null ? [i] : []));
  const points = [...base, ...nights.map((i) => ({ ...base[i], at: base[i].leave! }))];

  const failed: HazardSource[] = [];
  const [forecasts, zones, noaa] = await Promise.all([
    getStopForecasts(points, signal).catch(() => {
      failed.push('Forecast');
      return null;
    }),
    getTimeZones(base, signal).catch(() => null),
    getRouteHazards(fine, signal),
  ]);
  failed.push(...noaa.failed);

  const stops: TripStop[] = base.map(({ leave, ...p }, i) => {
    const forecast = forecasts?.[i] ?? null;
    const flags = forecast ? stopFlags(forecast) : [];
    let night: Night | null = null;
    if (leave != null) {
      const leaveForecast = forecasts?.[base.length + nights.indexOf(i)] ?? null;
      night = { n: p.day + 1, leave, leaveForecast, leaveFlags: leaveForecast ? stopFlags(leaveForecast) : [] };
    }
    const level = [...flags, ...(night?.leaveFlags ?? [])].reduce<Level | null>((l, f) => worse(l, f.level), null);
    return { ...p, forecast, flags, level, zone: zones?.[i] ?? null, night };
  });

  // Weather in order of time: a night's morning flags come after its evening ones.
  const timeline = stops.flatMap((s) => (s.night ? [s, { ...s, at: s.night.leave, flags: s.night.leaveFlags }] : [s]));
  const last = schedule.days[schedule.days.length - 1];
  return {
    depart,
    arrive: last.leave + (last.toS - last.fromS) * 1000,
    route,
    schedule,
    stops,
    hazards: sortHazards([...noaa.hazards, ...forecastHazards(timeline)]),
    failed,
  };
}
