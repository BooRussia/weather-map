import { OPEN_METEO_FORECAST, type LatLon } from '../config';
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
  gustMph: number;
  feelsF: number;
  humidity: number;
  dewF: number;
  pressureHpa: number;
  visibilityM: number;
  uv: number;
  isDay: boolean;
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
  isDay: boolean;
}

export interface DailyPoint {
  /** Local date, YYYY-MM-DD. */
  date: string;
  hiF: number;
  loF: number;
  precipProbability: number;
  weatherCode: number;
  /** Local times, YYYY-MM-DDTHH:MM. */
  sunrise: string;
  sunset: string;
  uvMax: number;
}

export interface MinutelyPoint {
  /** Local time at the start of the 15-minute slot. */
  time: string;
  /** mm in that 15 minutes. */
  precipitation: number;
}

export interface PointForecast {
  current: PointCurrent;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  /** Next 2 hours in 15-minute slots. */
  minutely: MinutelyPoint[];
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
    wind_gusts_10m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    dew_point_2m: number;
    pressure_msl: number;
    visibility: number;
    uv_index: number;
    is_day: number;
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
    is_day: number[];
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    weather_code: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: (number | null)[];
  };
  minutely_15: { time: string[]; precipitation: (number | null)[] };
}

/**
 * Point forecast for the HUD and detail sheet: the URL from the brief, trimmed
 * to the next 24 hours, plus 7 days, the next 2 hours in 15-minute slots, and
 * the current details (feels like, humidity, pressure…). One request.
 */
export async function getPointForecast({ lat, lon }: LatLon, signal?: AbortSignal): Promise<PointForecast> {
  const q = new URLSearchParams({
    latitude: c4(lat),
    longitude: c4(wrapLon(lon)),
    hourly:
      'temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day',
    current:
      'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,' +
      'apparent_temperature,relative_humidity_2m,dew_point_2m,pressure_msl,visibility,uv_index,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,uv_index_max',
    minutely_15: 'precipitation',
    forecast_minutely_15: '8',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_hours: '24',
    forecast_days: '7',
  });
  const r = await fetchJson<PointResponse>(`${OPEN_METEO_FORECAST}?${q}`, { signal });
  const c = r.current;
  const h = r.hourly;
  const d = r.daily;
  const m = r.minutely_15;
  return {
    utcOffsetSeconds: r.utc_offset_seconds,
    current: {
      time: c.time,
      tempF: c.temperature_2m,
      precipitation: c.precipitation,
      intervalS: c.interval,
      weatherCode: c.weather_code,
      windMph: c.wind_speed_10m,
      windFromDeg: c.wind_direction_10m,
      gustMph: c.wind_gusts_10m,
      feelsF: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      dewF: c.dew_point_2m,
      pressureHpa: c.pressure_msl,
      visibilityM: c.visibility,
      uv: c.uv_index,
      isDay: c.is_day === 1,
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
      isDay: h.is_day[i] === 1,
    })),
    daily: d.time.map((date, i) => ({
      date,
      hiF: d.temperature_2m_max[i],
      loF: d.temperature_2m_min[i],
      precipProbability: d.precipitation_probability_max[i] ?? 0,
      weatherCode: d.weather_code[i],
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
      uvMax: d.uv_index_max[i] ?? 0,
    })),
    minutely: (m?.time ?? []).map((time, i) => ({ time, precipitation: m.precipitation[i] ?? 0 })),
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
  hourly: {
    time: string[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    precipitation: (number | null)[];
    precipitation_probability: (number | null)[];
    weather_code: (number | null)[];
  };
}

export interface GridData {
  /** Now (15-minute data where available), one sample per point. */
  current: GridSample[];
  /** UTC hour keys (YYYY-MM-DDTHH:00), shared by every point. */
  hours: string[];
  /** samplesAt[hourIndex][pointIndex]. */
  samplesAt: GridSample[][];
}

/**
 * Current conditions plus hourly data (past 24 h, next 19 h) for many points
 * in ONE request (Open-Meteo accepts comma-separated coordinate lists).
 * Results come back in input order. ~12 kB gzipped for 40 points.
 */
export async function getGridSamples(points: LatLon[], pastHours: number, signal?: AbortSignal): Promise<GridData> {
  const vars = 'wind_speed_10m,wind_direction_10m,precipitation,precipitation_probability,weather_code';
  const q = new URLSearchParams({
    latitude: points.map((p) => c4(p.lat)).join(','),
    longitude: points.map((p) => c4(wrapLon(p.lon))).join(','),
    current: vars,
    hourly: vars,
    past_hours: String(pastHours),
    forecast_hours: '19',
    wind_speed_unit: 'mph',
    timezone: 'GMT',
  });
  const r = await fetchJson<GridItem[] | GridItem>(`${OPEN_METEO_FORECAST}?${q}`, { signal, timeoutMs: 15_000 });
  const items = Array.isArray(r) ? r : [r];
  const hours = items[0]?.hourly.time ?? [];
  return {
    current: items.map(({ current: c }) => ({
      windMph: c.wind_speed_10m ?? 0,
      windFromDeg: c.wind_direction_10m ?? 0,
      precipRate: ((c.precipitation ?? 0) * 3600) / (c.interval || 3600),
      precipProbability: c.precipitation_probability ?? 0,
      weatherCode: c.weather_code ?? 0,
    })),
    hours,
    samplesAt: hours.map((_, hi) =>
      items.map(({ hourly: h }) => ({
        windMph: h.wind_speed_10m[hi] ?? 0,
        windFromDeg: h.wind_direction_10m[hi] ?? 0,
        // Hourly precipitation is already mm over the hour.
        precipRate: h.precipitation[hi] ?? 0,
        precipProbability: h.precipitation_probability[hi] ?? 0,
        weatherCode: h.weather_code[hi] ?? 0,
      })),
    ),
  };
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
