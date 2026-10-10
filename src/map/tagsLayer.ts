import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import type { Tag } from '../data/tags';

const SRC = 'tags';
const LAYER = 'tag-pins';
const ICON = 'tag-pin';
const ICON_ON = 'tag-pin-on';
/** The pin's outline, in its 24-unit drawing (the same shape as the app's pin icon). */
const PIN_PATH = 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z';

/**
 * One pin: a teardrop with a dot, a soft shadow, drawn at twice the size it
 * shows (30 × 36 CSS px at full size, the tip at the bottom edge).
 */
function pinImage(body: string, ring: string, dot: string): ImageData {
  const ratio = 2;
  const w = 30;
  const hgt = 36;
  const c = document.createElement('canvas');
  c.width = w * ratio;
  c.height = hgt * ratio;
  const g = c.getContext('2d')!;
  const s = 1.6;
  g.scale(ratio, ratio);
  g.translate((w - 13 * s) / 2 - 5.5 * s, hgt - 1.5 - 21 * s);
  g.scale(s, s);
  const path = new Path2D(PIN_PATH);
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = 3 * ratio;
  g.shadowOffsetY = 0.6 * ratio;
  g.fillStyle = body;
  g.fill(path);
  g.shadowColor = 'transparent';
  g.lineWidth = 1.2;
  g.strokeStyle = ring;
  g.stroke(path);
  g.beginPath();
  g.arc(12, 10, 2.5, 0, Math.PI * 2);
  g.fillStyle = dot;
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

/**
 * Tagged places: a white pin for each, named underneath, that grows as you
 * zoom in. The one whose weather is showing turns the accent (it is also the
 * pinned place, so it stands in for the weather card's map pin).
 */
export class TagsLayer {
  private tags: readonly Tag[] = [];
  private selected: string | null = null;

  constructor(
    private readonly map: MlMap,
    private accent: string,
  ) {}

  /** Add on top of everything else (call last, once the style has loaded). */
  install(): void {
    const m = this.map;
    m.addImage(ICON, pinImage('#ffffff', 'rgba(0, 0, 0, 0.55)', '#1c1c1e'), { pixelRatio: 2 });
    m.addImage(ICON_ON, this.onImage(), { pixelRatio: 2 });
    m.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // The fallback style has no glyphs: pins without names then.
    const text = m.getStyle().glyphs
      ? {
          'text-field': ['step', ['zoom'], '', 4.5, ['get', 'name']],
          'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4.5, 11, 9, 12.5, 14, 14],
          'text-anchor': 'top',
          'text-offset': [0, 0.25],
          'text-max-width': 9,
          'text-optional': true,
        }
      : {};
    m.addLayer({
      id: LAYER,
      type: 'symbol',
      source: SRC,
      layout: {
        'icon-image': ['case', ['get', 'selected'], ICON_ON, ICON],
        'icon-anchor': 'bottom',
        // Small over a whole region, full size up close.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.55, 7, 0.78, 11, 1, 15, 1.25],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['case', ['get', 'selected'], 1, 0],
        ...text,
      } as Record<string, unknown>,
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 },
    } as Parameters<MlMap['addLayer']>[0]);
    this.draw();
  }

  set(tags: readonly Tag[], selected: string | null): void {
    if (tags === this.tags && selected === this.selected) return;
    this.tags = tags;
    this.selected = selected;
    this.draw();
  }

  /** The theme changed its accent. */
  setAccent(color: string): void {
    if (color === this.accent) return;
    this.accent = color;
    if (this.map.hasImage(ICON_ON)) this.map.updateImage(ICON_ON, this.onImage());
  }

  /** The tag whose pin (or name) is under a point, if any. */
  hit(point: { x: number; y: number }): Tag | null {
    if (!this.tags.length || !this.map.getLayer(LAYER)) return null;
    const box: [PointLike, PointLike] = [
      [point.x - 6, point.y - 6],
      [point.x + 6, point.y + 6],
    ];
    const f = this.map.queryRenderedFeatures(box, { layers: [LAYER] })[0];
    return f ? (this.tags.find((t) => t.id === f.properties?.id) ?? null) : null;
  }

  private onImage(): ImageData {
    return pinImage(this.accent, '#ffffff', '#ffffff');
  }

  private draw(): void {
    (this.map.getSource(SRC) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.tags.map((t) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        properties: { id: t.id, name: t.name, selected: t.id === this.selected },
      })),
    });
  }
}
