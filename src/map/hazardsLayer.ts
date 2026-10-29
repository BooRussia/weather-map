import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { FLOOD_COLOR, type Fires, type Fire, type Gauge } from '../data/hazards';

const FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
const FIRE = '#ff6b2c';
const empty = { type: 'FeatureCollection' as const, features: [] };

/** A box around a tap, for picking small dots with a finger. */
const around = (p: { x: number; y: number }, r: number): [PointLike, PointLike] => [
  [p.x - r, p.y - r],
  [p.x + r, p.y + r],
];

/** Of the dots near a tap, the id of the one nearest it. */
function nearest(map: MlMap, p: { x: number; y: number }, layers: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of map.queryRenderedFeatures(around(p, 12), { layers })) {
    if (f.geometry.type !== 'Point') continue;
    const q = map.project(f.geometry.coordinates as [number, number]);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = f.properties?.id ?? null;
    }
  }
  return best;
}

/** Fires this small (acres) show only once zoomed in to about a state, so the country isn't peppered with them. */
const SMALL_FIRE = 100;

/**
 * Wildfires (owner, 2026-10-29): each burning fire as an orange dot sized by its acres (the small ones
 * from zoom 6), named from zoom 7, and its mapped edge as an orange outline over a light fill. Tap a dot or an edge for the fire.
 */
export class FiresLayer {
  private data: Fires | null = null;
  private fires: Fire[] = [];
  private visible = false;
  private readonly L = { fill: 'fire-fill', edge: 'fire-edge', small: 'fire-dot-small', dot: 'fire-dot', label: 'fire-label' };

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource('fire-perims', { type: 'geojson', data: empty });
    m.addSource('fire-points', { type: 'geojson', data: empty });
    const hidden = { visibility: 'none' as const };
    m.addLayer({ id: this.L.fill, type: 'fill', source: 'fire-perims', layout: hidden, paint: { 'fill-color': FIRE, 'fill-opacity': 0.22 } });
    m.addLayer({ id: this.L.edge, type: 'line', source: 'fire-perims', layout: hidden, paint: { 'line-color': FIRE, 'line-width': 1.6 } });
    const dot = {
      // From a speck for a few acres to a big dot past 100,000.
      'circle-radius': ['interpolate', ['linear'], ['ln', ['max', 1, ['coalesce', ['get', 'acres'], 1]]], 0, 3.5, 4.6, 5, 11.5, 12],
      'circle-color': FIRE,
      'circle-opacity': 0.92,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    } as const;
    const acres: ExpressionSpecification = ['coalesce', ['get', 'acres'], 0];
    m.addLayer({ id: this.L.small, type: 'circle', source: 'fire-points', minzoom: 6, filter: ['<', acres, SMALL_FIRE], layout: hidden, paint: dot as never });
    m.addLayer({ id: this.L.dot, type: 'circle', source: 'fire-points', filter: ['>=', acres, SMALL_FIRE], layout: hidden, paint: dot as never });
    m.addLayer({
      id: this.L.label,
      type: 'symbol',
      source: 'fire-points',
      minzoom: 7,
      layout: {
        ...hidden,
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.9, 0],
        'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 },
    });
    // Switched on, or loaded, before the map was ready.
    if (this.data) this.set(this.data);
    this.setVisible(this.visible);
  }

  set(data: Fires): void {
    this.data = data;
    this.fires = data.fires;
    (this.map.getSource('fire-perims') as GeoJSONSource | undefined)?.setData(data.perimeters);
    (this.map.getSource('fire-points') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: data.fires.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { id: f.id, name: f.name, acres: f.acres } })),
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of Object.values(this.L)) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  /** The fire under a tap: its dot, or inside its mapped edge. */
  hit(point: { x: number; y: number }): Fire | null {
    if (!this.visible || !this.map.getLayer(this.L.dot)) return null;
    const id = nearest(this.map, point, [this.L.dot, this.L.small]);
    if (id) return this.fires.find((f) => f.id === id) ?? null;
    const edge = this.map.queryRenderedFeatures([point.x, point.y], { layers: [this.L.fill] })[0];
    const name = edge?.properties?.name as string | undefined;
    return name ? (this.fires.find((f) => f.name === name) ?? null) : null;
  }
}

/**
 * River gauges (owner, 2026-10-29): each a dot in the NWS flood color, purple for major flooding down to
 * yellow near flood stage; zoomed in, the gauges running normal too, smaller and green. Tap one for it.
 */
export class GaugesLayer {
  private gauges: Gauge[] = [];
  private visible = false;
  private readonly L = { dot: 'gauge-dot', label: 'gauge-label' };

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource('river-gauges', { type: 'geojson', data: empty });
    const color: unknown[] = ['match', ['get', 'status']];
    for (const [k, v] of Object.entries(FLOOD_COLOR)) color.push(k, v);
    color.push(FLOOD_COLOR.other);
    m.addLayer({
      id: this.L.dot,
      type: 'circle',
      source: 'river-gauges',
      layout: { visibility: 'none', 'circle-sort-key': ['get', 'rank'] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'rank'], 0, 3.5, 1, 4.5, 4, 7],
        'circle-color': color as never,
        'circle-stroke-color': 'rgba(0, 0, 0, 0.7)',
        'circle-stroke-width': 1.2,
      },
    });
    m.addLayer({
      id: this.L.label,
      type: 'symbol',
      source: 'river-gauges',
      minzoom: 9,
      filter: ['>=', ['get', 'rank'], 1],
      layout: {
        visibility: 'none',
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 10.5,
        'text-anchor': 'left',
        'text-offset': [0.9, 0],
        'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 },
    });
    // Switched on, or loaded, before the map was ready.
    this.set(this.gauges);
    this.setVisible(this.visible);
  }

  set(gauges: Gauge[]): void {
    this.gauges = gauges;
    const rank = { other: 0, no_flooding: 0, action: 1, minor: 2, moderate: 3, major: 4 } as const;
    (this.map.getSource('river-gauges') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: gauges.map((g) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
        properties: { id: g.id, name: g.name, status: g.status, rank: rank[g.status] },
      })),
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of Object.values(this.L)) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  hit(point: { x: number; y: number }): Gauge | null {
    if (!this.visible || !this.map.getLayer(this.L.dot)) return null;
    const id = nearest(this.map, point, [this.L.dot]);
    return id ? (this.gauges.find((g) => g.id === id) ?? null) : null;
  }
}
