import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { fetchJson } from '../util/http';

const IEM = 'https://mesonet.agron.iastate.edu/geojson';
const KT_TO_MPH = 1.15078;
/**
 * Cells topping out below this (thousands of feet) are almost always ground
 * clutter or beam artifacts (mountains, inversions), not storms: their
 * "strongest echo" sits a couple thousand feet up.
 */
const MIN_TOP_KFT = 8;
/** Faster than this (knots) is a tracking glitch, not a storm (the feed caps bad tracks at 99). */
const MAX_SKNT = 70;
/** Minutes ahead for the track ticks. */
export const TRACK_MINUTES = [15, 30, 45, 60];

/** What a storm cell is doing, worst first. */
export type CellThreat = 'tornado' | 'rotation' | 'hail' | 'storm';

/** A storm cell from the radar's storm-tracking algorithms (NEXRAD Level III attributes, via IEM). */
export interface StormCell {
  /** Radar site + its storm id ("MOB J2"); the id alone is reused across sites. */
  key: string;
  radar: string;
  id: string;
  lon: number;
  lat: number;
  /** Direction it's heading toward, degrees (the feed gives where it comes from). */
  heading: number;
  speedMph: number;
  /** False for a new cell with no track yet, or a tracking glitch (an impossible speed). */
  moving: boolean;
  maxDbz: number;
  /** Thousands of feet. */
  topKft: number;
  maxDbzKft: number;
  /** Probability of hail / of severe hail (%), and the largest expected (inches). */
  poh: number;
  posh: number;
  hailIn: number;
  /** Mesocyclone strength rank (1–25), 0 if none. */
  meso: number;
  tvs: boolean;
  /** When the radar saw it, epoch ms. */
  at: number;
  threat: CellThreat;
}

interface AttrProps {
  nexrad: string;
  storm_id: string;
  tvs: string;
  meso: string;
  posh: number;
  poh: number;
  max_size: number;
  max_dbz: number;
  max_dbz_height: number;
  top: number;
  drct: number;
  sknt: number;
  valid: string;
}

export function threatOf(c: Pick<StormCell, 'tvs' | 'meso' | 'hailIn' | 'posh'>): CellThreat {
  if (c.tvs) return 'tornado';
  if (c.meso > 0) return 'rotation';
  if (c.hailIn >= 1 || c.posh >= 50) return 'hail';
  return 'storm';
}

/** Point `miles` from (lon, lat) toward `heading` (short distances: flat-earth is plenty). */
export function project(lon: number, lat: number, heading: number, miles: number): [number, number] {
  const r = (heading * Math.PI) / 180;
  const dLat = (miles * Math.cos(r)) / 69.05;
  const dLon = (miles * Math.sin(r)) / (69.17 * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

export function toCell(p: AttrProps, lon: number, lat: number): StormCell {
  const meso = /^\d+$/.test(p.meso) ? Number(p.meso) : 0;
  // 0 kt from 0° means no track yet; impossible speeds are glitches.
  const moving = p.sknt < MAX_SKNT && !(p.sknt === 0 && p.drct === 0);
  const cell = {
    key: `${p.nexrad} ${p.storm_id}`,
    radar: p.nexrad,
    id: p.storm_id,
    lon,
    lat,
    heading: (p.drct + 180) % 360,
    speedMph: moving ? p.sknt * KT_TO_MPH : 0,
    moving,
    maxDbz: p.max_dbz,
    topKft: p.top,
    maxDbzKft: p.max_dbz_height,
    poh: p.poh,
    posh: p.posh,
    hailIn: p.max_size,
    meso,
    tvs: p.tvs !== 'NONE',
    at: Date.parse(p.valid),
    threat: 'storm' as CellThreat,
  };
  cell.threat = threatOf(cell);
  return cell;
}

/**
 * Storm cells nationwide (each radar's latest volume, past 30 minutes),
 * without shallow clutter. Several radars see the same storm; the strongest
 * report per spot wins.
 */
export async function getStormCells(signal?: AbortSignal): Promise<StormCell[]> {
  const fc = await fetchJson<FeatureCollection<Point, AttrProps>>(`${IEM}/nexrad_attr.geojson`, { signal, timeoutMs: 15_000 });
  const cells = fc.features
    .filter((f) => f.properties && f.geometry)
    .map((f) => toCell(f.properties, f.geometry.coordinates[0], f.geometry.coordinates[1]))
    .filter((c) => c.topKft >= MIN_TOP_KFT);
  // Overlapping radars: keep one cell per ~5 km, the one with the strongest echo.
  const byCell = new Map<string, StormCell>();
  for (const c of cells.sort((a, b) => b.maxDbz - a.maxDbz)) {
    const k = `${Math.round(c.lon * 20)},${Math.round(c.lat * 20)}`;
    if (!byCell.has(k)) byCell.set(k, c);
  }
  return [...byCell.values()];
}

/** Map features: each cell as a point, and where it's headed as a line with 15-minute ticks. */
export function cellFeatures(cells: StormCell[]): { points: FeatureCollection<Point>; tracks: FeatureCollection<LineString | Point> } {
  const points: Feature<Point>[] = [];
  const tracks: Feature<LineString | Point>[] = [];
  for (const c of cells) {
    points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { key: c.key, threat: c.threat, dbz: c.maxDbz } });
    if (c.speedMph < 3) continue;
    // Plain strong storms get a short path; dangerous ones the full hour (fewer lines across the map).
    const minutes = c.threat === 'storm' ? TRACK_MINUTES.slice(0, 2) : TRACK_MINUTES;
    const ahead = minutes.map((m) => project(c.lon, c.lat, c.heading, (c.speedMph * m) / 60));
    tracks.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[c.lon, c.lat], ...ahead] }, properties: { key: c.key, threat: c.threat } });
    ahead.forEach((p, i) =>
      tracks.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { key: c.key, minutes: minutes[i], threat: c.threat } }),
    );
  }
  return { points: { type: 'FeatureCollection', features: points }, tracks: { type: 'FeatureCollection', features: tracks } };
}

/* ---------- storm reports ---------- */

export type ReportKind = 'tornado' | 'hail' | 'wind' | 'flood' | 'other';

export interface StormReport {
  kind: ReportKind;
  /** "HAIL", "TSTM WND DMG" as NWS prints it. */
  type: string;
  magnitude: string;
  unit: string;
  place: string;
  source: string;
  remark: string;
  at: number;
  lon: number;
  lat: number;
}

interface LsrProps {
  typetext: string;
  magnitude: string;
  unit: string | null;
  city: string;
  st: string;
  source: string;
  remark: string | null;
  valid: string;
}

export function reportKind(type: string): ReportKind {
  const t = type.toUpperCase();
  if (t.includes('TORNADO') || t.includes('FUNNEL') || t.includes('WATERSPOUT')) return 'tornado';
  if (t.includes('HAIL')) return 'hail';
  if (t.includes('WND') || t.includes('WIND') || t.includes('GUST')) return 'wind';
  if (t.includes('FLOOD') || t.includes('RAIN')) return 'flood';
  return 'other';
}

/** Local storm reports (hail, wind, tornadoes, floods) from the past `hours`, nationwide. */
export async function getStormReports(hours = 24, signal?: AbortSignal): Promise<StormReport[]> {
  const fc = await fetchJson<FeatureCollection<Point, LsrProps>>(`${IEM}/lsr.geojson?hours=${hours}`, { signal, timeoutMs: 15_000 });
  return fc.features
    .filter((f) => f.properties && f.geometry)
    .map((f) => {
      const p = f.properties;
      return {
        kind: reportKind(p.typetext),
        type: p.typetext,
        magnitude: p.magnitude ?? '',
        unit: p.unit ?? '',
        place: [p.city, p.st].filter(Boolean).join(', '),
        source: p.source ?? '',
        remark: p.remark ?? '',
        at: Date.parse(p.valid),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      };
    })
    .filter((r) => r.kind !== 'other');
}
