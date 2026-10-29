import { fetchJsonSaved } from '../util/http';

/**
 * Flyability (owner, 2026-10-29: pilot features): hour by hour, whether the wind, gusts, rain, and for
 * drones the clouds, visibility, and GPS suit an activity, and always why, never a bare score. Rules of
 * thumb for each activity; the pilot decides.
 */

export type Activity = 'paraglider' | 'hangglider' | 'drone';

export interface Profile {
  name: string;
  /** Wind, kt: below `minKt` is too light to launch, above `maxKt` too strong. */
  minKt: number;
  maxKt: number;
  /** Gusts above this, kt, or this much above the wind, are too rough. */
  gustKt: number;
  spreadKt: number;
  /** How far off the launch's direction the wind may come from, degrees (null: any direction). */
  crossDeg: number | null;
}

export const PROFILES: Record<Activity, Profile> = {
  paraglider: { name: 'Paraglider', minKt: 3, maxKt: 14, gustKt: 18, spreadKt: 8, crossDeg: 45 },
  hangglider: { name: 'Hang glider', minKt: 5, maxKt: 20, gustKt: 25, spreadKt: 10, crossDeg: 45 },
  drone: { name: 'Drone', minKt: 0, maxKt: 20, gustKt: 25, spreadKt: 15, crossDeg: null },
};

/** Part 107: at least 3 statute miles' visibility, and 500 ft below the clouds (so 900 ft for flights to 400 ft). */
const DRONE_VIS_SM = 3;
const DRONE_CLOUD_FT = 900;
/** Kp at which GPS can start to wander. */
const KP_GPS = 5;

export type Level = 'go' | 'marginal' | 'no';

export interface Hour {
  windKt: number;
  gustKt: number;
  /** Where the wind comes from, degrees. */
  fromDeg: number;
  rainPct: number;
  visSM?: number | null;
  cloudbaseFt?: number | null;
  kp?: number | null;
}

/** The smaller angle between two bearings, 0–180. */
export const angleApart = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * One hour against a profile: go, marginal, or no, with every reason it isn't go. `facing`: the way the
 * launch faces (the wind it wants comes from there), or null for any direction.
 */
export function assess(h: Hour, p: Profile, facing: number | null): { level: Level; reasons: string[] } {
  const no: string[] = [];
  const meh: string[] = [];
  const kt = (v: number) => `${Math.round(v)} kt`;
  if (h.windKt > p.maxKt) no.push(`Wind ${kt(h.windKt)}, over ${kt(p.maxKt)}`);
  else if (h.windKt > p.maxKt * 0.85) meh.push(`Wind ${kt(h.windKt)}, near the ${kt(p.maxKt)} limit`);
  if (h.windKt < p.minKt) meh.push(`Wind ${kt(h.windKt)}, light for launching (${kt(p.minKt)}+)`);
  if (h.gustKt > p.gustKt) no.push(`Gusts ${kt(h.gustKt)}, over ${kt(p.gustKt)}`);
  else if (h.gustKt - h.windKt > p.spreadKt) meh.push(`Gusty: ${kt(h.gustKt - h.windKt)} between wind and gusts`);
  if (facing != null && p.crossDeg != null && h.windKt >= 2) {
    const off = angleApart(h.fromDeg, facing);
    if (off > 90) no.push(`Wind from behind the launch (${Math.round(off)}° off)`);
    else if (off > p.crossDeg) meh.push(`Crosswind, ${Math.round(off)}° off the launch`);
  }
  if (h.rainPct >= 50) no.push(`Rain likely, ${Math.round(h.rainPct)}%`);
  else if (h.rainPct >= 30) meh.push(`Chance of rain, ${Math.round(h.rainPct)}%`);
  if (h.visSM != null && h.visSM < DRONE_VIS_SM && p.crossDeg == null) no.push(`Visibility ${h.visSM.toFixed(1)} SM, under 3`);
  if (h.cloudbaseFt != null && h.cloudbaseFt < DRONE_CLOUD_FT && p.crossDeg == null) no.push(`Clouds at about ${Math.round(h.cloudbaseFt / 100) * 100} ft: flights to 400 ft need them at 900`);
  if (h.kp != null && h.kp >= KP_GPS && p.crossDeg == null) meh.push(`Kp ${Math.round(h.kp)}: GPS may wander`);
  return { level: no.length ? 'no' : meh.length ? 'marginal' : 'go', reasons: [...no, ...meh] };
}

/* ---------- civil twilight ---------- */

const RAD = Math.PI / 180;

/**
 * Civil dawn and dusk (the sun 6° below the horizon) on the UTC day containing `dayMs`, epoch ms: NOAA's
 * solar position formulas, good to a minute or so. Null at either end when the sun doesn't get there.
 */
export function civilTwilight(lat: number, lon: number, dayMs: number): { dawn: number | null; dusk: number | null } {
  const day = Math.floor(dayMs / 86_400_000);
  // Days since J2000.0 at noon UTC that day, then the sun's place.
  const n = day - 10957 + 0.5;
  const g = (357.529 + 0.98560028 * n) * RAD;
  const q = 280.459 + 0.98564736 * n;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * n) * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  // The equation of time, minutes: where the sun is against where clocks say it is.
  const eot = 4 * ((((q - ra) % 360) + 540) % 360 - 180);
  const noonMin = 720 - 4 * lon - eot;
  const cosH = (Math.sin(-6 * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return { dawn: null, dusk: null };
  const H = Math.acos(cosH) / RAD;
  const at = (min: number) => day * 86_400_000 + min * 60_000;
  return { dawn: at(noonMin - 4 * H), dusk: at(noonMin + 4 * H) };
}

/* ---------- Kp, for GPS ---------- */

/** NOAA SWPC's planetary K index, observed and forecast, every 3 hours; open to browsers. */
const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

export interface KpBlock {
  /** The 3-hour block's start, epoch ms. */
  at: number;
  kp: number;
  observed: boolean;
}

export async function getKp(signal?: AbortSignal): Promise<KpBlock[]> {
  const r = await fetchJsonSaved<{ time_tag: string; kp: number; observed: string }[]>(KP_URL, 'kp', 'the Kp forecast', { signal, timeoutMs: 15_000 });
  return r
    .map((x) => ({ at: Date.parse(`${x.time_tag}Z`), kp: Number(x.kp), observed: x.observed === 'observed' }))
    .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.kp));
}

/** The Kp in force at a time: its 3-hour block's. */
export function kpAt(blocks: KpBlock[], ms: number): number | null {
  const b = blocks.filter((x) => x.at <= ms && ms < x.at + 3 * 3_600_000);
  return b.length ? b[b.length - 1].kp : null;
}
