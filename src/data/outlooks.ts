import type { FeatureCollection, Geometry } from 'geojson';
import { fetchJson } from '../util/http';

const NOAA = 'https://mapservices.weather.noaa.gov';
const SPC = `${NOAA}/vector/rest/services/outlooks/SPC_wx_outlks/MapServer`;
const WPC = `${NOAA}/vector/rest/services/hazards/wpc_precip_hazards/MapServer`;
/** Categorical outlook layers for days 1, 2, 3. */
const SPC_LAYERS = [1, 9, 17];
/** Excessive rainfall outlook layers for days 1, 2, 3. */
const WPC_LAYERS = [0, 1, 2];

export type OutlookKind = 'severe' | 'flood';
export type OutlookDay = 1 | 2 | 3;

/** One risk area, the same for SPC and WPC: its level, name, and colors. */
export interface OutlookProps {
  /** Higher is worse; drawn on top. */
  rank: number;
  /** "Slight risk", "Moderate risk". */
  name: string;
  fill: string;
  stroke: string;
}

/** WPC's four levels, colored like SPC's scale so the two read alike. */
const WPC_LEVELS: Record<string, Omit<OutlookProps, 'name'>> = {
  Marginal: { rank: 2, fill: '#66a366', stroke: '#005500' },
  Slight: { rank: 3, fill: '#f6f67f', stroke: '#dddd00' },
  Moderate: { rank: 5, fill: '#e67f7f', stroke: '#cc0000' },
  High: { rank: 6, fill: '#ff7fff', stroke: '#cc00cc' },
};

const QUERY = new URLSearchParams({
  where: '1=1',
  outFields: '*',
  returnGeometry: 'true',
  outSR: '4326',
  geometryPrecision: '3',
  maxAllowableOffset: '0.02',
  f: 'geojson',
}).toString();

/** SPC's categorical severe-storm outlook or WPC's excessive-rainfall (flash flood) outlook for a day. */
export async function getOutlookAreas(kind: OutlookKind, day: OutlookDay, signal?: AbortSignal): Promise<FeatureCollection<Geometry, OutlookProps>> {
  if (kind === 'severe') {
    type Spc = { label: string; label2: string; dn: number; fill: string; stroke: string };
    const fc = await fetchJson<FeatureCollection<Geometry, Spc>>(`${SPC}/${SPC_LAYERS[day - 1]}/query?${QUERY}`, { signal, timeoutMs: 15_000 });
    return {
      type: 'FeatureCollection',
      features: fc.features
        .filter((f) => f.properties)
        .map((f) => ({
          ...f,
          properties: {
            rank: f.properties.dn,
            // "General Thunderstorms Risk" → "Thunderstorms"; "Slight Risk" → "Slight risk".
            name: f.properties.label === 'TSTM' ? 'Thunderstorms' : f.properties.label2.replace(/ Risk$/i, ' risk'),
            fill: f.properties.fill,
            stroke: f.properties.stroke,
          },
        })),
    };
  }
  type Wpc = { outlook: string };
  const fc = await fetchJson<FeatureCollection<Geometry, Wpc>>(`${WPC}/${WPC_LAYERS[day - 1]}/query?${QUERY}`, { signal, timeoutMs: 15_000 });
  return {
    type: 'FeatureCollection',
    features: fc.features.flatMap((f) => {
      const word = f.properties?.outlook.split(' ')[0] ?? '';
      const level = WPC_LEVELS[word];
      return level ? [{ ...f, properties: { ...level, name: `${word} risk` } }] : [];
    }),
  };
}
