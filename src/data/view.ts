import type { LatLon } from '../config';

/** A camera position: the map's center and zoom. */
export interface View extends LatLon {
  zoom: number;
}

const LAST_FIX_KEY = 'weather-map:last-fix';
const LAST_VIEW_KEY = 'weather-map:last-view';

const ok = (v: View) =>
  Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom) && Math.abs(v.lat) <= 85 && Math.abs(v.lon) <= 540 && v.zoom >= 0 && v.zoom <= 22;

/** `#map=7.25/29.0512/-82.4612` (zoom/lat/lon, like other web maps) → a view, or null. */
export function parseHashView(hash: string): View | null {
  const m = /(?:^#|&)map=([-\d.]+)\/([-\d.]+)\/([-\d.]+)/.exec(hash);
  if (!m) return null;
  const v = { zoom: +m[1], lat: +m[2], lon: +m[3] };
  return ok(v) ? v : null;
}

export const formatHashView = (v: View) => `#map=${v.zoom.toFixed(2)}/${v.lat.toFixed(4)}/${v.lon.toFixed(4)}`;

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: just not remembered.
  }
}

/** Your last known location, for starting there at once while a fresh fix is on its way. */
export function readLastFix(): LatLon | null {
  const v = read<LatLon>(LAST_FIX_KEY);
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
}

export const saveLastFix = (p: LatLon) => write(LAST_FIX_KEY, { lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) });

/** Where the map was left, for reopening there when location isn't in use. */
export function readLastView(): View | null {
  const v = read<View>(LAST_VIEW_KEY);
  return v && ok(v) ? v : null;
}

export const saveLastView = (v: View) => write(LAST_VIEW_KEY, v);
