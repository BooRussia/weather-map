import { fetchJson } from '../util/http';

const IEM = 'https://mesonet.agron.iastate.edu';
const HOUR = 3_600_000;

/** One NEXRAD radar (IEM uses the 3-letter id; people know it as K + id, e.g. KMOB). */
export interface RadarSite {
  id: string;
  name: string;
  state: string;
  lon: number;
  lat: number;
}

/** Single-site products IEM still renders: super-res reflectivity and storm-relative velocity. */
export type SiteProduct = 'N0B' | 'N0S';

/** What the radar layer needs to show a site: which, which product, and its scan times (epoch ms, ascending). */
export interface SiteFrames {
  id: string;
  product: SiteProduct;
  scans: number[];
}

/** "K" + id for the contiguous U.S. sites; Alaska, Hawaii, and territories keep P/T prefixes as NWS prints them. */
export function siteCall(s: Pick<RadarSite, 'id' | 'state'>): string {
  if (s.state === 'AK' || s.state === 'HI') return `P${s.id}`;
  if (s.state === 'PR' || s.state === 'GU') return `T${s.id}`;
  return `K${s.id}`;
}

let sites: Promise<RadarSite[]> | null = null;

/** Every NEXRAD site (160), fetched once. */
export function getRadarSites(signal?: AbortSignal): Promise<RadarSite[]> {
  type Props = { sid: string; sname: string; state: string; online?: boolean };
  sites ??= fetchJson<{ features: { properties: Props; geometry: { coordinates: [number, number] } }[] }>(`${IEM}/geojson/network/NEXRAD.geojson`, {
    signal,
    timeoutMs: 15_000,
  }).then((fc) =>
    fc.features
      .filter((f) => f.properties.online !== false)
      .map((f) => ({ id: f.properties.sid, name: f.properties.sname, state: f.properties.state, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })),
  );
  sites.catch(() => (sites = null));
  return sites;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';

/** A site's scan times for a product over the past `hours`, epoch ms, ascending. */
export async function getSiteScans(id: string, product: SiteProduct, hours: number, signal?: AbortSignal): Promise<number[]> {
  const end = Date.now() + 5 * 60_000;
  const q = new URLSearchParams({ operation: 'list', radar: id, product, start: iso(end - hours * HOUR), end: iso(end) });
  const r = await fetchJson<{ scans: { ts: string }[] }>(`${IEM}/json/radar.py?${q}`, { signal, timeoutMs: 15_000 });
  return r.scans.map((s) => Date.parse(s.ts)).filter(Number.isFinite).sort((a, b) => a - b);
}

/** The newest scan at or before `t` (the oldest if `t` is earlier than all), or null if there are none. */
export function scanAt(scans: number[], t: number): number | null {
  if (!scans.length) return null;
  let pick = scans[0];
  for (const s of scans) {
    if (s > t) break;
    pick = s;
  }
  return pick;
}
