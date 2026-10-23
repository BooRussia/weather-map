/** Moon phase from the date alone (no request): the mean synodic month from a known new moon. */

const SYNODIC_DAYS = 29.530588853;
/** New moon, 2000-01-06 18:14 UTC. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export interface MoonPhase {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Lit fraction of the disk, 0..1. */
  illumination: number;
  name: string;
  /** Whole days until the next full moon (0 when it's full now). */
  daysToFull: number;
  /** When the next full moon is (mean phase, so within about half a day). */
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
  const days = (at.getTime() - NEW_MOON_MS) / DAY_MS;
  const phase = (((days / SYNODIC_DAYS) % 1) + 1) % 1;
  const name = NAMES.find(([end]) => phase < end)![1];
  const toFull = ((0.5 - phase + 1) % 1) * SYNODIC_DAYS;
  return {
    phase,
    illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2,
    name,
    daysToFull: name === 'Full moon' ? 0 : Math.round(toFull),
    nextFull: new Date(at.getTime() + toFull * DAY_MS),
  };
}
