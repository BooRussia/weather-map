import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import type { Airspace, AirspaceProps } from '../data/airspace';
import { HAZARD, pirepColor, SIGMET_COLOR, type Advisories, type AirSigmet, type Gairmet, type Pirep, type Tfr } from '../data/aviation';

const FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
const empty = { type: 'FeatureCollection' as const, features: [] };
const hidden = { visibility: 'none' as const };
const halo = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 };

function show(map: MlMap, ids: string[], on: boolean): void {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

/** Every feature of these layers under a point, top first. */
function under(map: MlMap, p: { x: number; y: number }, layers: string[]): GeoJSON.Feature[] {
  return map.queryRenderedFeatures([p.x, p.y], { layers: layers.filter((l) => map.getLayer(l)) }) as unknown as GeoJSON.Feature[];
}

/**
 * Advisories (owner, 2026-10-29: pilot features): SIGMETs and G-AIRMETs valid now, each area in its
 * hazard's color over a faint fill, its short name inside (ICE, TURB, IFR…). Tap for all of them there.
 */
export class AdvisoriesLayer {
  private items: (AirSigmet | Gairmet)[] = [];
  private visible = false;
  private readonly L = { fill: 'adv-fill', line: 'adv-line', label: 'adv-label' };

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource('advisories', { type: 'geojson', data: empty });
    m.addLayer({ id: this.L.fill, type: 'fill', source: 'advisories', layout: hidden, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } });
    m.addLayer({
      id: this.L.line,
      type: 'line',
      source: 'advisories',
      layout: hidden,
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sigmet'], 2.4, 1.5], 'line-opacity': 0.9 },
    });
    m.addLayer({
      id: this.L.label,
      type: 'symbol',
      source: 'advisories',
      minzoom: 4.5,
      layout: { ...hidden, 'text-field': ['get', 'short'], 'text-font': FONT, 'text-size': 11, 'symbol-placement': 'point', 'text-optional': true },
      paint: { ...halo, 'text-color': ['get', 'color'] },
    });
    this.draw();
    this.setVisible(this.visible);
  }

  set(a: Advisories): void {
    this.items = [...a.gairmets, ...a.sigmets];
    this.draw();
  }

  private draw(): void {
    (this.map.getSource('advisories') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.items.map((x, i) => {
        const sigmet = 'raw' in x;
        const h = HAZARD[x.hazard];
        return {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [x.area] },
          properties: {
            i,
            sigmet,
            color: sigmet && x.hazard !== 'CONVECTIVE' ? SIGMET_COLOR : (h?.color ?? SIGMET_COLOR),
            short: sigmet ? (x.hazard === 'CONVECTIVE' ? 'TS SIGMET' : `SIGMET ${x.hazard}`) : (h?.short ?? x.hazard),
          },
        };
      }),
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    show(this.map, Object.values(this.L), on);
  }

  /** Every advisory over a point. */
  hit(p: { x: number; y: number }): (AirSigmet | Gairmet)[] {
    if (!this.visible) return [];
    const seen = new Set<number>();
    return under(this.map, p, [this.L.fill])
      .map((f) => Number(f.properties?.i))
      .filter((i) => !seen.has(i) && seen.add(i))
      .map((i) => this.items[i])
      .filter(Boolean);
  }
}

/** Pilot reports: a dot each, its color the worse of its turbulence and icing; urgent ones ringed red. */
export class PirepsLayer {
  private items: Pirep[] = [];
  private visible = false;
  private readonly L = { dot: 'pirep-dot' };

  constructor(private readonly map: MlMap) {}

  install(): void {
    this.map.addSource('pireps', { type: 'geojson', data: empty });
    this.map.addLayer({
      id: this.L.dot,
      type: 'circle',
      source: 'pireps',
      layout: hidden,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 5.5],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['case', ['get', 'urgent'], '#ff3b30', 'rgba(0, 0, 0, 0.8)'],
        'circle-stroke-width': ['case', ['get', 'urgent'], 2.5, 1.2],
      },
    });
    this.draw();
    this.setVisible(this.visible);
  }

  set(items: Pirep[]): void {
    this.items = items;
    this.draw();
  }

  private draw(): void {
    (this.map.getSource('pireps') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.items.map((x, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
        properties: { i, color: pirepColor(x), urgent: x.urgent },
      })),
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    show(this.map, Object.values(this.L), on);
  }

  hit(p: { x: number; y: number }): Pirep | null {
    if (!this.visible || !this.map.getLayer(this.L.dot)) return null;
    const box: [PointLike, PointLike] = [
      [p.x - 10, p.y - 10],
      [p.x + 10, p.y + 10],
    ];
    const f = this.map.queryRenderedFeatures(box, { layers: [this.L.dot] })[0];
    return f ? (this.items[Number(f.properties?.i)] ?? null) : null;
  }
}

const AIRSPACE_COLOR: ExpressionSpecification = ['match', ['get', 'cls'], 'B', '#0a84ff', 'C', '#e040fb', '#5ac8fa'];

/**
 * TFRs and airspace: temporary flight restrictions in red (always), and from zoom 7 the Class B, C,
 * and D around airports in the sectional chart's colors (B blue, C magenta, D a dashed blue), each
 * shelf labeled ceiling/floor in hundreds of feet ("100/30") from zoom 9.
 */
export class RestrictionsLayer {
  private tfrs: Tfr[] = [];
  private airspace: Airspace = empty as Airspace;
  private visible = false;
  private readonly L = { tfrFill: 'tfr-fill', tfrLine: 'tfr-line', asLine: 'airspace-line', asDash: 'airspace-dash', asLabel: 'airspace-label' };

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource('tfrs', { type: 'geojson', data: empty });
    m.addSource('airspace', { type: 'geojson', data: empty });
    m.addLayer({ id: this.L.asLine, type: 'line', source: 'airspace', minzoom: 7, filter: ['!=', ['get', 'cls'], 'D'], layout: hidden, paint: { 'line-color': AIRSPACE_COLOR, 'line-width': 1.6, 'line-opacity': 0.85 } });
    m.addLayer({
      id: this.L.asDash,
      type: 'line',
      source: 'airspace',
      minzoom: 7,
      filter: ['==', ['get', 'cls'], 'D'],
      layout: hidden,
      paint: { 'line-color': AIRSPACE_COLOR, 'line-width': 1.3, 'line-dasharray': [3, 2], 'line-opacity': 0.85 },
    });
    m.addLayer({
      id: this.L.asLabel,
      type: 'symbol',
      source: 'airspace',
      minzoom: 9,
      layout: { ...hidden, 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 10.5, 'symbol-placement': 'line', 'text-optional': true, 'symbol-spacing': 280 },
      paint: { ...halo, 'text-color': AIRSPACE_COLOR },
    });
    m.addLayer({ id: this.L.tfrFill, type: 'fill', source: 'tfrs', layout: hidden, paint: { 'fill-color': '#ff3b30', 'fill-opacity': 0.14 } });
    m.addLayer({ id: this.L.tfrLine, type: 'line', source: 'tfrs', layout: hidden, paint: { 'line-color': '#ff453a', 'line-width': 1.8 } });
    this.draw();
    this.setVisible(this.visible);
  }

  setTfrs(tfrs: Tfr[]): void {
    this.tfrs = tfrs;
    this.draw();
  }

  setAirspace(a: Airspace): void {
    this.airspace = a;
    (this.map.getSource('airspace') as GeoJSONSource | undefined)?.setData(a);
  }

  private draw(): void {
    (this.map.getSource('tfrs') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.tfrs.map((t, i) => ({ type: 'Feature', geometry: t.geometry, properties: { i } })),
    });
    (this.map.getSource('airspace') as GeoJSONSource | undefined)?.setData(this.airspace);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    show(this.map, Object.values(this.L), on);
  }

  hitTfr(p: { x: number; y: number }): Tfr | null {
    if (!this.visible) return null;
    const f = under(this.map, p, [this.L.tfrFill])[0];
    return f ? (this.tfrs[Number(f.properties?.i)] ?? null) : null;
  }

  /** The airspace shelves under a point (it's drawn as outlines, so this asks the data, not the screen). */
  airspaceAt(lngLat: { lng: number; lat: number }): AirspaceProps[] {
    if (!this.visible || this.map.getZoom() < 7) return [];
    const inside = (ring: number[][]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lngLat.lat !== yj > lngLat.lat && lngLat.lng < ((xj - xi) * (lngLat.lat - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const polys = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
    return this.airspace.features
      .filter((f) => polys(f.geometry).some((rings) => inside(rings[0]) && !rings.slice(1).some(inside)))
      .map((f) => f.properties)
      .sort((a, b) => a.lo - b.lo);
  }
}
