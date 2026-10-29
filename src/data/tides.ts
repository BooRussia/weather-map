import type { LatLon } from '../config';
import { wrapLon } from '../util/geo';
import { fetchJson } from '../util/http';

/** NOAA CO-OPS (Tides and Currents): free, no key, open to browsers. */
const STATIONS_URL = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json';
const PREDICTIONS_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
/** How far to look for a tide station, miles: the coast and its bays, not inland. */
const NEAR_MI = 12;

export interface TideEvent {
  /** The station's local time, "2026-10-29T20:21". */
  time: string;
  ft: number;
  high: boolean;
}

export interface Tides {
  station: string;
  /** Highs and lows from yesterday through tomorrow. */
  events: TideEvent[];
}

interface StationsResponse {
  stationList: { stationId: string; name: string; etidesStnName?: string; distance: number }[] | null;
}

interface PredictionsResponse {
  predictions?: { t: string; v: string; type: 'H' | 'L' }[];
}

/** "HILLSBOROUGH RIVER ENTRANCE" → "Hillsborough River Entrance" (NOAA's names are capitals). */
export function stationName(raw: string): string {
  return raw.toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** The nearest station's highs and lows from the place's `yesterday` (YYYY-MM-DD) for three days; null away from the coast. */
export async function getTides({ lat, lon }: LatLon, yesterday: string, signal?: AbortSignal): Promise<Tides | null> {
  const near = new URLSearchParams({ lat: lat.toFixed(4), lon: wrapLon(lon).toFixed(4), radius: String(NEAR_MI) });
  const list = (await fetchJson<StationsResponse>(`${STATIONS_URL}?${near}`, { signal })).stationList ?? [];
  const station = [...list].sort((a, b) => a.distance - b.distance)[0];
  if (!station) return null;
  const q = new URLSearchParams({
    product: 'predictions',
    station: station.stationId,
    datum: 'MLLW',
    units: 'english',
    time_zone: 'lst_ldt',
    interval: 'hilo',
    format: 'json',
    begin_date: yesterday.replaceAll('-', ''),
    range: '72',
    application: 'weather-map',
  });
  const r = await fetchJson<PredictionsResponse>(`${PREDICTIONS_URL}?${q}`, { signal });
  const events = (r.predictions ?? []).map((p) => ({ time: p.t.replace(' ', 'T'), ft: Number(p.v), high: p.type === 'H' }));
  if (events.length < 2) return null;
  return { station: stationName(station.etidesStnName?.split(',')[0] ?? station.name), events };
}

const minutesOf = (isoLocal: string) => Date.parse(`${isoLocal}:00Z`) / 60_000;

/** The water level at a local time, eased between the highs and lows around it (a cosine, as tide tables do); null outside them. */
export function tideAt(events: TideEvent[], timeLocal: string): number | null {
  const t = minutesOf(timeLocal);
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    const ta = minutesOf(a.time);
    const tb = minutesOf(b.time);
    if (t >= ta && t <= tb) {
      const f = tb > ta ? (t - ta) / (tb - ta) : 0;
      return a.ft + (b.ft - a.ft) * (1 - Math.cos(Math.PI * f)) / 2;
    }
  }
  return null;
}
