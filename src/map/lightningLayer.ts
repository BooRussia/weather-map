import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { StormCell } from '../field/grid';

const SOURCE = 'lightning-flashes';
const GLOW = 'lightning-glow';
const CORE = 'lightning-core';

/**
 * Where lightning is flashing right now: soft warm-white glows that blend
 * into a haze, larger and brighter where flashes are dense, with a bright
 * core where they're densest. The animated bolts (layers/thunder) strike inside these.
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
        // Wider than the bins are apart, so neighbors melt into one glow instead of a dot grid.
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['+', 6, ['*', 2, ['get', 'level']]], 9, ['+', 18, ['*', 5, ['get', 'level']]]],
        'circle-color': '#fff6c2',
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'level'], 1, 0.12, 4, 0.4],
      },
    });
    // A bright core only where flashes are densest (cores everywhere would draw a dot grid).
    m.addLayer({
      id: CORE,
      type: 'circle',
      source: SOURCE,
      minzoom: 5,
      filter: ['>=', ['get', 'level'], 3],
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 2, 'circle-color': '#ffffff', 'circle-blur': 0.6, 'circle-opacity': 0.85 },
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
