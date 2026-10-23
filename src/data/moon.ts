/** The moon from the date alone (no request): its phase and the next full moon from where the sun and moon are, and when it rises and sets. */

const SYNODIC_DAYS = 29.530588853;
const DAY_MS = 86_400_000;

export interface MoonPhase {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Lit fraction of the disk, 0..1. */
  illumination: number;
  name: string;
  /** Whole days until the next full moon (0 when it's full now). */
  daysToFull: number;
  /** When the next full moon is (to within a few hours). */
  nextFull: Date;
}

const NAMES: [number, string][] = [
  [0.0339, 'New moon'],
  [0.216, 'Waxing crescent'],
  [0.284, 'First quarter'],
  [0.466, 'Waxing gibbous'],
  [0.534, 'Full moon'],
  [0.716, 'Waning gibbous'],
  [0.784, 'Last quarter'],
  [0.966, 'Waning crescent'],
  [1, 'New moon'],
];

export function moonPhase(at: Date): MoonPhase {
  const ms = at.getTime();
  const { phase, fraction } = moonIllumination(ms);
  const name = NAMES.find(([end]) => phase < end)![1];
  // The next full moon: the most lit hour ahead, found hour by hour over the coming cycle.
  const start = ((0.5 - phase + 1) % 1) * SYNODIC_DAYS;
  let best = ms + start * DAY_MS;
  let bestF = -1;
  for (let hrs = Math.max(0, start * 24 - 36); hrs <= start * 24 + 36; hrs++) {
    const f = moonIllumination(ms + hrs * 3_600_000).fraction;
    if (f > bestF) [bestF, best] = [f, ms + hrs * 3_600_000];
  }
  return {
    phase,
    illumination: fraction,
    name,
    daysToFull: name === 'Full moon' ? 0 : Math.round((best - ms) / DAY_MS),
    nextFull: new Date(best),
  };
}

/** Sun and moon right ascension and declination (radians) and the moon's distance (km), SunCalc's way. */
function bodies(ms: number) {
  const d = toDays(ms);
  const sM = RAD * (357.5291 + 0.98560028 * d);
  const sC = RAD * (1.9148 * Math.sin(sM) + 0.02 * Math.sin(2 * sM) + 0.0003 * Math.sin(3 * sM));
  const sL = sM + sC + RAD * 102.9372 + Math.PI;
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const mL = L + RAD * 6.289 * Math.sin(M);
  const mB = RAD * 5.128 * Math.sin(F);
  const ra = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
  const dec = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
  return {
    sun: { ra: ra(sL, 0), dec: dec(sL, 0) },
    moon: { ra: ra(mL, mB), dec: dec(mL, mB), dist: 385001 - 20905 * Math.cos(M) },
  };
}

/** How much of the moon is lit (0..1) and its phase (0 new, 0.5 full), from where the sun and moon are. */
export function moonIllumination(ms: number): { fraction: number; phase: number } {
  const { sun: s, moon: m } = bodies(ms);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI };
}

/* ---------- moonrise and moonset (after Vladimir Agafonkin's SunCalc, BSD) ---------- */

const RAD = Math.PI / 180;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;

/** The moon's altitude above the horizon, radians, at `ms` from `lat`, `lon` (degrees). */
function moonAltitude(ms: number, lat: number, lon: number): number {
  const d = toDays(ms);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
  const h = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Atmospheric refraction lifts it a little near the horizon.
  const hr = Math.max(0, h);
  return h + 0.0002967 / Math.tan(hr + 0.00312536 / (hr + 0.08901179));
}

/**
 * When the moon rises and sets during a local day (`dayStartMs`: that day's midnight, UTC ms), ms or
 * undefined when it doesn't that day. Altitudes every two hours, a parabola through each three.
 */
export function moonTimes(dayStartMs: number, lat: number, lon: number): { rise?: number; set?: number } {
  const hc = 0.133 * RAD;
  const at = (hours: number) => moonAltitude(dayStartMs + hours * 3_600_000, lat, lon) - hc;
  let h0 = at(0);
  let rise: number | undefined;
  let set: number | undefined;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = at(i);
    const h2 = at(i + 1);
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    const ye = (a * xe + b) * xe + h1;
    const d = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;
    if (d >= 0) {
      const dx = Math.sqrt(d) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return {
    rise: rise != null ? dayStartMs + rise * 3_600_000 : undefined,
    set: set != null ? dayStartMs + set * 3_600_000 : undefined,
  };
}
