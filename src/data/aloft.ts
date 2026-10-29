import { OPEN_METEO_FORECAST, type LatLon } from '../config';
import { wrapLon } from '../util/geo';
import { fetchJsonSaved } from '../util/http';

/**
 * The air above a place, hour by hour (owner, 2026-10-29: pilot features): Open-Meteo's model data on
 * pressure levels, turned into what pilots read, winds and temperatures at standard altitudes, the
 * freezing level, cloudbase, how high thermals go, the lapse rate, and the energy for storms.
 */

/** Pressure levels fetched, hPa: from near the ground to about 30,000 ft. */
const LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300] as const;
/** Altitudes reported, ft MSL, as the winds-aloft forecast (FB) does. */
export const STANDARD_FT = [3000, 6000, 9000, 12000, 18000, 24000] as const;
const M_TO_FT = 3.28084;
/** The FB forecast leaves out levels this close above the ground: the wind there is the ground's. */
const NEAR_GROUND_FT = 1500;

export interface Level {
  hpa: number;
  /** Height above sea level. */
  ft: number;
  tempC: number;
  dewC: number;
  /** Where the wind blows from, degrees true, and how fast. */
  dir: number;
  kt: number;
}

export interface AloftHour {
  /** The place's local time, "2026-10-29T14:00". */
  time: string;
  surface: { tempC: number; dewC: number; pressureHpa: number };
  /** Above the ground only, lowest first. */
  levels: Level[];
  freezingFt: number | null;
  /** The mixed layer's depth, ft above the ground: about how high thermals go. */
  mixingFt: number | null;
  cape: number | null;
  liftedIndex: number | null;
  cin: number | null;
  /** The wind 120 m up (about 400 ft, the drone ceiling), kt. */
  wind120: { dir: number; kt: number } | null;
}

export interface Aloft {
  elevationFt: number;
  hours: AloftHour[];
}

type Hourly = { time: string[] } & Record<string, (number | null)[]>;

export function parseAloft(r: { elevation: number; hourly: Hourly }): Aloft {
  const h = r.hourly;
  const elevationFt = r.elevation * M_TO_FT;
  const at = (k: string, i: number) => h[k]?.[i] ?? null;
  const hours = h.time.map((time, i) => {
    const levels: Level[] = [];
    for (const p of LEVELS) {
      const z = at(`geopotential_height_${p}hPa`, i);
      const t = at(`temperature_${p}hPa`, i);
      const d = at(`dew_point_${p}hPa`, i);
      const dir = at(`wind_direction_${p}hPa`, i);
      const kt = at(`wind_speed_${p}hPa`, i);
      if (z == null || t == null || d == null || dir == null || kt == null || z * M_TO_FT <= elevationFt) continue;
      levels.push({ hpa: p, ft: z * M_TO_FT, tempC: t, dewC: d, dir, kt });
    }
    const fz = at('freezing_level_height', i);
    const blh = at('boundary_layer_height', i);
    return {
      time,
      surface: { tempC: at('temperature_2m', i) ?? NaN, dewC: at('dew_point_2m', i) ?? NaN, pressureHpa: at('surface_pressure', i) ?? NaN },
      levels,
      freezingFt: fz == null ? null : fz * M_TO_FT,
      mixingFt: blh == null ? null : blh * M_TO_FT,
      cape: at('cape', i),
      liftedIndex: at('lifted_index', i),
      cin: at('convective_inhibition', i),
      wind120: at('wind_speed_120m', i) != null && at('wind_direction_120m', i) != null ? { kt: at('wind_speed_120m', i)!, dir: at('wind_direction_120m', i)! } : null,
    };
  });
  return { elevationFt, hours };
}

/** Wind and temperature at an altitude (ft MSL), between the levels around it (the wind as a vector, so it turns smoothly). */
export function atAltitude(levels: Level[], ft: number): { dir: number; kt: number; tempC: number } | null {
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (ft < a.ft || ft > b.ft) continue;
    const f = (ft - a.ft) / (b.ft - a.ft);
    const uv = (l: Level) => [-l.kt * Math.sin((l.dir * Math.PI) / 180), -l.kt * Math.cos((l.dir * Math.PI) / 180)];
    const [ua, va] = uv(a);
    const [ub, vb] = uv(b);
    const u = ua + (ub - ua) * f;
    const v = va + (vb - va) * f;
    const kt = Math.hypot(u, v);
    const dir = kt < 0.5 ? 0 : (Math.atan2(-u, -v) * 180) / Math.PI;
    return { dir: (dir + 360) % 360, kt, tempC: a.tempC + (b.tempC - a.tempC) * f };
  }
  return null;
}

/** The winds-aloft rows: each standard altitude at least 1,500 ft above the ground that the levels reach. */
export function windsAloft(hour: AloftHour, elevationFt: number): { ft: number; dir: number; kt: number; tempC: number }[] {
  const out: { ft: number; dir: number; kt: number; tempC: number }[] = [];
  for (const ft of STANDARD_FT) {
    const at = ft >= elevationFt + NEAR_GROUND_FT ? atAltitude(hour.levels, ft) : null;
    if (at) out.push({ ft, ...at });
  }
  return out;
}

/** Cloudbase for rising air, ft above the ground: about 400 ft per °C between temperature and dew point (the LCL). */
export const cloudbaseFt = (tempC: number, dewC: number) => Math.max(0, (tempC - dewC) * 410);

/**
 * How fast it cools going up, °C per 1,000 ft, from the ground through the mixed layer (or the first
 * 3,000 ft): 3 is dry adiabatic, the air's own rate when it rises, so near 3 means strong thermals.
 */
export function lapseRate(hour: AloftHour, elevationFt: number): number | null {
  const top = elevationFt + Math.max(hour.mixingFt ?? 0, 3000);
  const t = atAltitude(hour.levels, top)?.tempC;
  if (t == null || !Number.isFinite(hour.surface.tempC)) return null;
  return (hour.surface.tempC - t) / ((top - elevationFt) / 1000);
}

export function lapseWord(rate: number): string {
  if (rate >= 2.7) return 'Unstable: strong thermals';
  if (rate >= 2) return 'Moderately unstable';
  if (rate >= 1) return 'Stable';
  return 'Very stable, an inversion';
}

/** CAPE's usual bands, J/kg. */
export function capeWord(cape: number): string {
  if (cape < 300) return 'Little';
  if (cape < 1000) return 'Marginal';
  if (cape < 2500) return 'Moderate';
  return 'Strong';
}

export async function getAloft({ lat, lon }: LatLon, signal?: AbortSignal): Promise<Aloft> {
  const vars = ['temperature_2m', 'dew_point_2m', 'surface_pressure', 'freezing_level_height', 'boundary_layer_height', 'cape', 'lifted_index', 'convective_inhibition', 'wind_speed_120m', 'wind_direction_120m'];
  for (const p of LEVELS) vars.push(`temperature_${p}hPa`, `dew_point_${p}hPa`, `wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: wrapLon(lon).toFixed(4),
    hourly: vars.join(','),
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: '2',
  });
  return parseAloft(await fetchJsonSaved<{ elevation: number; hourly: Hourly }>(`${OPEN_METEO_FORECAST}?${q}`, `aloft:${lat.toFixed(2)},${lon.toFixed(2)}`, 'winds aloft', { signal }));
}
