import type { FeatureCollection, Geometry, Position } from 'geojson';
import { fetchJson } from '../util/http';
import type { StopForecast } from './openmeteo';
import type { RoutePoint } from './route';
import { MARINE } from './warnings';

/**
 * What a trip could run into, matched to when you'll be there:
 *   NWS warnings, watches, and advisories (polygons, with onset and end);
 *   SPC convective outlooks, days 1–3 (severe-storm risk areas);
 *   WPC excessive-rainfall outlooks, days 1–3 (flash-flood risk areas);
 *   and each stop's own forecast for its arrival hour.
 * All NOAA layers are queried with the route line itself (ArcGIS intersect).
 */

const NOAA = 'https://mapservices.weather.noaa.gov';
const WWA = `${NOAA}/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query`;
const SPC = `${NOAA}/vector/rest/services/outlooks/SPC_wx_outlks/MapServer`;
const WPC = `${NOAA}/vector/rest/services/hazards/wpc_precip_hazards/MapServer`;
/** Categorical convective outlook layers for days 1, 2, 3. */
const SPC_LAYERS = [1, 9, 17];
/** Excessive rainfall layers for days 1, 2, 3. */
const WPC_LAYERS = [0, 1, 2];
/** Most vertices sent as the query line. */
const MAX_QUERY_POINTS = 500;

export type Level = 'severe' | 'caution' | 'info';
export type HazardKind = 'alert' | 'storms' | 'flood' | 'thunder' | 'rain' | 'snow' | 'ice' | 'fog' | 'wind';
export type HazardSource = 'NWS' | 'SPC' | 'WPC' | 'Forecast';

export interface Hazard {
  kind: HazardKind;
  level: Level;
  source: HazardSource;
  title: string;
  /** Risk level, or when an alert starts or ends. */
  detail: string;
  /** First and last arrival time inside it, epoch ms. */
  from: number;
  to: number;
  /** Where you first meet it. */
  where: RoutePoint;
  /** In effect while you're there. False: on the route, but not while you pass. */
  active: boolean;
  url?: string;
}

const RANK: Record<Level, number> = { severe: 3, caution: 2, info: 1 };
export const worse = (a: Level | null, b: Level | null): Level | null => (!a ? b : !b ? a : RANK[b] > RANK[a] ? b : a);

/* ---------- geometry ---------- */

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in a Polygon or MultiPolygon (holes respected). */
export function inPolygon(lon: number, lat: number, g: Geometry): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lon, lat, hole)));
}

function bbox(g: Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const rings of polys) {
    for (const [x, y] of rings[0]) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  return b;
}

/** When the route is inside `g`: the first and last sample there. */
export function windowIn(samples: RoutePoint[], g: Geometry): { from: number; to: number; where: RoutePoint } | null {
  const [x0, y0, x1, y1] = bbox(g);
  if (!Number.isFinite(x0)) return null;
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (p.lon < x0 || p.lon > x1 || p.lat < y0 || p.lat > y1) continue;
    if (!inPolygon(p.lon, p.lat, g)) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) {
    // The line clips a corner between samples: use the sample nearest the area.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let best = 0;
    for (let i = 1; i < samples.length; i++) {
      if (Math.hypot(samples[i].lon - cx, samples[i].lat - cy) < Math.hypot(samples[best].lon - cx, samples[best].lat - cy)) best = i;
    }
    first = last = best;
  }
  return { from: samples[first].at, to: samples[last].at, where: samples[first] };
}

export const overlaps = (aFrom: number, aTo: number, bFrom: number, bTo: number) => aFrom <= bTo && bFrom <= aTo;

/* ---------- NOAA queries ---------- */

function lineQuery(samples: RoutePoint[], fields: string, where = '1=1'): URLSearchParams {
  const stride = Math.max(1, Math.ceil(samples.length / MAX_QUERY_POINTS));
  const path = samples.filter((_, i) => i % stride === 0 || i === samples.length - 1).map((p) => [+p.lon.toFixed(4), +p.lat.toFixed(4)]);
  return new URLSearchParams({
    where,
    geometry: JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolyline',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: fields,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '3',
    maxAllowableOffset: '0.01',
    f: 'geojson',
  });
}

const query = <P>(url: string, body: URLSearchParams, signal?: AbortSignal) =>
  fetchJson<FeatureCollection<Geometry, P>>(url, { body, signal, timeoutMs: 20_000 });

/** SPC "202610061630" (UTC). */
const spcTime = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
/** WPC "2026-10-06 16:00:00" (UTC). */
const wpcTime = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`);

interface WwaProps {
  prod_type: string;
  sig: string;
  onset: string | null;
  ends: string | null;
  expiration: string | null;
  url: string | null;
}

const ALERT_LEVEL: Record<string, Level> = { W: 'severe', A: 'caution', Y: 'caution', S: 'info' };

function alertHazards(fc: FeatureCollection<Geometry, WwaProps>, samples: RoutePoint[], time: (ms: number) => string): Hazard[] {
  // One alert can arrive as many zone polygons: merge them by alert.
  const byAlert = new Map<string, { h: Hazard; on: number; off: number }>();
  for (const f of fc.features) {
    const p = f.properties;
    if (!f.geometry || !p) continue;
    const w = windowIn(samples, f.geometry);
    if (!w) continue;
    const key = p.url ?? `${p.prod_type}|${p.onset}`;
    const prev = byAlert.get(key)?.h;
    if (prev) {
      if (w.from < prev.from) {
        prev.from = w.from;
        prev.where = w.where;
      }
      prev.to = Math.max(prev.to, w.to);
      continue;
    }
    byAlert.set(key, {
      h: {
        kind: 'alert',
        level: ALERT_LEVEL[p.sig] ?? 'info',
        source: 'NWS',
        title: p.prod_type,
        detail: '',
        from: w.from,
        to: w.to,
        where: w.where,
        active: true,
        url: p.url ?? undefined,
      },
      on: Date.parse(p.onset ?? '') || 0,
      off: Date.parse(p.ends ?? p.expiration ?? '') || Infinity,
    });
  }
  return [...byAlert.values()].map(({ h, on, off }) => {
    h.active = overlaps(h.from, h.to, on, off);
    if (!h.active) h.detail = off < h.from ? 'Ends before you get there' : 'Starts after you pass';
    else if (on > h.from) h.detail = `Starts ${time(on)}`;
    else if (Number.isFinite(off)) h.detail = `Until ${time(off)}`;
    return h;
  });
}

const SPC_RISK: Record<string, { rank: number; level: Level; detail: string }> = {
  TSTM: { rank: 1, level: 'info', detail: 'General thunderstorms' },
  MRGL: { rank: 2, level: 'caution', detail: 'Marginal risk (1 of 5)' },
  SLGT: { rank: 3, level: 'caution', detail: 'Slight risk (2 of 5)' },
  ENH: { rank: 4, level: 'severe', detail: 'Enhanced risk (3 of 5)' },
  MDT: { rank: 5, level: 'severe', detail: 'Moderate risk (4 of 5)' },
  HIGH: { rank: 6, level: 'severe', detail: 'High risk (5 of 5)' },
};

const WPC_RISK: Record<string, { rank: number; level: Level }> = {
  Marginal: { rank: 1, level: 'info' },
  Slight: { rank: 2, level: 'caution' },
  Moderate: { rank: 3, level: 'severe' },
  High: { rank: 4, level: 'severe' },
};

/**
 * One outlook day: the highest risk area the route crosses while that
 * outlook is valid. (Risk areas nest, so the highest one is the story.)
 */
function outlookHazard<P>(
  fc: FeatureCollection<Geometry, P>,
  samples: RoutePoint[],
  read: (p: P) => { rank: number; level: Level; valid: number; expire: number } | null,
  make: (p: P) => Pick<Hazard, 'kind' | 'title' | 'detail' | 'source'>,
): Hazard | null {
  let best: Hazard | null = null;
  let bestRank = 0;
  for (const f of fc.features) {
    if (!f.geometry || !f.properties) continue;
    const r = read(f.properties);
    if (!r || r.rank <= bestRank) continue;
    // Only the stretch of the drive inside the outlook's hours: these areas
    // can span half the country, but each is valid for about a day.
    const during = samples.filter((p) => p.at >= r.valid && p.at <= r.expire);
    if (!during.length) continue;
    const w = windowIn(during, f.geometry);
    if (!w || !inPolygon(w.where.lon, w.where.lat, f.geometry)) continue;
    bestRank = r.rank;
    best = { ...make(f.properties), level: r.level, from: w.from, to: w.to, where: w.where, active: true };
  }
  return best;
}

/** NOAA hazards along the route. Sources that fail are listed in `failed`; the rest still count. */
export async function getRouteHazards(
  samples: RoutePoint[],
  time: (ms: number) => string,
  signal?: AbortSignal,
): Promise<{ hazards: Hazard[]; failed: HazardSource[] }> {
  const failed = new Set<HazardSource>();
  const notMarine = `phenom NOT IN (${MARINE.map((m) => `'${m}'`).join(',')})`;
  const alerts = query<WwaProps>(WWA, lineQuery(samples, 'prod_type,sig,onset,ends,expiration,url', notMarine), signal)
    .then((fc) => alertHazards(fc, samples, time))
    .catch(() => (failed.add('NWS'), []));

  const spc = SPC_LAYERS.map((layer) =>
    query<{ label: string; valid: string; expire: string }>(`${SPC}/${layer}/query`, lineQuery(samples, 'label,valid,expire'), signal)
      .then((fc) =>
        outlookHazard(
          fc,
          samples,
          (p) => (SPC_RISK[p.label] ? { ...SPC_RISK[p.label], valid: spcTime(p.valid), expire: spcTime(p.expire) } : null),
          (p) =>
            p.label === 'TSTM'
              ? { kind: 'thunder', title: 'Thunderstorms possible', detail: SPC_RISK.TSTM.detail, source: 'SPC' }
              : { kind: 'storms', title: 'Severe storms possible', detail: SPC_RISK[p.label].detail, source: 'SPC' },
        ),
      )
      .catch(() => (failed.add('SPC'), null)),
  );

  const wpc = WPC_LAYERS.map((layer) =>
    query<{ outlook: string; start_time: string; end_time: string }>(
      `${WPC}/${layer}/query`,
      lineQuery(samples, 'outlook,start_time,end_time'),
      signal,
    )
      .then((fc) =>
        outlookHazard(
          fc,
          samples,
          (p) => {
            const word = p.outlook?.split(' ')[0] ?? '';
            return WPC_RISK[word] ? { ...WPC_RISK[word], valid: wpcTime(p.start_time), expire: wpcTime(p.end_time) } : null;
          },
          (p) => ({
            kind: 'flood',
            title: 'Flash flooding possible',
            detail: `${p.outlook.split(' ')[0]} risk of excessive rain`,
            source: 'WPC',
          }),
        ),
      )
      .catch(() => (failed.add('WPC'), null)),
  );

  const [a, ...outlooks] = await Promise.all([alerts, ...spc, ...wpc]);
  return { hazards: [...a, ...outlooks.filter((h): h is Hazard => !!h)], failed: [...failed] };
}

/* ---------- the forecast at each stop ---------- */

export interface StopFlag {
  kind: HazardKind;
  level: Level;
  title: string;
}

/** NWS's heavy-rain threshold, 0.3 in/h. */
const HEAVY_MM = 7.6;

/** Driving-relevant weather in one stop's forecast. */
export function stopFlags(f: StopForecast): StopFlag[] {
  const c = f.weatherCode;
  const out: StopFlag[] = [];
  const thunder = c >= 95;
  if (c === 96 || c === 99) out.push({ kind: 'thunder', level: 'severe', title: 'Thunderstorms with hail' });
  else if (c === 95) out.push({ kind: 'thunder', level: 'caution', title: 'Thunderstorms' });
  if ([56, 57, 66, 67].includes(c)) out.push({ kind: 'ice', level: 'severe', title: 'Freezing rain' });
  if (c === 75 || c === 86) out.push({ kind: 'snow', level: 'severe', title: 'Heavy snow' });
  else if ([71, 73, 77, 85].includes(c)) out.push({ kind: 'snow', level: 'caution', title: 'Snow' });
  if (f.precipitation >= HEAVY_MM || c === 65 || c === 82) out.push({ kind: 'rain', level: 'caution', title: 'Heavy rain' });
  else if (!thunder && ([61, 63, 80, 81].includes(c) || (f.precipProbability >= 60 && f.precipitation >= 0.3))) {
    out.push({ kind: 'rain', level: 'info', title: 'Rain' });
  }
  if (c === 45 || c === 48 || f.visibilityM < 1000) out.push({ kind: 'fog', level: 'caution', title: 'Fog' });
  if (f.gustMph >= 58) out.push({ kind: 'wind', level: 'severe', title: 'Damaging wind gusts' });
  else if (f.gustMph >= 40) out.push({ kind: 'wind', level: 'caution', title: 'Strong wind gusts' });
  return out;
}

/** The same weather again within this long continues the earlier stretch rather than starting a new one. */
const MERGE_GAP_MS = 65 * 60_000;

/** Stretches of stops with the same flag become one hazard ("Rain, 3:30–5 PM"). */
export function forecastHazards(stops: (RoutePoint & { flags: StopFlag[] })[]): Hazard[] {
  const out: Hazard[] = [];
  const last = new Map<string, Hazard>();
  for (const s of stops) {
    for (const f of s.flags) {
      const run = last.get(f.title);
      if (run && s.at - run.to <= MERGE_GAP_MS) {
        run.to = s.at;
        continue;
      }
      const hz: Hazard = { kind: f.kind, level: f.level, source: 'Forecast', title: f.title, detail: '', from: s.at, to: s.at, where: s, active: true };
      last.set(f.title, hz);
      out.push(hz);
    }
  }
  return out;
}

/** Worst first, then soonest; ones that won't affect you last. */
export function sortHazards(hs: Hazard[]): Hazard[] {
  return [...hs].sort((a, b) => Number(b.active) - Number(a.active) || RANK[b.level] - RANK[a.level] || a.from - b.from);
}
