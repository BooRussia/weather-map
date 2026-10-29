import { OPEN_METEO_FORECAST, type LatLon } from '../config';
import { wrapLon } from '../util/geo';
import { fetchJson } from '../util/http';

/** Open-Meteo's archive (ERA5): past weather anywhere, free, no key. */
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
/** Years averaged for the normal: the last ten, which the archive has in full. */
export const NORMAL_YEARS = 10;
/** Days either side of the date averaged in, so one odd day doesn't skew it. */
const WINDOW_DAYS = 7;
const NORMALS_KEY = 'weather-map:normals';
/** Normals kept on the device, newest last (they hardly change, so a place's is fetched once a date). */
const NORMALS_KEPT = 60;

export interface Normal {
  hiF: number;
  loF: number;
}

interface ArchiveResponse {
  daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] };
}

/** The average of whatever numbers there are; null with none. */
export function mean(values: (number | null | undefined)[]): number | null {
  const ok = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

/** The same date `years` back, ± the window, as archive start and end dates. */
export function windowFor(date: string, years: number): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number);
  const mid = Date.UTC(y - years, m - 1, d);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: day(mid - WINDOW_DAYS * 86_400_000), end: day(mid + WINDOW_DAYS * 86_400_000) };
}

function readNormals(): Record<string, Normal> {
  try {
    return (JSON.parse(localStorage.getItem(NORMALS_KEY) ?? '{}') as Record<string, Normal>) ?? {};
  } catch {
    return {};
  }
}

function saveNormal(key: string, n: Normal): void {
  try {
    const all = readNormals();
    delete all[key];
    all[key] = n;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - NORMALS_KEPT))) delete all[k];
    localStorage.setItem(NORMALS_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked or full: fetched again next time.
  }
}

/**
 * The average high and low around this date (the place's own `date`) over the last ten years (owner,
 * 2026-10-29: Apple's Averages). One small archive request a year, in parallel; kept on the device.
 */
export async function getNormal({ lat, lon }: LatLon, date: string, signal?: AbortSignal): Promise<Normal | null> {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}:${date.slice(5)}`;
  const kept = readNormals()[key];
  if (kept) return kept;
  const years = await Promise.all(
    Array.from({ length: NORMAL_YEARS }, (_, i) => {
      const { start, end } = windowFor(date, i + 1);
      const q = new URLSearchParams({
        latitude: lat.toFixed(2),
        longitude: wrapLon(lon).toFixed(2),
        start_date: start,
        end_date: end,
        daily: 'temperature_2m_max,temperature_2m_min',
        temperature_unit: 'fahrenheit',
        timezone: 'auto',
      });
      return fetchJson<ArchiveResponse>(`${ARCHIVE_URL}?${q}`, { signal, timeoutMs: 15_000 }).catch(() => null);
    }),
  );
  const hiF = mean(years.flatMap((r) => r?.daily?.temperature_2m_max ?? []));
  const loF = mean(years.flatMap((r) => r?.daily?.temperature_2m_min ?? []));
  if (hiF == null || loF == null) return null;
  const n = { hiF, loF };
  saveNormal(key, n);
  return n;
}

/* ---------- the forecast models side by side, and yesterday ---------- */

/** The models compared (owner, 2026-10-29: Windy's hallmark), the way forecasters name them. */
export const MODELS = [
  { id: 'ecmwf_ifs025', name: 'European', short: 'ECMWF' },
  { id: 'gfs_seamless', name: 'American', short: 'GFS' },
  { id: 'icon_seamless', name: 'German', short: 'ICON' },
] as const;

export interface ModelDay {
  date: string;
  /** One per MODELS entry; null past that model's range. */
  models: ({ hiF: number; loF: number; pop: number | null } | null)[];
}

export interface Outlooks {
  /** Yesterday's high and low (the blended forecast's own record). */
  yesterday: Normal | null;
  days: ModelDay[];
}

type DailyColumns = { time: string[] } & Record<string, (number | null)[] | string[]>;

/** The multi-model response's columns (`temperature_2m_max_gfs_seamless`…) as days. */
export function parseOutlooks(daily: DailyColumns): Outlooks {
  const col = (name: string, model: string) => (daily[`${name}_${model}`] ?? []) as (number | null)[];
  const hiBest = col('temperature_2m_max', 'best_match');
  const loBest = col('temperature_2m_min', 'best_match');
  const yesterday = hiBest[0] != null && loBest[0] != null ? { hiF: hiBest[0], loF: loBest[0] } : null;
  const days = daily.time.slice(1).map((date, j) => {
    const i = j + 1;
    return {
      date,
      models: MODELS.map((m) => {
        const hi = col('temperature_2m_max', m.id)[i];
        const lo = col('temperature_2m_min', m.id)[i];
        return hi == null || lo == null ? null : { hiF: hi, loF: lo, pop: col('precipitation_probability_max', m.id)[i] ?? null };
      }),
    };
  });
  return { yesterday, days };
}

/** The European, American, and German models' ten days, and yesterday, in one request. */
export async function getOutlooks({ lat, lon }: LatLon, signal?: AbortSignal): Promise<Outlooks> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: wrapLon(lon).toFixed(4),
    models: ['best_match', ...MODELS.map((m) => m.id)].join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    past_days: '1',
    forecast_days: '10',
  });
  const r = await fetchJson<{ daily: DailyColumns }>(`${OPEN_METEO_FORECAST}?${q}`, { signal });
  return parseOutlooks(r.daily);
}
