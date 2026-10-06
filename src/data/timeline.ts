import { FUTURE_RADAR_TILE_URL, HRRR_MAX_MINUTES, IEM_HOSTS, PAST_RADAR_TILE_URL, TIMELINE_PAST_HOURS } from '../config';

const HOUR = 3_600_000;
/** Frames are 15 minutes apart: the archive and HRRR both publish at that cadence. */
export const STEP_H = 0.25;
const STEP_MS = STEP_H * HOUR;

/**
 * The radar timeline: 15-minute frames from 24 hours ago, through "now"
 * (the live NWS radar), into the HRRR forecast. Offsets are hours from the
 * current 15-minute mark, in multiples of 0.25; 0 means now.
 */
export interface Timeline {
  /** The current 15-minute mark (UTC), epoch ms. */
  base: number;
  /** HRRR run time, epoch ms (null if unknown: no future frames). */
  init: number | null;
  minOffset: number;
  maxOffset: number;
}

export function makeTimeline(now: number, init: number | null): Timeline {
  const base = Math.floor(now / STEP_MS) * STEP_MS;
  // The last frame must still be inside the HRRR run's 18 hours.
  const maxOffset = init == null ? 0 : Math.max(0, Math.floor((init + HRRR_MAX_MINUTES * 60_000 - base) / STEP_MS) * STEP_H);
  return { base, init, minOffset: -TIMELINE_PAST_HOURS, maxOffset };
}

export const offsetTime = (t: Timeline, offset: number) => t.base + Math.round(offset * 60) * 60_000;

/** Snap any offset to the nearest frame. */
export const snap = (offset: number) => Math.round(offset / STEP_H) * STEP_H;

/** UTC YYYYMMDDHHMM. */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

/** Nearest UTC hour, as Open-Meteo `timezone=GMT` writes it: YYYY-MM-DDTHH:00. */
export function utcHourKey(ms: number): string {
  return new Date(Math.round(ms / HOUR) * HOUR).toISOString().slice(0, 13) + ':00';
}

export type FrameSource = { kind: 'live' } | { kind: 'past' | 'future'; url: string };

/** Which tiles to show at an offset. */
export function frameSource(t: Timeline, offset: number): FrameSource {
  const o = snap(offset);
  if (o === 0) return { kind: 'live' };
  const at = offsetTime(t, o);
  if (o < 0) return { kind: 'past', url: PAST_RADAR_TILE_URL.replace('{stamp}', utcStamp(at)) };
  if (t.init == null) return { kind: 'live' };
  const minutes = Math.round((at - t.init) / 60_000);
  return {
    kind: 'future',
    url: FUTURE_RADAR_TILE_URL.replace('{minutes}', String(minutes).padStart(4, '0')).replace('{init}', utcStamp(t.init)),
  };
}

/** The same IEM tile URL on each of its hostnames (MapLibre spreads tiles across them). */
export const tileMirrors = (url: string) => IEM_HOSTS.map((host) => url.replace('://mesonet.', `://${host}.`));

/** "Now", "−45 min", "−3 h", "+2 h 15 min". */
export function relativeLabel(offset: number): string {
  const o = snap(offset);
  if (o === 0) return 'Now';
  const sign = o < 0 ? '−' : '+';
  const total = Math.round(Math.abs(o) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${sign}${m} min`;
  return m ? `${sign}${h} h ${m} min` : `${sign}${h} h`;
}
