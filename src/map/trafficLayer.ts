import type { Map as MlMap, RasterTileSource } from 'maplibre-gl';
import { TOMTOM_KEY, trafficTileUrl, trafficVectorUrl } from '../config';

const ROADS = 'tomtom-traffic';
const ARTERIES = 'tomtom-traffic-arteries';
const CASING = 'tomtom-traffic-arteries-casing';
/**
 * Zoomed out, just the freeways (owner, 2026-10-23: "just the main arteries", to read the country's
 * traffic at a glance); from here in, every road TomTom draws. TomTom tags roads by class, not route
 * number, so spurs and beltways (I-275 beside I-75) are freeways too and stay.
 */
const ALL_ROADS_ZOOM = 7;
const ARTERY_MIN_ZOOM = 3;

/** Speed against free flow → color: moving, slowing, slow, jammed; closed roads dark red. */
const FLOW_COLOR = [
  'case',
  ['has', 'road_closure'],
  '#9b1c16',
  ['step', ['coalesce', ['get', 'traffic_level'], 1], '#ff453a', 0.25, '#ff9f0a', 0.5, '#ffd60a', 0.75, '#30d158'],
];

/**
 * Live traffic from TomTom over the radar, so you can see how the weather is slowing things down:
 * thin freeway lines colored by speed when zoomed out (vector tiles), TomTom's own all-roads tiles
 * from city level in. Under the state and county lines and the labels. Off until switched on, and
 * only with a key.
 */
export class TrafficLayer {
  private light: boolean | null = null;

  constructor(private readonly map: MlMap) {}

  static get available(): boolean {
    return !!TOMTOM_KEY;
  }

  set(on: boolean, light: boolean): void {
    if (!TOMTOM_KEY) return;
    const m = this.map;
    const tiles = [trafficTileUrl(light ? 'relative0' : 'relative0-dark')];
    if (!m.getLayer(ROADS)) {
      if (!on) return;
      const before = ['us-county-lines', 'us-state-lines'].find((id) => m.getLayer(id)) ?? m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      m.addSource(ARTERIES, { type: 'vector', tiles: [trafficVectorUrl()], minzoom: ARTERY_MIN_ZOOM, maxzoom: ALL_ROADS_ZOOM, attribution: '© TomTom' });
      const freeway = ['==', ['get', 'road_type'], 'Motorway'];
      m.addLayer(
        {
          id: CASING,
          type: 'line',
          source: ARTERIES,
          'source-layer': 'Traffic flow',
          minzoom: ARTERY_MIN_ZOOM,
          maxzoom: ALL_ROADS_ZOOM,
          filter: freeway as never,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': 'rgba(0, 0, 0, 0.45)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 7, 4] },
        },
        before,
      );
      m.addLayer(
        {
          id: ARTERIES,
          type: 'line',
          source: ARTERIES,
          'source-layer': 'Traffic flow',
          minzoom: ARTERY_MIN_ZOOM,
          maxzoom: ALL_ROADS_ZOOM,
          filter: freeway as never,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': FLOW_COLOR as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 7, 2.4] },
        },
        before,
      );
      m.addSource(ROADS, { type: 'raster', tiles, tileSize: 256, minzoom: ALL_ROADS_ZOOM, maxzoom: 18, attribution: '© TomTom' });
      m.addLayer({ id: ROADS, type: 'raster', source: ROADS, minzoom: ALL_ROADS_ZOOM, paint: { 'raster-fade-duration': 0 } }, before);
    } else if (light !== this.light) {
      // The light map wants TomTom's light-background colors, the others its dark ones.
      (m.getSource(ROADS) as RasterTileSource).setTiles(tiles);
    }
    this.light = light;
    for (const id of [CASING, ARTERIES, ROADS]) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
