import { NWS_BASE, NWS_USER_AGENT } from '../config';
import { fetchJson, HttpError } from '../util/http';
import { compass16, cToF, kmhToMph } from '../util/units';

const HEADERS = {
  Accept: 'application/geo+json',
  // Honored where the browser allows scripts to set it (Firefox). NWS lists
  // User-Agent in Access-Control-Allow-Headers, so the preflight passes.
  'User-Agent': NWS_USER_AGENT,
};

const get = <T>(url: string, signal?: AbortSignal) => fetchJson<T>(url, { headers: HEADERS, signal, timeoutMs: 10_000 });

/** NWS wants at most 4 decimals; more triggers a 301. */
const coord = (n: number) => Number(n.toFixed(4));

export interface NwsPoint {
  city: string;
  state: string;
  /** Meters from the named city to the requested point. */
  distanceM: number;
  /** Degrees from the named city toward the requested point. */
  bearing: number;
  forecastUrl: string;
  forecastHourlyUrl: string;
  stationsUrl: string;
  timeZone: string;
}

interface PointResponse {
  properties: {
    forecast: string;
    forecastHourly: string;
    observationStations: string;
    timeZone: string;
    relativeLocation: {
      properties: {
        city: string;
        state: string;
        distance: { value: number | null };
        bearing: { value: number | null };
      };
    };
  };
}

/** Reverse-geocode + link discovery. Returns null outside NWS coverage (404). */
export async function getPoint(lat: number, lon: number, signal?: AbortSignal): Promise<NwsPoint | null> {
  try {
    const r = await get<PointResponse>(`${NWS_BASE}/points/${coord(lat)},${coord(lon)}`, signal);
    const p = r.properties;
    const rel = p.relativeLocation.properties;
    return {
      city: rel.city,
      state: rel.state,
      distanceM: rel.distance.value ?? 0,
      bearing: rel.bearing.value ?? 0,
      forecastUrl: p.forecast,
      forecastHourlyUrl: p.forecastHourly,
      stationsUrl: p.observationStations,
      timeZone: p.timeZone,
    };
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

/** "DUNNELLON, FL" or "3 MI ESE OF REDDICK, FL" (uppercased by CSS). */
export function placeLabel(p: NwsPoint): string {
  const miles = p.distanceM / 1609.344;
  const name = `${p.city}, ${p.state}`;
  if (miles < 2) return name;
  return `${Math.round(miles)} mi ${compass16(p.bearing)} of ${name}`;
}

export interface Observation {
  stationId: string;
  stationName: string;
  timestamp: Date;
  text: string;
  tempF: number | null;
  windMph: number | null;
  windFromDeg: number | null;
}

interface StationsResponse {
  features: { properties: { stationIdentifier: string; name: string } }[];
}

interface Quantity {
  value: number | null;
}

interface ObservationResponse {
  properties: {
    timestamp: string;
    textDescription: string;
    temperature: Quantity;
    windSpeed: Quantity;
    windDirection: Quantity;
  };
}

/** Latest observation from the nearest station that has a temperature. */
export async function getLatestObservation(stationsUrl: string, signal?: AbortSignal): Promise<Observation | null> {
  const sep = stationsUrl.includes('?') ? '&' : '?';
  const stations = await get<StationsResponse>(`${stationsUrl}${sep}limit=3`, signal);
  for (const f of stations.features) {
    const id = f.properties.stationIdentifier;
    try {
      const o = await get<ObservationResponse>(`${NWS_BASE}/stations/${id}/observations/latest`, signal);
      const p = o.properties;
      if (p.temperature.value == null) continue;
      return {
        stationId: id,
        stationName: f.properties.name,
        timestamp: new Date(p.timestamp),
        text: p.textDescription ?? '',
        tempF: cToF(p.temperature.value),
        windMph: p.windSpeed.value == null ? null : kmhToMph(p.windSpeed.value),
        windFromDeg: p.windDirection.value,
      };
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return null;
}

export interface ForecastPeriod {
  name: string;
  startTime: Date;
  isDaytime: boolean;
  tempF: number;
  shortForecast: string;
  precipChance: number | null;
  wind: string;
}

interface ForecastResponse {
  properties: {
    periods: {
      name: string;
      startTime: string;
      isDaytime: boolean;
      temperature: number;
      temperatureUnit: 'F' | 'C';
      shortForecast: string;
      windSpeed: string;
      windDirection: string;
      probabilityOfPrecipitation?: { value: number | null };
    }[];
  };
}

export async function getForecast(url: string, signal?: AbortSignal): Promise<ForecastPeriod[]> {
  const r = await get<ForecastResponse>(url, signal);
  return r.properties.periods.map((p) => ({
    name: p.name,
    startTime: new Date(p.startTime),
    isDaytime: p.isDaytime,
    tempF: p.temperatureUnit === 'C' ? cToF(p.temperature) : p.temperature,
    shortForecast: p.shortForecast,
    precipChance: p.probabilityOfPrecipitation?.value ?? null,
    wind: `${p.windDirection} ${p.windSpeed}`.trim(),
  }));
}

export type Severity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface Alert {
  id: string;
  event: string;
  headline: string;
  severity: Severity;
  urgency: string;
  areaDesc: string;
  description: string;
  instruction: string;
  sender: string;
  effective: Date | null;
  ends: Date | null;
}

interface AlertsResponse {
  features: {
    id: string;
    properties: {
      event: string;
      headline: string | null;
      severity: Severity;
      urgency: string;
      areaDesc: string;
      description: string | null;
      instruction: string | null;
      senderName: string;
      effective: string | null;
      expires: string | null;
      ends: string | null;
    };
  }[];
}

const SEVERITY_RANK: Record<Severity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
const URGENCY_RANK: Record<string, number> = { Immediate: 4, Expected: 3, Future: 2, Past: 1, Unknown: 0 };

/** Most severe first, then most urgent, then soonest to end. */
export function rankAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0) ||
      (a.ends?.getTime() ?? Infinity) - (b.ends?.getTime() ?? Infinity),
  );
}

export async function getActiveAlerts(lat: number, lon: number, signal?: AbortSignal): Promise<Alert[]> {
  const r = await get<AlertsResponse>(`${NWS_BASE}/alerts/active?point=${coord(lat)},${coord(lon)}`, signal);
  const now = Date.now();
  const alerts = r.features.map(({ id, properties: p }) => ({
    id,
    event: p.event,
    headline: p.headline ?? p.event,
    severity: p.severity ?? 'Unknown',
    urgency: p.urgency ?? 'Unknown',
    areaDesc: p.areaDesc ?? '',
    description: p.description ?? '',
    instruction: p.instruction ?? '',
    sender: p.senderName ?? 'NWS',
    effective: p.effective ? new Date(p.effective) : null,
    ends: p.ends ? new Date(p.ends) : p.expires ? new Date(p.expires) : null,
  }));
  return rankAlerts(alerts.filter((a) => !a.ends || a.ends.getTime() > now));
}
