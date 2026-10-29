import type { LatLon } from '../config';
import { wrapLon } from '../util/geo';
import { fetchJson } from '../util/http';

/** Open-Meteo's air quality (CAMS): free, no key. */
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export interface AirQuality {
  /** U.S. AQI now. */
  aqi: number;
  /** About this time yesterday, to say whether it's better or worse. */
  yesterday: number | null;
  /** Pollen in the air, grains/m³, highest first; null where none is forecast (CAMS covers Europe only). */
  pollen: { name: string; grains: number }[] | null;
}

/** CAMS's pollen kinds, as people name them. */
const POLLEN = [
  ['alder_pollen', 'Alder'],
  ['birch_pollen', 'Birch'],
  ['grass_pollen', 'Grass'],
  ['mugwort_pollen', 'Mugwort'],
  ['olive_pollen', 'Olive'],
  ['ragweed_pollen', 'Ragweed'],
] as const;

interface AirResponse {
  current?: { time: string; us_aqi: number | null } & Partial<Record<(typeof POLLEN)[number][0], number | null>>;
  hourly?: { time: string[]; us_aqi: (number | null)[] };
}

/** The U.S. AQI now and about this time yesterday. One small request, made when the weather page shows. */
export async function getAirQuality({ lat, lon }: LatLon, signal?: AbortSignal): Promise<AirQuality | null> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: wrapLon(lon).toFixed(3),
    current: ['us_aqi', ...POLLEN.map(([k]) => k)].join(','),
    hourly: 'us_aqi',
    past_days: '1',
    forecast_days: '1',
    timezone: 'auto',
  });
  const r = await fetchJson<AirResponse>(`${AIR_QUALITY_URL}?${q}`, { signal, timeoutMs: 10_000 });
  const now = r.current;
  if (now?.us_aqi == null) return null;
  const hourYesterday = new Date(Date.parse(`${now.time}:00Z`) - 86_400_000).toISOString().slice(0, 13);
  const i = r.hourly?.time.findIndex((t) => t.slice(0, 13) === hourYesterday) ?? -1;
  const pollen = POLLEN.filter(([k]) => now[k] != null).map(([k, name]) => ({ name, grains: Math.round(now[k]!) }));
  return {
    aqi: Math.round(now.us_aqi),
    yesterday: i >= 0 ? (r.hourly!.us_aqi[i] ?? null) : null,
    pollen: pollen.length ? pollen.sort((a, b) => b.grains - a.grains) : null,
  };
}

/** A pollen count in words (grains/m³; the bands Europe's pollen services use, roughly). */
export function pollenWord(grains: number): string {
  if (grains < 10) return 'Low';
  if (grains < 50) return 'Moderate';
  if (grains < 200) return 'High';
  return 'Very high';
}

/** The EPA's words for each band. */
export function aqiWord(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

/** Apple's sentence: how it compares with about this time yesterday. */
export function aqiNote(a: AirQuality): string {
  const base = `Air quality index is ${a.aqi}`;
  if (a.yesterday == null) return `${base}, ${aqiWord(a.aqi).toLowerCase()} for most people.`;
  const d = a.aqi - Math.round(a.yesterday);
  if (Math.abs(d) <= 10) return `${base}, which is similar to yesterday at about this time.`;
  return `${base}, which is ${d > 0 ? 'worse' : 'better'} than yesterday at about this time.`;
}
