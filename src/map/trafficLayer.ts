import type { Map as MlMap, RasterTileSource } from 'maplibre-gl';
import { TOMTOM_KEY, trafficTileUrl } from '../config';

const ID = 'tomtom-traffic';
/** Below this the roads are too small to read and the tiles mostly spend the key's daily allowance. */
const MIN_ZOOM = 5;

/**
 * Live traffic: TomTom's flow tiles, each road colored by its speed against free flow (green moving,
 * orange slow, red jammed), over the radar so you can see how the weather is slowing things down.
 * Under the state and county lines and the labels. Off until switched on, and only with a key.
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
    if (!m.getLayer(ID)) {
      if (!on) return;
      m.addSource(ID, { type: 'raster', tiles, tileSize: 256, minzoom: MIN_ZOOM, maxzoom: 18, attribution: '© TomTom' });
      const before = ['us-county-lines', 'us-state-lines'].find((id) => m.getLayer(id)) ?? m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      m.addLayer({ id: ID, type: 'raster', source: ID, minzoom: MIN_ZOOM, paint: { 'raster-fade-duration': 0 } }, before);
    } else if (light !== this.light) {
      // The light map wants TomTom's light-background colors, the others its dark ones.
      (m.getSource(ID) as RasterTileSource).setTiles(tiles);
    }
    this.light = light;
    m.setLayoutProperty(ID, 'visibility', on ? 'visible' : 'none');
  }
}
