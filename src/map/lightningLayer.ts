import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { StormCell } from '../field/grid';

const SOURCE = 'lightning-flashes';
const GLOW = 'lightning-glow';
const CORE = 'lightning-core';

/**
 * Where lightning is flashing right now: a small warm-white glow at each
 * flash cluster's center (data/lightning picks one point per cluster), a
 * touch larger and brighter where flashes are dense, with a bright core
 * where they're densest, so you can tell where it struck. The animated bolts (layers/thunder) strike inside these.
 */
export class LightningLayer {
  private visible = false;

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: GLOW,
      type: 'circle',
      source: SOURCE,
      layout: { visibility: 'none' },
      paint: {
        // Small: a point per flash cluster, kept a few kilometers apart.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['+', 1.5, ['*', 0.4, ['get', 'level']]],
          6,
          ['+', 2.5, ['*', 0.8, ['get', 'level']]],
          9,
          ['+', 4, ['*', 1.2, ['get', 'level']]],
          12,
          ['+', 6, ['*', 1.6, ['get', 'level']]],
        ],
        'circle-color': '#fff6c2',
        'circle-blur': 0.5,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'level'], 1, 0.6, 4, 0.9],
      },
    });
    // A bright pinpoint at every flash center.
    m.addLayer({
      id: CORE,
      type: 'circle',
      source: SOURCE,
      minzoom: 4,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.6, 12, 2.4],
        'circle-color': '#ffffff',
        'circle-blur': 0.3,
        'circle-opacity': 0.95,
      },
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of [GLOW, CORE]) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  setFlashes(cells: StormCell[]): void {
    (this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: cells.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { level: c.level } })),
    });
  }

  get shown(): boolean {
    return this.visible;
  }
}
