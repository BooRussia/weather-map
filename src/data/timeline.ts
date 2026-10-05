import { FUTURE_RADAR_TILE_URL, HRRR_MAX_MINUTES, PAST_RADAR_TILE_URL, TIMELINE_PAST_HOURS } from '../config';

const HOUR = 3_600_000;

/**
 * The radar timeline: hourly stops from 24 hours ago, through "now" (the live
 * NWS radar), into the HRRR forecast. Offsets are whole hours from the top of
 * the current hour; 0 means now.
 */
export interface Timeline {
  /** Top of the current UTC hour, epoch ms. */
  base: number;
  /** HRRR run time, epoch ms (null if unknown: no future stops). */
  init: number | null;
  minOffset: number;
  maxOffset: number;
}

export function makeTimeline(now: number, init: number | null): Timeline {
  const base = Math.floor(now / HOUR) * HOUR;
  // The last stop must still be inside the HRRR run's 18 hours.
  const maxOffset = init == null ? 0 : Math.max(0, Math.floor((init + HRRR_MAX_MINUTES * 60_000 - base) / HOUR));
  return { base, init, minOffset: -TIMELINE_PAST_HOURS, maxOffset };
}

export const offsetTime = (t: Timeline, offset: number) => t.base + offset * HOUR;

/** UTC YYYYMMDDHHMM. */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

/** UTC hour key matching Open-Meteo `timezone=GMT` hourly times: YYYY-MM-DDTHH:00. */
export function utcHourKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13) + ':00';
}

export type FrameSource = { kind: 'live' } | { kind: 'past' | 'future'; url: string };

/** Which tiles to show at an offset. */
export function frameSource(t: Timeline, offset: number): FrameSource {
  if (offset === 0) return { kind: 'live' };
  const at = offsetTime(t, offset);
  if (offset < 0) return { kind: 'past', url: PAST_RADAR_TILE_URL.replace('{stamp}', utcStamp(at)) };
  if (t.init == null) return { kind: 'live' };
  const minutes = Math.round((at - t.init) / 60_000);
  return {
    kind: 'future',
    url: FUTURE_RADAR_TILE_URL.replace('{minutes}', String(minutes).padStart(4, '0')).replace('{init}', utcStamp(t.init)),
  };
}

/** "Now", "−3 h", "+5 h". */
export function relativeLabel(offset: number): string {
  if (offset === 0) return 'Now';
  return offset < 0 ? `−${-offset} h` : `+${offset} h`;
}
