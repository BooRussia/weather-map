import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { fetchJson } from '../util/http';

/* ---------- wildfires ---------- */

/** NIFC's Wildland Fire Interagency Geospatial Services: current U.S. fires, free, open to browsers. */
const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services';

export interface Fire {
  id: string;
  name: string;
  lat: number;
  lon: number;
  acres: number | null;
  /** Percent contained, when reported. */
  contained: number | null;
  /** When it was found, epoch ms. */
  found: number | null;
  cause: string | null;
  personnel: number | null;
  /** NIFC's last update, epoch ms. */
  updated: number | null;
}

export interface Fires {
  fires: Fire[];
  /** Mapped fire edges, each with its name. */
  perimeters: FeatureCollection<Polygon | MultiPolygon, { name: string }>;
}

interface IncidentResponse {
  features: {
    attributes: {
      UniqueFireIdentifier?: string;
      IncidentName?: string;
      IncidentSize?: number | null;
      PercentContained?: number | null;
      FireDiscoveryDateTime?: number | null;
      FireCause?: string | null;
      TotalIncidentPersonnel?: number | null;
      ModifiedOnDateTime_dt?: number | null;
    };
    geometry?: { x: number; y: number };
  }[];
}

/** "MCKINNEY" or "Mckinney" → "McKinney"-ish title case; NIFC names are typed every which way. */
export function fireName(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/(^|[\s-/(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  return /fire$/i.test(t) ? t : `${t} Fire`;
}

/**
 * Wildfires burning in the U.S. now (owner, 2026-10-29): each fire's spot, size, and containment
 * (prescribed burns and fully contained fires left out), and the mapped perimeters. Two requests.
 */
export async function getFires(signal?: AbortSignal): Promise<Fires> {
  const points = new URLSearchParams({
    // Burning: fully contained fires stay listed for weeks.
    where: "IncidentTypeCategory='WF' AND (PercentContained < 100 OR PercentContained IS NULL)",
    outFields: 'UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,FireCause,TotalIncidentPersonnel,ModifiedOnDateTime_dt',
    outSR: '4326',
    f: 'json',
  });
  const edges = new URLSearchParams({
    where: "attr_IncidentTypeCategory='WF' AND (attr_PercentContained < 100 OR attr_PercentContained IS NULL)",
    outFields: 'poly_IncidentName',
    outSR: '4326',
    // About 200 m: plenty at the zooms a fire's edge is looked at, and a fraction of the size.
    maxAllowableOffset: '0.002',
    geometryPrecision: '4',
    f: 'geojson',
  });
  const [inc, per] = await Promise.all([
    fetchJson<IncidentResponse>(`${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query?${points}`, { signal, timeoutMs: 20_000 }),
    fetchJson<FeatureCollection<Polygon | MultiPolygon, { poly_IncidentName?: string }>>(
      `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?${edges}`,
      { signal, timeoutMs: 20_000 },
    ).catch(() => null),
  ]);
  const fires = inc.features
    .filter((f) => f.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y))
    .map((f, i) => {
      const a = f.attributes;
      return {
        id: a.UniqueFireIdentifier ?? `fire-${i}`,
        name: fireName(a.IncidentName ?? 'Unnamed'),
        lat: f.geometry!.y,
        lon: f.geometry!.x,
        acres: a.IncidentSize ?? null,
        contained: a.PercentContained ?? null,
        found: a.FireDiscoveryDateTime ?? null,
        cause: a.FireCause ?? null,
        personnel: a.TotalIncidentPersonnel ?? null,
        updated: a.ModifiedOnDateTime_dt ?? null,
      };
    });
  return {
    fires,
    perimeters: {
      type: 'FeatureCollection',
      features: (per?.features ?? [])
        .filter((f) => f.geometry)
        .map((f) => ({ ...f, properties: { name: fireName(f.properties?.poly_IncidentName ?? 'Unnamed') } })),
    },
  };
}

/* ---------- river gauges ---------- */

/** NOAA's river gauges with their flood status (the National Water Prediction Service's map service). */
const GAUGES = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query';

export type FloodStatus = 'major' | 'moderate' | 'minor' | 'action' | 'no_flooding' | 'other';

export interface Gauge {
  id: string;
  name: string;
  river: string;
  lat: number;
  lon: number;
  status: FloodStatus;
  /** The river now, in `units` (usually ft), and the stages it floods at. */
  observed: number | null;
  units: string;
  action: number | null;
  flood: number | null;
  moderate: number | null;
  major: number | null;
  observedAt: string | null;
  url: string | null;
}

const RISING: FloodStatus[] = ['major', 'moderate', 'minor', 'action'];

interface GaugeResponse {
  features: {
    attributes: {
      gaugelid: string;
      status: string;
      location: string;
      waterbody: string;
      latitude: number;
      longitude: number;
      observed: string | number | null;
      units: string | null;
      action: string | number | null;
      flood: string | number | null;
      moderate: string | number | null;
      major: string | number | null;
      obstime: string | null;
      url: string | null;
    };
  }[];
}

const stage = (v: string | number | null) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v ?? '');
  return Number.isFinite(n) && n > -900 ? n : null;
};

/**
 * River gauges (owner, 2026-10-29): those at or near flood stage everywhere, or, given an area (zoomed
 * in), every gauge in it, the ones running normal too.
 */
export async function getGauges(area: { west: number; south: number; east: number; north: number } | null, signal?: AbortSignal): Promise<Gauge[]> {
  const q = new URLSearchParams({
    where: area ? '1=1' : `status IN (${RISING.map((s) => `'${s}'`).join(',')})`,
    outFields: 'gaugelid,status,location,waterbody,latitude,longitude,observed,units,action,flood,moderate,major,obstime,url',
    returnGeometry: 'false',
    f: 'json',
  });
  if (area) {
    q.set('geometry', [area.west, area.south, area.east, area.north].map((n) => n.toFixed(3)).join(','));
    q.set('geometryType', 'esriGeometryEnvelope');
    q.set('inSR', '4326');
    q.set('spatialRel', 'esriSpatialRelIntersects');
  }
  const r = await fetchJson<GaugeResponse>(`${GAUGES}?${q}`, { signal, timeoutMs: 20_000 });
  return r.features
    .map(({ attributes: a }) => ({
      id: a.gaugelid,
      // Some gauges name the place, some only the water.
      name: (a.location || a.waterbody || a.gaugelid).trim(),
      river: a.location ? (a.waterbody ?? '').trim() : '',
      lat: a.latitude,
      lon: a.longitude,
      status: (RISING.includes(a.status as FloodStatus) || a.status === 'no_flooding' ? a.status : 'other') as FloodStatus,
      observed: stage(a.observed),
      units: a.units ?? 'ft',
      action: stage(a.action),
      flood: stage(a.flood),
      moderate: stage(a.moderate),
      major: stage(a.major),
      observedAt: a.obstime,
      url: a.url,
    }))
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
}

/** NWS flood category colors (the hydrograph pages' own). */
export const FLOOD_COLOR: Record<FloodStatus, string> = {
  major: '#cc33ff',
  moderate: '#ff3b30',
  minor: '#ff9500',
  action: '#ffd60a',
  no_flooding: '#30d158',
  other: '#8e8e93',
};

export const FLOOD_WORD: Record<FloodStatus, string> = {
  major: 'Major flooding',
  moderate: 'Moderate flooding',
  minor: 'Minor flooding',
  action: 'Near flood stage',
  no_flooding: 'Below flood stage',
  other: 'No flood status',
};
