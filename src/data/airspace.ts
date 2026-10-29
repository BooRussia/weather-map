import { fetchJsonSaved } from '../util/http';

/**
 * The FAA's class airspace, Class B, C, and D, each shelf its own floor and ceiling: a daily copy
 * (scripts/airspace.mjs) on the repo's `airspace` branch, since the FAA's own service shares one
 * request quota among all its users and refused under load.
 */
const AIRSPACE_URL = 'https://raw.githubusercontent.com/BooRussia/weather-map/airspace/airspace.json';

export interface AirspaceProps {
  name: string;
  cls: 'B' | 'C' | 'D';
  /** Feet; the floor 0 when it starts at the surface. */
  lo: number;
  hi: number;
  loRef: string;
  hiRef: string;
  /** "100/30": the shelf's ceiling and floor in hundreds of feet, as charts print it ("SFC" for the surface). */
  label: string;
}

export type Airspace = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, AirspaceProps>;

const hundreds = (v: number, code: string) => (code === 'SFC' || v === 0 ? 'SFC' : String(Math.round(v / 100)));

/** All of it (it's a few hundred KB compressed), fetched once a day and kept for offline. */
export async function getAirspace(signal?: AbortSignal): Promise<Airspace> {
  type Raw = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, Omit<AirspaceProps, 'label'>>;
  const r = await fetchJsonSaved<Raw>(`${AIRSPACE_URL}?d=${new Date().toISOString().slice(0, 10)}`, 'airspace', 'airspace', { signal, timeoutMs: 30_000 });
  return {
    type: 'FeatureCollection',
    features: r.features.map((f) => ({ ...f, properties: { ...f.properties, label: `${hundreds(f.properties.hi, f.properties.hiRef)}/${hundreds(f.properties.lo, f.properties.loRef)}` } })),
  };
}
