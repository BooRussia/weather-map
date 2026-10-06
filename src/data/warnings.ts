import type { FeatureCollection, Geometry } from 'geojson';
import type { Bounds } from '../field/grid';
import { fetchJson } from '../util/http';

/** NWS watches/warnings/advisories as polygons (ArcGIS MapServer, layer 1). */
const WWA_QUERY =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query';

/**
 * Marine and surf products: real alerts, but offshore clutter for a land map.
 * Small craft, gale, storm, hurricane-force wind, hazardous seas, freezing spray,
 * marine statements, brisk wind, low water, rip current, high surf.
 */
export const MARINE = ['SC', 'GL', 'SR', 'HF', 'SE', 'UP', 'MH', 'MF', 'MS', 'MA', 'SI', 'SW', 'RB', 'BW', 'LO', 'RP', 'SU'];

export interface AlertAreaProps {
  event: string;
  /** VTEC significance: W = warning, A = watch. */
  sig: 'W' | 'A';
  phenom: string;
}

/** Warnings and watches touching `b`, simplified for zoom. Advisories and marine products are left out. */
export async function getAlertAreas(
  b: Bounds,
  zoom: number,
  signal?: AbortSignal,
): Promise<FeatureCollection<Geometry, AlertAreaProps>> {
  const clampLon = (x: number) => Math.max(-180, Math.min(180, x));
  // Simplify to about one screen pixel at this zoom.
  const degPerPx = 360 / (512 * 2 ** zoom);
  const q = new URLSearchParams({
    where: `sig IN ('W','A') AND phenom NOT IN (${MARINE.map((m) => `'${m}'`).join(',')})`,
    geometry: [clampLon(b.west), b.south, clampLon(b.east), b.north].map((n) => n.toFixed(3)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'event,phenom,sig',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '3',
    maxAllowableOffset: degPerPx.toFixed(5),
    f: 'geojson',
  });
  return fetchJson<FeatureCollection<Geometry, AlertAreaProps>>(`${WWA_QUERY}?${q}`, { signal, timeoutMs: 15_000 });
}
