import { fetchJson } from '../util/http';

/** The FAA's class airspace (its ArcGIS service, open to browsers): Class B, C, and D, each shelf its own floor and ceiling. */
const AIRSPACE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';

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

export async function getAirspace(area: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<Airspace> {
  const q = new URLSearchParams({
    where: "CLASS IN ('B','C','D')",
    geometry: [area.west, area.south, area.east, area.north].map((n) => n.toFixed(3)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME,CLASS,LOWER_VAL,UPPER_VAL,LOWER_CODE,UPPER_CODE',
    outSR: '4326',
    maxAllowableOffset: '0.001',
    geometryPrecision: '4',
    f: 'geojson',
  });
  type Raw = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { NAME: string; CLASS: 'B' | 'C' | 'D'; LOWER_VAL: number; UPPER_VAL: number; LOWER_CODE: string; UPPER_CODE: string }>;
  const r = await fetchJson<Raw>(`${AIRSPACE}?${q}`, { signal, timeoutMs: 20_000 });
  return {
    type: 'FeatureCollection',
    features: r.features
      .filter((f) => f.geometry)
      .map((f) => {
        const p = f.properties;
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            name: p.NAME,
            cls: p.CLASS,
            lo: p.LOWER_VAL ?? 0,
            hi: p.UPPER_VAL ?? 0,
            loRef: p.LOWER_CODE ?? '',
            hiRef: p.UPPER_CODE ?? '',
            label: `${hundreds(p.UPPER_VAL ?? 0, p.UPPER_CODE)}/${hundreds(p.LOWER_VAL ?? 0, p.LOWER_CODE)}`,
          },
        };
      }),
  };
}
