import type { LatLon } from '../config';
import { fetchJson, HttpError } from '../util/http';

/**
 * Driving directions: OSRM on the FOSSGIS servers that openstreetmap.org
 * uses. Free, no key, fair use. Durations are typical speeds, not traffic.
 */
const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';

export interface Route {
  /** [lon, lat] vertices. */
  coords: [number, number][];
  /** Seconds of driving from the start to each vertex. */
  secs: number[];
  /** Meters from the start to each vertex. */
  meters: number[];
  /** Total meters and seconds. */
  distance: number;
  duration: number;
}

/** A spot on the route and when you'll be there. */
export interface RoutePoint {
  lat: number;
  lon: number;
  /** Epoch ms. */
  at: number;
  /** Meters from the start. */
  m: number;
}

interface OsrmRoute {
  geometry: { coordinates: [number, number][] };
  legs: { annotation: { duration: number[]; distance: number[] } }[];
}

export class RouteError extends Error {}

/** Cumulative time and distance along OSRM's geometry. */
export function toRoute(r: OsrmRoute): Route {
  const coords = r.geometry.coordinates;
  const dur = r.legs.flatMap((l) => l.annotation.duration);
  const dist = r.legs.flatMap((l) => l.annotation.distance);
  const secs = [0];
  const meters = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    secs.push(secs[i] + (dur[i] ?? 0));
    meters.push(meters[i] + (dist[i] ?? 0));
  }
  return { coords, secs, meters, distance: meters[meters.length - 1], duration: secs[secs.length - 1] };
}

export async function getRoute(from: LatLon, to: LatLon, signal?: AbortSignal): Promise<Route> {
  const pt = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
  const url = `${OSRM}/${pt(from)};${pt(to)}?overview=full&geometries=geojson&annotations=duration,distance`;
  try {
    const r = await fetchJson<{ code: string; routes?: OsrmRoute[] }>(url, { signal, timeoutMs: 20_000 });
    if (r.code !== 'Ok' || !r.routes?.[0]) throw new RouteError('No driving route between those places.');
    return toRoute(r.routes[0]);
  } catch (err) {
    // OSRM answers "no route" (an ocean, an island) with a 400.
    if (err instanceof HttpError && err.status === 400) throw new RouteError('No driving route between those places.');
    throw err;
  }
}

/** The spot `s` seconds of driving from the start (interpolated), stamped with clock time `at`. */
export function pointAt(route: Route, s: number, at = 0): RoutePoint {
  const last = route.coords.length - 1;
  if (last < 1 || s >= route.duration) {
    const [x, y] = route.coords[last];
    return { lon: x, lat: y, at, m: route.distance };
  }
  // Binary search: the segment that contains `s`.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route.secs[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t0 = route.secs[lo];
  const t1 = route.secs[hi];
  const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
  const [x0, y0] = route.coords[lo];
  const [x1, y1] = route.coords[hi];
  return {
    lon: x0 + (x1 - x0) * f,
    lat: y0 + (y1 - y0) * f,
    at,
    m: route.meters[lo] + (route.meters[hi] - route.meters[lo]) * f,
  };
}
