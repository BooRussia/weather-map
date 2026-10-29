import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { CATEGORY_COLOR, type Metar } from '../data/aviation';

const FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
const L = { dot: 'airport-dot', label: 'airport-label' };

/**
 * Airport weather (owner, 2026-10-29): every reporting station as a dot in its flight category's color
 * (VFR green, MVFR blue, IFR red, LIFR magenta), growing as you zoom in, its identifier beside it from
 * zoom 7. Tap one for its METAR and TAF.
 */
export class AirportsLayer {
  private metars: Metar[] = [];
  private visible = false;

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const color: unknown[] = ['match', ['get', 'cat']];
    for (const [k, v] of Object.entries(CATEGORY_COLOR)) if (k) color.push(k, v);
    color.push(CATEGORY_COLOR['']);
    m.addLayer({
      id: L.dot,
      type: 'circle',
      source: 'airports',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 7, 4.5, 11, 7],
        'circle-color': color as never,
        'circle-stroke-color': 'rgba(0, 0, 0, 0.75)',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 1.2],
      },
    });
    m.addLayer({
      id: L.label,
      type: 'symbol',
      source: 'airports',
      minzoom: 7,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'id'],
        'text-font': FONT,
        'text-size': 10.5,
        'text-anchor': 'left',
        'text-offset': [0.8, 0],
        'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 },
    });
    // Switched on, or loaded, before the map was ready.
    this.set(this.metars);
    this.setVisible(this.visible);
  }

  set(metars: Metar[]): void {
    this.metars = metars;
    (this.map.getSource('airports') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: metars.map((x) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { id: x.id, cat: x.category } })),
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of Object.values(L)) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  /** The station nearest a tap, among the dots near it. */
  hit(p: { x: number; y: number }): Metar | null {
    if (!this.visible || !this.map.getLayer(L.dot)) return null;
    const box: [PointLike, PointLike] = [
      [p.x - 12, p.y - 12],
      [p.x + 12, p.y + 12],
    ];
    let best: string | null = null;
    let bestD = Infinity;
    for (const f of this.map.queryRenderedFeatures(box, { layers: [L.dot] })) {
      if (f.geometry.type !== 'Point') continue;
      const q = this.map.project(f.geometry.coordinates as [number, number]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = f.properties?.id ?? null;
      }
    }
    return best ? (this.metars.find((x) => x.id === best) ?? null) : null;
  }
}
