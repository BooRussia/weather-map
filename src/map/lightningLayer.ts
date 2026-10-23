import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { StormCell } from '../field/grid';

const SOURCE = 'lightning-flashes';
const GLOW = 'lightning-glow';
const BOLT = 'lightning-bolt';
const BOLT_ICON = 'lightning-bolt-icon';
/** The Lightning button's bolt (ui/icons boltMark), in a 24-unit box. */
const BOLT_PATH = 'M13.2 2.5 5 13.6h6l-1.2 7.9 8.2-11.1h-6z';

/** A yellow bolt with a dark edge and a soft shadow, so it reads on satellite, dark, and radar alike. */
function boltImage(): ImageData {
  const ratio = 2;
  const size = 24;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const g = c.getContext('2d')!;
  g.scale(ratio, ratio);
  g.lineJoin = 'round';
  const bolt = new Path2D(BOLT_PATH);
  g.shadowColor = 'rgba(0, 0, 0, 0.55)';
  g.shadowBlur = 3;
  g.lineWidth = 2.2;
  g.strokeStyle = 'rgba(20, 16, 0, 0.85)';
  g.stroke(bolt);
  g.shadowColor = 'transparent';
  g.fillStyle = '#ffd60a';
  g.fill(bolt);
  return g.getImageData(0, 0, c.width, c.height);
}

/**
 * Where lightning is flashing right now: a small warm-white glow at each
 * flash cluster's center (data/lightning picks one point per cluster), a
 * touch larger and brighter where flashes are dense, with a bright core
 * where they're densest, and a yellow bolt on top marking where it struck (owner, 2026-10-22: the glow
 * alone was hard to place). The animated bolts (layers/thunder) strike inside these.
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
    // A yellow bolt at every flash center: the densest win where they'd overlap.
    if (!m.hasImage(BOLT_ICON)) m.addImage(BOLT_ICON, boltImage(), { pixelRatio: 2 });
    m.addLayer({
      id: BOLT,
      type: 'symbol',
      source: SOURCE,
      layout: {
        visibility: 'none',
        'icon-image': BOLT_ICON,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 6, 0.7, 9, 0.9, 12, 1.1],
        'icon-allow-overlap': false,
        'icon-ignore-placement': true,
        'icon-padding': 1,
        'symbol-sort-key': ['-', 0, ['get', 'level']],
      },
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of [GLOW, BOLT]) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
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
