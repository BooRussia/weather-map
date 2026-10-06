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

/** Points every `stepMin` minutes of driving from `depart` (epoch ms), always ending at the destination. */
export function sampleRoute(route: Route, depart: number, stepMin: number): RoutePoint[] {
  const out: RoutePoint[] = [];
  const step = stepMin * 60;
  const last = route.coords.length - 1;
  let i = 0;
  for (let s = 0; last > 0 && s < route.duration; s += step) {
    while (i < last - 1 && route.secs[i + 1] < s) i++;
    const t0 = route.secs[i];
    const t1 = route.secs[i + 1];
    const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
    const [x0, y0] = route.coords[i];
    const [x1, y1] = route.coords[i + 1];
    out.push({
      lon: x0 + (x1 - x0) * f,
      lat: y0 + (y1 - y0) * f,
      at: depart + s * 1000,
      m: route.meters[i] + (route.meters[i + 1] - route.meters[i]) * f,
    });
  }
  const [x, y] = route.coords[last];
  out.push({ lon: x, lat: y, at: depart + route.duration * 1000, m: route.distance });
  return out;
}
