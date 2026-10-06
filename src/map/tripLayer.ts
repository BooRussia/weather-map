import type { FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map as MlMap, PaddingOptions } from 'maplibre-gl';
import type { TripPlan } from '../data/trip';

export interface TripColors {
  /** The route line (the accent). */
  route: string;
  severe: string;
  caution: string;
  /** Stops with nothing to flag. */
  stop: string;
}

const ROUTE = 'trip-route';
const STOPS = 'trip-stops';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The planned drive on the map: the route, and its forecast stops colored by what's there. */
export class TripLayer {
  private installed = false;

  constructor(
    private readonly map: MlMap,
    private colors: TripColors,
  ) {}

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    const m = this.map;
    // Above radar and alert areas, below the basemap labels.
    const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addSource(ROUTE, { type: 'geojson', data: EMPTY });
    m.addSource(STOPS, { type: 'geojson', data: EMPTY });
    m.addLayer(
      {
        id: `${ROUTE}-casing`,
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000000', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 10] },
      },
      firstSymbol,
    );
    m.addLayer(
      {
        id: ROUTE,
        type: 'line',
        source: ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.colors.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 10, 6] },
      },
      firstSymbol,
    );
    m.addLayer(
      {
        id: STOPS,
        type: 'circle',
        source: STOPS,
        paint: {
          'circle-radius': ['case', ['get', 'end'], 6.5, ['==', ['get', 'level'], 'none'], 3.5, 5.5],
          'circle-color': this.stopColor(),
          'circle-stroke-color': ['case', ['get', 'end'], this.colors.route, '#000000'],
          'circle-stroke-width': ['case', ['get', 'end'], 3, 1.5],
        },
      },
      firstSymbol,
    );
  }

  private stopColor() {
    const c = this.colors;
    return ['match', ['get', 'level'], 'severe', c.severe, 'caution', c.caution, c.stop] as unknown as string;
  }

  setColors(colors: TripColors): void {
    this.colors = colors;
    if (!this.installed) return;
    this.map.setPaintProperty(ROUTE, 'line-color', colors.route);
    this.map.setPaintProperty(STOPS, 'circle-color', this.stopColor());
    this.map.setPaintProperty(STOPS, 'circle-stroke-color', ['case', ['get', 'end'], colors.route, '#000000']);
  }

  /** Draw a plan (and frame it inside `padding`), or clear it. */
  set(plan: TripPlan | null, padding?: PaddingOptions): void {
    if (!this.map.isStyleLoaded() && !this.installed) {
      this.map.once('load', () => this.set(plan, padding));
      return;
    }
    this.install();
    const route: FeatureCollection<LineString> = plan
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.route.coords } }] }
      : (EMPTY as FeatureCollection<LineString>);
    const last = (plan?.stops.length ?? 0) - 1;
    const stops: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: (plan?.stops ?? []).map((s, i) => ({
        type: 'Feature',
        properties: { level: s.level ?? 'none', end: i === 0 || i === last },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
    };
    (this.map.getSource(ROUTE) as GeoJSONSource).setData(route);
    (this.map.getSource(STOPS) as GeoJSONSource).setData(stops);
    if (!plan) return;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of plan.route.coords) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
    this.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding, duration: 900, maxZoom: 11 },
    );
  }
}
