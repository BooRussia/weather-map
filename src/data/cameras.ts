import type { FeatureCollection, Point } from 'geojson';
import { fetchJson } from '../util/http';

/**
 * Traffic cameras from state DOTs, collected once a day by a scheduled job
 * (scripts/cameras.mjs) onto this repo's `cameras` branch: the DOTs' lists
 * can't be read from a browser, but their images and open streams can, so
 * those load live from each DOT.
 */
export const CAMERAS_URL = 'https://raw.githubusercontent.com/BooRussia/weather-map/cameras/cameras.json';

export interface CameraSource {
  id: string;
  /** "FL511" */
  name: string;
  /** "Florida DOT" */
  agency: string;
  /** The DOT's traveler site (live video there where it isn't open to other sites). */
  site: string;
  /** Snapshot URL template ({id}); "{id}" alone: the view's image is a full URL. */
  img: string;
  /** How often the DOT renews a snapshot, s. */
  refresh: number;
}

/** One view: the DOT's image id (or the image's URL) and its open live stream, or 0. */
export type CameraViewRow = [image: number | string, video: string | 0];
/** One camera: where, its source, its place and road, its views. */
export type CameraRow = [lat: number, lon: number, source: number, title: string, sub: string, views: CameraViewRow[]];

export interface CameraData {
  generated: string;
  sources: CameraSource[];
  cams: CameraRow[];
}

export interface CameraView {
  image: string;
  /** An HLS stream any site may play, or null (snapshots only). */
  video: string | null;
}

export interface Camera {
  i: number;
  lat: number;
  lon: number;
  source: CameraSource;
  title: string;
  sub: string;
  views: CameraView[];
}

let loading: Promise<CameraData> | null = null;

/** The camera list (once per visit; it changes daily at most). */
export function getCameras(): Promise<CameraData> {
  const remote = () => fetchJson<CameraData>(`${CAMERAS_URL}?d=${new Date().toISOString().slice(0, 10)}`, { timeoutMs: 20_000 });
  // Dev: a local copy from `node scripts/cameras.mjs public/cameras.dev.json` (git-ignored) wins if present.
  loading ??= (import.meta.env.DEV ? fetchJson<CameraData>('/cameras.dev.json').catch(remote) : remote()).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** A view's snapshot URL. */
export function imageUrl(source: CameraSource, image: number | string): string {
  return typeof image === 'string' ? image : source.img.replace('{id}', String(image));
}

/** Camera `i`, ready to show. */
export function camera(d: CameraData, i: number): Camera {
  const [lat, lon, s, title, sub, views] = d.cams[i];
  const source = d.sources[s];
  return { i, lat, lon, source, title, sub, views: views.map(([image, video]) => ({ image: imageUrl(source, image), video: video || null })) };
}

/** Every camera as a map point: its index, and whether it has live video (1) or snapshots (0). */
export function camerasGeoJSON(d: CameraData): FeatureCollection<Point, { i: number; live: number }> {
  return {
    type: 'FeatureCollection',
    features: d.cams.map((c, i) => ({
      type: 'Feature',
      properties: { i, live: c[5].some((v) => v[1]) ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [c[1], c[0]] },
    })),
  };
}

/** Distance between two points, miles. */
export function miles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The `n` cameras nearest camera `i` (within `maxMiles`), nearest first, with how far. */
export function nearby(d: CameraData, i: number, n = 8, maxMiles = 25): { i: number; miles: number }[] {
  const [lat, lon] = d.cams[i];
  // A quick box first: a degree of latitude is ~69 miles.
  const dLat = maxMiles / 69;
  const dLon = maxMiles / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const out: { i: number; miles: number }[] = [];
  d.cams.forEach((c, j) => {
    if (j === i || Math.abs(c[0] - lat) > dLat || Math.abs(c[1] - lon) > dLon) return;
    const m = miles(lat, lon, c[0], c[1]);
    if (m <= maxMiles) out.push({ i: j, miles: m });
  });
  return out.sort((a, b) => a.miles - b.miles).slice(0, n);
}
