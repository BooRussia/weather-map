import { OPEN_METEO_FORECAST, OPEN_METEO_GEOCODE, type LatLon } from '../config';
import { fetchJson } from '../util/http';
import { wrapLon } from '../util/geo';

const c4 = (n: number) => n.toFixed(4);

export interface PointCurrent {
  time: string;
  tempF: number;
  /** mm over the preceding `intervalS` seconds. */
  precipitation: number;
  intervalS: number;
  weatherCode: number;
  windMph: number;
  windFromDeg: number;
}

export interface HourlyPoint {
  time: string;
  tempF: number;
  precipitation: number;
  precipProbability: number;
  weatherCode: number;
  windMph: number;
  windFromDeg: number;
  gustMph: number;
}

export interface PointForecast {
  current: PointCurrent;
  hourly: HourlyPoint[];
  utcOffsetSeconds: number;
}

interface PointResponse {
  utc_offset_seconds: number;
  current: {
    time: string;
    interval: number;
    temperature_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
  };
}

/** Point forecast for the HUD (the URL from the brief, trimmed to the next 24 hours). */
export async function getPointForecast({ lat, lon }: LatLon, signal?: AbortSignal): Promise<PointForecast> {
  const q = new URLSearchParams({
    latitude: c4(lat),
    longitude: c4(wrapLon(lon)),
    hourly:
      'temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_hours: '24',
  });
  const r = await fetchJson<PointResponse>(`${OPEN_METEO_FORECAST}?${q}`, { signal });
  const h = r.hourly;
  return {
    utcOffsetSeconds: r.utc_offset_seconds,
    current: {
      time: r.current.time,
      tempF: r.current.temperature_2m,
      precipitation: r.current.precipitation,
      intervalS: r.current.interval,
      weatherCode: r.current.weather_code,
      windMph: r.current.wind_speed_10m,
      windFromDeg: r.current.wind_direction_10m,
    },
    hourly: h.time.map((time, i) => ({
      time,
      tempF: h.temperature_2m[i],
      precipitation: h.precipitation[i],
      precipProbability: h.precipitation_probability[i] ?? 0,
      weatherCode: h.weather_code[i],
      windMph: h.wind_speed_10m[i],
      windFromDeg: h.wind_direction_10m[i],
      gustMph: h.wind_gusts_10m[i],
    })),
  };
}

export interface GridSample {
  windMph: number;
  windFromDeg: number;
  /** mm/h, normalized from the reporting interval. */
  precipRate: number;
  precipProbability: number;
  weatherCode: number;
}

interface GridItem {
  current: {
    interval: number;
    wind_speed_10m: number | null;
    wind_direction_10m: number | null;
    precipitation: number | null;
    precipitation_probability: number | null;
    weather_code: number | null;
  };
}

/**
 * Current conditions for many points in ONE request (Open-Meteo accepts
 * comma-separated coordinate lists). Results come back in input order.
 */
export async function getGridSamples(points: LatLon[], signal?: AbortSignal): Promise<GridSample[]> {
  const q = new URLSearchParams({
    latitude: points.map((p) => c4(p.lat)).join(','),
    longitude: points.map((p) => c4(wrapLon(p.lon))).join(','),
    current: 'wind_speed_10m,wind_direction_10m,precipitation,precipitation_probability,weather_code',
    wind_speed_unit: 'mph',
    timezone: 'GMT',
  });
  const r = await fetchJson<GridItem[] | GridItem>(`${OPEN_METEO_FORECAST}?${q}`, { signal, timeoutMs: 15_000 });
  const items = Array.isArray(r) ? r : [r];
  return items.map(({ current: c }) => ({
    windMph: c.wind_speed_10m ?? 0,
    windFromDeg: c.wind_direction_10m ?? 0,
    precipRate: ((c.precipitation ?? 0) * 3600) / (c.interval || 3600),
    precipProbability: c.precipitation_probability ?? 0,
    weatherCode: c.weather_code ?? 0,
  }));
}

export interface GeocodeResult {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

interface GeocodeResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    country_code: string;
    country: string;
    admin1?: string;
  }[];
}

/** Place search for the settings sheet. US results are listed first. */
export async function geocode(name: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const q = new URLSearchParams({ name, count: '8', language: 'en', format: 'json' });
  const r = await fetchJson<GeocodeResponse>(`${OPEN_METEO_GEOCODE}?${q}`, { signal });
  const results = (r.results ?? []).map((x) => ({
    name: x.name,
    region: x.admin1 ?? '',
    country: x.country_code,
    lat: x.latitude,
    lon: x.longitude,
  }));
  return results.sort((a, b) => Number(b.country === 'US') - Number(a.country === 'US'));
}

/** WMO weather interpretation codes, as Open-Meteo documents them. */
const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms with hail',
  99: 'Severe thunderstorms with hail',
};

export const weatherCodeText = (code: number) => WMO[code] ?? 'Unknown';
export const isThunderCode = (code: number) => code >= 95 && code <= 99;
