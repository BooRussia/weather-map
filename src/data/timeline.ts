import {
  FUTURE_RADAR_TILE_URL,
  HRRR_MAX_MINUTES,
  IEM_HOSTS,
  LATEST_RADAR_TILE_URL,
  MRMS_TILE_URL,
  MRMS_WMS_URL,
  PAST_RADAR_TILE_URL,
  PTYPE_TILE_URL,
  SAT_RAIN_PRODUCT,
  SITE_RADAR_TILE_URL,
  TIMELINE_PAST_HOURS,
} from '../config';
import { frameBefore, nearestFrame } from './frames';
import { realEarthTiles } from './realearth';
import { scanAt, type SiteFrames } from './radarSites';

const HOUR = 3_600_000;
/** Frames are 15 minutes apart: the archive and HRRR both publish at that cadence. */
export const STEP_H = 0.25;
const STEP_MS = STEP_H * HOUR;

/**
 * The radar timeline: 15-minute frames from 24 hours ago, through "now"
 * (the newest MRMS frame), into the HRRR forecast. Offsets are hours from the
 * current 15-minute mark, in multiples of 0.25; 0 means now.
 */
export interface Timeline {
  /** The current 15-minute mark (UTC), epoch ms. */
  base: number;
  /** HRRR run time, epoch ms (null if unknown: no future frames). */
  init: number | null;
  /** Valid time of the newest composite, epoch ms (null if unknown). */
  live: number | null;
  minOffset: number;
  maxOffset: number;
  /** A single radar site to show instead of the composite for the past and now (null: the composite). */
  site: SiteFrames | null;
  /** MRMS frame times (the last 2 hours), oldest first; older frames, or all if empty, are the IEM composite. */
  radar: readonly number[];
  /** Satellite rain-estimate frame times, oldest first (empty: no fill beyond radar range). */
  sat: readonly number[];
}

export function makeTimeline(
  now: number,
  init: number | null,
  live: number | null = null,
  site: SiteFrames | null = null,
  radar: readonly number[] = [],
  sat: readonly number[] = [],
): Timeline {
  const base = Math.floor(now / STEP_MS) * STEP_MS;
  // The last frame must still be inside the HRRR run's 18 hours. A site's velocity has no forecast.
  const maxOffset =
    init == null || site?.product === 'N0S' ? 0 : Math.max(0, Math.floor((init + HRRR_MAX_MINUTES * 60_000 - base) / STEP_MS) * STEP_H);
  return { base, init, live, minOffset: -TIMELINE_PAST_HOURS, maxOffset, site, radar, sat };
}

/** The tile template for one site scan. */
export const siteTiles = (site: SiteFrames, scan: number) =>
  SITE_RADAR_TILE_URL.replace('{site}', site.id).replace('{product}', site.product).replace('{stamp}', utcStamp(scan));

/** The tile templates for one MRMS frame and one satellite rain frame. */
export const mrmsTiles = (at: number) => MRMS_TILE_URL.replace('{time}', new Date(at).toISOString());
export const satTiles = (at: number) => realEarthTiles(SAT_RAIN_PRODUCT, at);

/** An MRMS frame stands in for a 15-minute mark if it's this close (they're 2 minutes apart). */
const MRMS_TOLERANCE_MS = 3 * 60_000;
/** The satellite estimate runs ~45 minutes behind: recent frames use the newest one up to this old. */
const SAT_MAX_AGE_MS = 75 * 60_000;

/**
 * How a frame's tiles are colored, so they decode right: IEM's NEXRAD palette, NCEP's MRMS palette,
 * the satellite rain-rate bins, or IEM's velocity.
 */
export type TilePalette = 'n0q' | 'mrms' | 'sat' | 'velocity' | 'ptype';

export function tilePalette(url: string): TilePalette {
  if (url.startsWith(MRMS_WMS_URL)) return 'mrms';
  if (url.includes('hrrr::REFP-')) return 'ptype';
  if (url.includes(`products=${SAT_RAIN_PRODUCT}_`)) return 'sat';
  return url.includes('-N0S-') ? 'velocity' : 'n0q';
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

export interface FrameSource {
  kind: 'live' | 'past' | 'future';
  /** Tile URL template ({z}/{x}/{y}); also the frame's identity. */
  url: string;
  /** The moment it shows, epoch ms. */
  at: number;
  /** Satellite rain for the same moment, drawn only where no radar reaches (null: none). */
  sat: string | null;
  /** What's falling then (HRRR's precipitation type, rain / snow / freezing rain / sleet); null: unknown. */
  ptype: string | null;
}

/**
 * The HRRR precipitation-type tiles for a moment: the run started that hour (archived), or for anything
 * newer than the latest run, that run's forecast for the moment. 15-minute steps, 18 hours out.
 */
export function ptypeTiles(t: Timeline, at: number): string | null {
  if (t.init == null) return null;
  const init = Math.min(Math.floor(at / HOUR) * HOUR, t.init);
  const minutes = Math.round((at - init) / (15 * 60_000)) * 15;
  if (minutes < 0 || minutes > HRRR_MAX_MINUTES) return null;
  return PTYPE_TILE_URL.replace('{minutes}', String(minutes).padStart(4, '0')).replace('{init}', utcStamp(init));
}

/** Satellite rain for a moment: the newest estimate up to SAT_MAX_AGE_MS old. */
function satAt(t: Timeline, at: number): string | null {
  const s = frameBefore(t.sat, at, SAT_MAX_AGE_MS);
  return s == null ? null : satTiles(s);
}

/** Inside the MRMS window, real frames this far apart play between the timeline's 15-minute marks. */
export const SUB_STEP_MS = 5 * 60_000;

/**
 * The MRMS frames between two neighboring frames, about 5 minutes apart, so the last 2 hours play the
 * radar's own motion instead of motion filled in between 15-minute frames. Empty unless both ends are MRMS.
 */
export function framesBetween(t: Timeline, a: FrameSource, b: FrameSource): FrameSource[] {
  if (t.site || tilePalette(a.url) !== 'mrms' || tilePalette(b.url) !== 'mrms' || !(b.at > a.at)) return [];
  const n = Math.round((b.at - a.at) / SUB_STEP_MS);
  const out: FrameSource[] = [];
  let prev = a.at;
  for (let k = 1; k < n; k++) {
    const at = nearestFrame(t.radar, a.at + (k * (b.at - a.at)) / n, SUB_STEP_MS / 2);
    if (at == null || at <= prev || at >= b.at) continue;
    out.push({ kind: 'past', url: mrmsTiles(at), at, sat: satAt(t, at), ptype: ptypeTiles(t, at) });
    prev = at;
  }
  return out;
}

/** Which tiles to show at an offset. */
export function frameSource(t: Timeline, offset: number): FrameSource {
  const o = snap(offset);
  // A chosen site: its own newest scan at or before the moment (now: its latest scan).
  if (t.site && o <= 0) {
    const scan = scanAt(t.site.scans, o === 0 ? Infinity : offsetTime(t, o));
    if (scan != null) {
      const ptype = t.site.product === 'N0S' ? null : ptypeTiles(t, scan);
      return { kind: o === 0 ? 'live' : 'past', url: siteTiles(t.site, scan), at: scan, sat: null, ptype };
    }
  }
  // Now and the last 2 hours from MRMS; older from the IEM archive (both base reflectivity, the lowest beam).
  // Past radar range, satellite rain fills in.
  const sat = (at: number) => satAt(t, at);
  const newest = t.radar[t.radar.length - 1];
  if (o === 0 && newest != null) return { kind: 'live', url: mrmsTiles(newest), at: newest, sat: sat(newest), ptype: ptypeTiles(t, newest) };
  // Without MRMS: IEM's always-latest tiles, versioned by the composite's time so each new scan is a new URL.
  // (The stamped archive can lag the newest scan by a minute or two and 503 meanwhile.)
  const liveAt = t.live ?? t.base;
  const live: FrameSource = {
    kind: 'live',
    url: t.live == null ? LATEST_RADAR_TILE_URL : `${LATEST_RADAR_TILE_URL}?v=${utcStamp(t.live)}`,
    at: liveAt,
    sat: sat(liveAt),
    ptype: ptypeTiles(t, liveAt),
  };
  if (o === 0) return live;
  const at = offsetTime(t, o);
  if (o < 0) {
    const frame = nearestFrame(t.radar, at, MRMS_TOLERANCE_MS);
    if (frame != null) return { kind: 'past', url: mrmsTiles(frame), at: frame, sat: sat(at), ptype: ptypeTiles(t, at) };
    return { kind: 'past', url: PAST_RADAR_TILE_URL.replace('{stamp}', utcStamp(at)), at, sat: sat(at), ptype: ptypeTiles(t, at) };
  }
  if (t.init == null) return live;
  const minutes = Math.round((at - t.init) / 60_000);
  // The forecast model covers the ocean itself: no satellite fill.
  return {
    kind: 'future',
    url: FUTURE_RADAR_TILE_URL.replace('{minutes}', String(minutes).padStart(4, '0')).replace('{init}', utcStamp(t.init)),
    at,
    sat: null,
    ptype: ptypeTiles(t, at),
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
