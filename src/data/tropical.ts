import type { FeatureCollection, Geometry } from 'geojson';
import { fetchJson } from '../util/http';

/**
 * Tropical cyclones, from official sources:
 *   NHC GIS (NOAA map services, live): forecast cone, track and points,
 *     watches/warnings, past track, and the seven-day outlook areas;
 *   NHC's storm list and ATCF model guidance, which browsers can't fetch
 *     directly (no CORS): a scheduled job (scripts/tropical.mjs) publishes
 *     them as JSON on this repo's `data` branch every 30 minutes.
 */

export const TROPICAL_DATA_URL = 'https://raw.githubusercontent.com/BooRussia/weather-map/data/tropical.json';
const NHC_GIS = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

export type ModelGroup = 'official' | 'consensus' | 'hurricane' | 'global' | 'ensembleMean' | 'statistical' | 'member';

export interface ModelTrack {
  tech: string;
  group: ModelGroup;
  /** Model run time, epoch ms. */
  init: number;
  /** [hours after init, lat, lon, max wind kt] */
  pts: [number, number, number, number][];
}

export interface Storm {
  id: string;
  /** NHC GIS slot: AT1–AT5, EP1–EP5, CP1–CP5. */
  bin: string;
  name: string;
  /** TD, TS, HU, STD, STS, PTC, PC, … */
  classification: string;
  intensityKt: number;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDir: number | null;
  movementKt: number | null;
  updated: string;
  advisory: string | null;
  advisoryUrl: string | null;
  discussionUrl: string | null;
  models: ModelTrack[];
  modelsError: string | null;
}

export interface TropicalData {
  generated: string;
  storms: Storm[];
}

/** NHC's official forecast for one storm, from its GIS slot. */
export interface StormGIS {
  cone: FeatureCollection;
  track: FeatureCollection;
  points: FeatureCollection<Geometry, ForecastPointProps>;
  past: FeatureCollection;
  warnings: FeatureCollection<Geometry, { tcww?: string }>;
}

export interface ForecastPointProps {
  stormname: string;
  maxwind: number;
  gust: number;
  mslp: number;
  tau: number;
  datelbl: string;
  fldatelbl: string;
  tcdvlp: string;
  dvlbl: string;
  advdate: string;
  advisnum: string;
}

export interface Outlook {
  areas: FeatureCollection<Geometry, OutlookProps>;
  points: FeatureCollection<Geometry, OutlookProps>;
}

export interface OutlookProps {
  prob2day: string;
  prob7day: string;
  risk7day: string;
}

/* ---------- names and categories ---------- */

const NAMES: Record<string, string> = {
  TD: 'Tropical Depression',
  TS: 'Tropical Storm',
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  STD: 'Subtropical Depression',
  STS: 'Subtropical Storm',
  PTC: 'Potential Tropical Cyclone',
  PC: 'Post-Tropical Cyclone',
  TY: 'Typhoon',
};

/** "Hurricane Nine", "Tropical Depression Nine". */
export const stormTitle = (s: Pick<Storm, 'classification' | 'name' | 'intensityKt'>) =>
  `${s.classification === 'HU' && s.intensityKt >= 96 ? 'Major Hurricane' : (NAMES[s.classification] ?? 'Storm')} ${s.name}`;

export type Category = 'TD' | 'TS' | '1' | '2' | '3' | '4' | '5';

/** Saffir–Simpson category for a sustained wind (kt). */
export function category(kt: number): Category {
  if (kt >= 137) return '5';
  if (kt >= 113) return '4';
  if (kt >= 96) return '3';
  if (kt >= 83) return '2';
  if (kt >= 64) return '1';
  if (kt >= 34) return 'TS';
  return 'TD';
}

export const categoryLabel = (c: Category) => (c === 'TD' ? 'Depression' : c === 'TS' ? 'Tropical storm' : `Category ${c}`);

/* ---------- fetching ---------- */

/** The published storm list and models. Cache-busted to the 5-minute window raw.githubusercontent caches for. */
export async function getTropicalData(signal?: AbortSignal): Promise<TropicalData> {
  const remote = () => fetchJson<TropicalData>(`${TROPICAL_DATA_URL}?t=${Math.floor(Date.now() / 300_000)}`, { signal, timeoutMs: 12_000 });
  // Dev: a local copy from `node scripts/tropical.mjs public/tropical.dev.json` (git-ignored) wins if present.
  if (import.meta.env.DEV) return fetchJson<TropicalData>('/tropical.dev.json', { signal }).catch(remote);
  return remote();
}

/** First layer id of a storm slot's group: AT1 = 4, AT2 = 30, … every 26. */
export function binBase(bin: string): number | null {
  const m = /^(AT|EP|CP)([1-5])$/.exec(bin);
  if (!m) return null;
  return 4 + 26 * ({ AT: 0, EP: 5, CP: 10 }[m[1] as 'AT' | 'EP' | 'CP'] + Number(m[2]) - 1);
}

const ALL_BINS = ['AT', 'EP', 'CP'].flatMap((b) => [1, 2, 3, 4, 5].map((n) => `${b}${n}`));

function layer<P = Record<string, unknown>>(id: number, signal?: AbortSignal): Promise<FeatureCollection<Geometry, P>> {
  const q = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson' });
  return fetchJson<FeatureCollection<Geometry, P>>(`${NHC_GIS}/${id}/query?${q}`, { signal, timeoutMs: 15_000 });
}

const EMPTY = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

/** The official forecast cone, track, points, watches/warnings, and past track for a slot. */
export async function getStormGIS(bin: string, signal?: AbortSignal): Promise<StormGIS> {
  const base = binBase(bin);
  if (base == null) {
    return { cone: EMPTY(), track: EMPTY(), points: EMPTY() as StormGIS['points'], past: EMPTY(), warnings: EMPTY() as StormGIS['warnings'] };
  }
  const safe = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
  const [points, track, cone, warnings, past] = await Promise.all([
    safe(layer<ForecastPointProps>(base + 2, signal), EMPTY() as StormGIS['points']),
    safe(layer(base + 3, signal), EMPTY()),
    safe(layer(base + 4, signal), EMPTY()),
    safe(layer<{ tcww?: string }>(base + 5, signal), EMPTY() as StormGIS['warnings']),
    safe(layer(base + 8, signal), EMPTY()),
  ]);
  points.features.sort((a, b) => (a.properties?.tau ?? 0) - (b.properties?.tau ?? 0));
  return { cone, track, points, past, warnings };
}

/** Areas NHC is watching for development over the next seven days. */
export async function getOutlook(signal?: AbortSignal): Promise<Outlook> {
  const [areas, points] = await Promise.all([layer<OutlookProps>(3, signal), layer<OutlookProps>(2, signal)]);
  return { areas, points };
}

/**
 * Without the published list (the job hasn't run, or GitHub is down): find
 * active storms from NHC's GIS slots directly. No models in this case.
 */
export async function discoverStorms(signal?: AbortSignal): Promise<Storm[]> {
  const found = await Promise.all(
    ALL_BINS.map(async (bin) => {
      const pts = await layer<ForecastPointProps & { lat: number; lon: number; stormtype: string; basin: string; stormnum: number }>(
        binBase(bin)! + 2,
        signal,
      ).catch(() => null);
      const now = pts?.features.find((f) => f.properties?.tau === 0) ?? pts?.features[0];
      if (!now?.properties) return null;
      const p = now.properties;
      const name = p.stormname.split(' ').pop() ?? p.stormname;
      const storm: Storm = {
        id: `${p.basin.toLowerCase()}${String(p.stormnum).padStart(2, '0')}`,
        bin,
        name,
        classification: p.stormtype,
        intensityKt: p.maxwind,
        pressureMb: p.mslp && p.mslp < 9999 ? p.mslp : null,
        lat: p.lat,
        lon: p.lon,
        movementDir: null,
        movementKt: null,
        updated: p.advdate,
        advisory: p.advisnum,
        advisoryUrl: null,
        discussionUrl: null,
        models: [],
        modelsError: 'Model tracks are unavailable right now.',
      };
      return storm;
    }),
  );
  return found.filter((s): s is Storm => !!s);
}

/** Active storms: the published list, or what NHC's GIS shows if that can't be had. */
export async function getStorms(signal?: AbortSignal): Promise<{ storms: Storm[]; generated: string | null }> {
  try {
    const d = await getTropicalData(signal);
    return { storms: d.storms, generated: d.generated };
  } catch {
    return { storms: await discoverStorms(signal), generated: null };
  }
}

/** A storm's model guidance as map lines; each point carries its time and wind. */
export function modelLines(storm: Storm, groups: Set<ModelGroup>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: storm.models
      .filter((m) => groups.has(m.group) && m.pts.length >= 2)
      .map((m) => ({
        type: 'Feature',
        properties: { tech: m.tech, group: m.group },
        geometry: { type: 'LineString', coordinates: m.pts.map(([, lat, lon]) => [lon, lat]) },
      })),
  };
}
