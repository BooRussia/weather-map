import type { LatLon } from '../config';
import { getStopForecasts, type StopForecast } from './openmeteo';
import { getRoute, sampleRoute, type Route, type RoutePoint } from './route';
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

/** A forecast stop: where you'll be, when, and the weather then. */
export interface TripStop extends RoutePoint {
  forecast: StopForecast | null;
  flags: StopFlag[];
  /** Worst flag, or null when the drive looks fine there. */
  level: Level | null;
}

export interface TripPlan {
  depart: number;
  arrive: number;
  route: Route;
  stops: TripStop[];
  hazards: Hazard[];
  /** Sources that couldn't be checked (the plan is still useful without them). */
  failed: HazardSource[];
}

/** Forecast stops every 30 minutes of driving; hourly on very long drives. */
export const stopSpacing = (durationS: number) => (durationS > 36 * 3600 ? 60 : 30);

/**
 * Route `from` → `to` leaving at `depart` (epoch ms), then everything along it
 * at the time you'll get there. Assumes nonstop driving at typical speeds.
 */
export async function planTrip(
  from: LatLon,
  to: LatLon,
  depart: number,
  time: (ms: number) => string,
  signal?: AbortSignal,
): Promise<TripPlan> {
  const route = await getRoute(from, to, signal);
  const fine = sampleRoute(route, depart, FINE_MIN);
  const coarse = sampleRoute(route, depart, stopSpacing(route.duration));
  const failed: HazardSource[] = [];
  const [forecasts, noaa] = await Promise.all([
    getStopForecasts(coarse, signal).catch(() => {
      failed.push('Forecast');
      return null;
    }),
    getRouteHazards(fine, time, signal),
  ]);
  failed.push(...noaa.failed);
  const stops: TripStop[] = coarse.map((p, i) => {
    const forecast = forecasts?.[i] ?? null;
    const flags = forecast ? stopFlags(forecast) : [];
    return { ...p, forecast, flags, level: flags.reduce<Level | null>((l, f) => worse(l, f.level), null) };
  });
  return {
    depart,
    arrive: depart + route.duration * 1000,
    route,
    stops,
    hazards: sortHazards([...noaa.hazards, ...forecastHazards(stops)]),
    failed,
  };
}
