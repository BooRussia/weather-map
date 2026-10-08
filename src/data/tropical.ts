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
  /** Current extent of 34-, 50-, and 64-kt winds. */
  windField: FeatureCollection<Geometry, { radii: number }>;
  /** Most likely arrival time of tropical-storm-force winds ("Wed 8 am"). */
  arrival: FeatureCollection<Geometry, { arrival_time: string }>;
  /** NHC has issued a potential storm surge flooding map for this storm. */
  surge: boolean;
}

/** Layer offsets inside a storm slot's group (AT1 = 4, so AT1's cone is layer 8). */
export const SLOT = {
  points: 2,
  track: 3,
  cone: 4,
  warnings: 5,
  past: 8,
  windField: 13,
  arrivalMostLikely: 16,
  surgeFootprint: 20,
  surgeImage: 21,
} as const;

/** Wind-speed probability layers (all storms): chance of 34-, 50-, 64-kt winds over five days. */
export const WIND_PROB_LAYER: Record<34 | 50 | 64, number> = { 34: 395, 50: 396, 64: 397 };
export const NHC_GIS_URL = NHC_GIS;

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

const emptyGIS = (): StormGIS => ({
  cone: EMPTY(),
  track: EMPTY(),
  points: EMPTY() as StormGIS['points'],
  past: EMPTY(),
  warnings: EMPTY() as StormGIS['warnings'],
  windField: EMPTY() as StormGIS['windField'],
  arrival: EMPTY() as StormGIS['arrival'],
  surge: false,
});

/** Whether a layer has any features (cheap: a count). */
async function hasFeatures(id: number, signal?: AbortSignal): Promise<boolean> {
  const q = new URLSearchParams({ where: '1=1', returnCountOnly: 'true', f: 'json' });
  const r = await fetchJson<{ count?: number }>(`${NHC_GIS}/${id}/query?${q}`, { signal, timeoutMs: 10_000 });
  return (r.count ?? 0) > 0;
}

/** Everything NHC publishes for a slot: forecast cone, track, points, watches/warnings, past track, wind field, arrival times, surge. */
/** Optional parts of a storm's map data; parts left out (switched off) cost no request. */
export interface StormGISParts {
  past: boolean;
  warnings: boolean;
  windField: boolean;
  arrival: boolean;
  surge: boolean;
}

export async function getStormGIS(bin: string, signal?: AbortSignal, want?: Partial<StormGISParts>): Promise<StormGIS> {
  const base = binBase(bin);
  if (base == null) return emptyGIS();
  const empty = emptyGIS();
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const on = (k: keyof StormGISParts) => want?.[k] ?? true;
  const skip = <T>(v: T) => Promise.resolve(v);
  const [points, track, cone, warnings, past, windField, arrival, surge] = await Promise.all([
    safe(layer<ForecastPointProps>(base + SLOT.points, signal), empty.points),
    safe(layer(base + SLOT.track, signal), empty.track),
    safe(layer(base + SLOT.cone, signal), empty.cone),
    on('warnings') ? safe(layer<{ tcww?: string }>(base + SLOT.warnings, signal), empty.warnings) : skip(empty.warnings),
    on('past') ? safe(layer(base + SLOT.past, signal), empty.past) : skip(empty.past),
    on('windField') ? safe(layer<{ radii: number }>(base + SLOT.windField, signal), empty.windField) : skip(empty.windField),
    on('arrival') ? safe(layer<{ arrival_time: string }>(base + SLOT.arrivalMostLikely, signal), empty.arrival) : skip(empty.arrival),
    on('surge') ? safe(hasFeatures(base + SLOT.surgeFootprint, signal), false) : skip(false),
  ]);
  points.features.sort((a, b) => (a.properties?.tau ?? 0) - (b.properties?.tau ?? 0));
  return { cone, track, points, past, warnings, windField, arrival, surge };
}

/** Chance of winds of at least `kt` over the next five days, all storms, as probability bands ("10-20%"). */
export function getWindProbs(kt: 34 | 50 | 64, signal?: AbortSignal): Promise<FeatureCollection<Geometry, { percentage: string }>> {
  return layer<{ percentage: string }>(WIND_PROB_LAYER[kt], signal);
}

/** Map tiles of a storm's potential storm surge flooding (NHC's raster, through the map service's export). */
export function surgeTiles(bin: string): string | null {
  const base = binBase(bin);
  if (base == null) return null;
  const q = 'bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';
  return `${NHC_GIS}/export?${q}&layers=show:${base + SLOT.surgeImage}`;
}

/* ---------- NHC graphics and NOAA satellite, for the storm panel ---------- */

/** NHC's graphics folder for a storm: al092026 → AT09. */
function graphicsDir(id: string): string | null {
  const m = /^(al|ep|cp)(\d\d)(\d{4})$/i.exec(id);
  if (!m) return null;
  return `https://www.nhc.noaa.gov/storm_graphics/${({ al: 'AT', ep: 'EP', cp: 'CP' } as Record<string, string>)[m[1].toLowerCase()]}${m[2]}`;
}

export interface Graphic {
  label: string;
  /** Small version for the strip, and the full one to open. */
  thumb: string;
  full: string;
}

/** NHC's standard graphics for a storm (each loads lazily; a missing one simply hides). */
export function stormGraphics(id: string): Graphic[] {
  const dir = graphicsDir(id);
  if (!dir) return [];
  const ID = id.toUpperCase();
  const png = (name: string, label: string): Graphic => ({ label, thumb: `${dir}/${ID}_${name}_sm2.png`, full: `${dir}/${ID}_${name}.png` });
  const short = `${ID.slice(0, 4)}${ID.slice(6)}`; // AL092026 → AL0926
  return [
    png('key_messages', 'Key messages'),
    png('5day_cone', '5-day cone'),
    png('current_wind', 'Wind field now'),
    png('wind_probs_34_F120', 'Tropical-storm wind odds'),
    png('wind_probs_64_F120', 'Hurricane wind odds'),
    png('most_likely_toa_34', 'Arrival of storm winds'),
    { label: 'Rainfall (WPC)', thumb: `${dir}/${short}WPCQPF.gif`, full: `${dir}/${short}WPCQPF.gif` },
  ];
}

export type SatBand = 'GEOCOLOR' | '13';

/** NOAA STAR's storm-centered GOES imagery: the latest frame, and an animated loop (large). */
export function floater(id: string, band: SatBand): { still: string; loop: string; page: string } {
  const ID = id.toUpperCase();
  const dir = `https://cdn.star.nesdis.noaa.gov/FLOATER/data/${ID}/${band}`;
  return {
    still: `${dir}/500x500.jpg`,
    loop: `${dir}/${ID}-${band}-1000x1000.gif`,
    page: `https://www.star.nesdis.noaa.gov/goes/floater.php?stormid=${ID}`,
  };
}

/** NHC's graphics page for a storm's slot: AT4 → graphics_at4.shtml. */
export const nhcGraphicsPage = (bin: string) => `https://www.nhc.noaa.gov/graphics_${bin.toLowerCase()}.shtml`;

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
        binBase(bin)! + SLOT.points,
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
