import type { LatLon } from '../config';
import { formatCoord } from '../util/text';
import {
  getActiveAlerts,
  getForecast,
  getLatestObservation,
  getPoint,
  placeLabel,
  type Alert,
  type ForecastPeriod,
  type Observation,
} from './nws';
import { getPointForecast, weatherCodeText, type HourlyPoint, type PointForecast } from './openmeteo';

/** An observation older than this is not "current". */
const OBS_MAX_AGE_MS = 90 * 60_000;

export interface Conditions {
  point: LatLon;
  /** Null until the NWS point lookup returns (or fails). */
  place: string | null;
  inNwsCoverage: boolean;
  tempF: number | null;
  condition: string | null;
  windMph: number | null;
  windFromDeg: number | null;
  gustMph: number | null;
  alerts: Alert[];
  periods: ForecastPeriod[];
  hourly: HourlyPoint[];
  observation: Observation | null;
  /** Set when nothing at all could be loaded. */
  failed: boolean;
}

const empty = (point: LatLon): Conditions => ({
  point,
  place: null,
  inNwsCoverage: false,
  tempF: null,
  condition: null,
  windMph: null,
  windFromDeg: null,
  gustMph: null,
  alerts: [],
  periods: [],
  hourly: [],
  observation: null,
  failed: false,
});

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/**
 * Load everything the HUD and sheets need for one point. `onUpdate` fires
 * with a fresh snapshot each time a piece lands, so the HUD fills in
 * progressively: place first, then temperature + condition, then alerts.
 * Pass `previous` on a refresh so the HUD keeps its values meanwhile.
 */
export async function loadConditions(
  point: LatLon,
  signal: AbortSignal,
  previous: Conditions | null,
  onUpdate: (c: Conditions) => void,
): Promise<Conditions> {
  let c = previous ? { ...previous, failed: false } : empty(point);
  const emit = (patch: Partial<Conditions>) => {
    if (signal.aborted) return;
    c = { ...c, ...patch };
    onUpdate(c);
  };

  const nwsPoint = getPoint(point.lat, point.lon, signal).catch(() => null);
  const om = getPointForecast(point, signal).catch(() => null);

  const placeDone = nwsPoint.then((p) => {
    // A failed lookup on refresh keeps the known name instead of dropping to coordinates.
    if (p || !previous) emit({ place: p ? placeLabel(p) : formatCoord(point.lat, point.lon), inNwsCoverage: !!p });
  });

  const alertsDone = getActiveAlerts(point.lat, point.lon, signal)
    .then((alerts) => emit({ alerts }))
    .catch(() => undefined);

  const periodsDone = nwsPoint
    .then((p) => (p ? getForecast(p.forecastUrl, signal) : previous ? null : []))
    .then((periods) => periods && emit({ periods }))
    .catch(() => undefined);

  const obs = nwsPoint.then((p) =>
    p ? timeout(getLatestObservation(p.stationsUrl, signal).catch(() => null), 7000, null) : null,
  );

  const [forecast, observation] = await Promise.all([om, obs]);
  // On a refresh where both sources failed, keep the last good readout.
  if (forecast || observation || !previous) emit(readout(forecast, observation));

  await Promise.all([placeDone, alertsDone, periodsDone]);
  if (c.tempF == null && c.condition == null) emit({ failed: true });
  return c;
}

/** Temperature + condition: a fresh NWS observation wins, Open-Meteo fills gaps. */
export function readout(om: PointForecast | null, obs: Observation | null): Partial<Conditions> {
  const fresh = obs && Date.now() - obs.timestamp.getTime() < OBS_MAX_AGE_MS ? obs : null;
  const tempF = fresh?.tempF ?? om?.current.tempF ?? null;
  const condition = fresh?.text || (om ? weatherCodeText(om.current.weatherCode) : null);
  return {
    tempF,
    condition,
    windMph: om?.current.windMph ?? fresh?.windMph ?? null,
    windFromDeg: om?.current.windFromDeg ?? fresh?.windFromDeg ?? null,
    gustMph: om?.hourly[0]?.gustMph ?? null,
    hourly: om?.hourly ?? [],
    observation: fresh,
  };
}
