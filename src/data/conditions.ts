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
import { reverseName } from './photon';

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
  /** Full Open-Meteo point forecast: daily, next 2 hours, current details. */
  om: PointForecast | null;
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
  om: null,
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
/** A point's name, as the readout would show it: the NWS town, else an OpenStreetMap place, else coordinates. */
export async function placeName(point: LatLon, signal?: AbortSignal): Promise<string> {
  const p = await getPoint(point.lat, point.lon, signal).catch(() => null);
  if (p) return placeLabel(p);
  const name = await reverseName(point.lat, point.lon, signal).catch(() => null);
  return name ?? formatCoord(point.lat, point.lon);
}

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

  const placeDone = nwsPoint.then(async (p) => {
    if (p) return emit({ place: placeLabel(p), inNwsCoverage: true });
    // A failed lookup on refresh keeps the known name instead of dropping to coordinates.
    if (previous) return;
    // Outside NWS coverage: an OpenStreetMap place name, else coordinates.
    const name = await reverseName(point.lat, point.lon, signal).catch(() => null);
    emit({ place: name ?? formatCoord(point.lat, point.lon), inNwsCoverage: false });
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
  if (forecast || observation || !previous) {
    const r = readout(forecast, observation);
    // Open-Meteo failed on a refresh: keep the last forecast for the sheet.
    if (!forecast && previous) Object.assign(r, { om: previous.om, hourly: previous.hourly });
    emit(r);
  }

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
    gustMph: om?.current.gustMph ?? null,
    hourly: om?.hourly ?? [],
    om,
    observation: fresh,
  };
}
