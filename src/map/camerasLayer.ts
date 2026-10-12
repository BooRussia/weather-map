import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { camerasGeoJSON, type CameraData } from '../data/cameras';

const SRC = 'cams';
const CLUSTERS = 'cams-clusters';
const COUNTS = 'cams-counts';
const ICONS = 'cams-icons';
const PICKED = 'cams-picked';
const ICON = 'cam';
const ICON_LIVE = 'cam-live';
const ICON_ON = 'cam-on';
const FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];

/** The camera glyph (24-unit drawing): a body and a lens. */
const BODY = 'M3.5 7.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z';
const LENS = 'm16.5 10.6 5-2.6v8l-5-2.6z';

/**
 * A camera's mark: a dark disc with a white ring and the camera glyph, drawn at twice the size it shows
 * (24 CSS px). Live video adds a small accent dot at the top right.
 */
function markImage(disc: string, glyph: string, dot: string | null): ImageData {
  const ratio = 2;
  const size = 26;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const g = c.getContext('2d')!;
  g.scale(ratio, ratio);
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = 3 * ratio;
  g.shadowOffsetY = 0.5 * ratio;
  g.beginPath();
  g.arc(size / 2, size / 2, 11, 0, Math.PI * 2);
  g.fillStyle = disc;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  g.stroke();
  g.save();
  g.translate(size / 2 - 7.2, size / 2 - 7.2);
  g.scale(0.6, 0.6);
  g.fillStyle = glyph;
  g.fill(new Path2D(BODY));
  g.fill(new Path2D(LENS));
  g.restore();
  if (dot) {
    g.beginPath();
    g.arc(size - 6, 6, 3.6, 0, Math.PI * 2);
    g.fillStyle = dot;
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = '#ffffff';
    g.stroke();
  }
  return g.getImageData(0, 0, c.width, c.height);
}

export type CameraHit = { cam: number } | { cluster: number; lng: number; lat: number };

/**
 * Traffic cameras on the map: grouped into counted circles when zoomed out (a tap zooms in on the group),
 * each a small camera mark closer in, the open one in the accent.
 */
export class CamerasLayer {
  private installed = false;
  private visible = false;
  private picked: number | null = null;

  constructor(
    private readonly map: MlMap,
    private accent: string,
  ) {}

  /** Add (hidden) under `before` (the tagged places' pins stay on top). */
  install(before?: string): void {
    if (this.installed) return;
    this.installed = true;
    const m = this.map;
    const disc = 'rgba(28, 28, 30, 0.92)';
    m.addImage(ICON, markImage(disc, '#ffffff', null), { pixelRatio: 2 });
    m.addImage(ICON_LIVE, markImage(disc, '#ffffff', this.accent), { pixelRatio: 2 });
    m.addImage(ICON_ON, markImage(this.accent, '#ffffff', null), { pixelRatio: 2 });
    // Cities have hundreds (Tallahassee alone, ~240): they stay grouped until there's room for each.
    m.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 13, clusterRadius: 36 });
    const vis = 'none';
    m.addLayer(
      {
        id: CLUSTERS,
        type: 'circle',
        source: SRC,
        filter: ['has', 'point_count'],
        layout: { visibility: vis },
        paint: {
          'circle-color': 'rgba(28, 28, 30, 0.88)',
          'circle-radius': ['step', ['get', 'point_count'], 13, 25, 16, 250, 19, 2500, 23],
          'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
          'circle-stroke-width': 1.5,
        },
      },
      before,
    );
    if (m.getStyle().glyphs) {
      m.addLayer(
        {
          id: COUNTS,
          type: 'symbol',
          source: SRC,
          filter: ['has', 'point_count'],
          layout: {
            visibility: vis,
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': FONT,
            'text-size': 12,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff' },
        },
        before,
      );
    }
    m.addLayer(
      {
        id: ICONS,
        type: 'symbol',
        source: SRC,
        filter: ['!', ['has', 'point_count']],
        layout: {
          visibility: vis,
          'icon-image': ['case', ['==', ['get', 'live'], 1], ICON_LIVE, ICON],
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.85, 15, 1.1],
        },
      },
      before,
    );
    m.addLayer(
      {
        id: PICKED,
        type: 'symbol',
        source: SRC,
        filter: ['==', ['get', 'i'], -1],
        layout: {
          visibility: vis,
          'icon-image': ICON_ON,
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.25],
        },
      },
      before,
    );
  }

  setData(d: CameraData): void {
    (this.map.getSource(SRC) as GeoJSONSource | undefined)?.setData(camerasGeoJSON(d));
  }

  setVisible(on: boolean): void {
    this.visible = on;
    if (!this.installed) return;
    for (const id of [CLUSTERS, COUNTS, ICONS, PICKED]) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  /** Mark the open camera (null: none). Inside a group, it shows on its own anyway. */
  pick(i: number | null): void {
    this.picked = i;
    if (!this.installed) return;
    this.map.setFilter(PICKED, ['==', ['get', 'i'], i ?? -1]);
  }

  get pickedCamera(): number | null {
    return this.picked;
  }

  /** The theme's accent changed (Liquid / Classic). */
  setAccent(accent: string): void {
    if (accent === this.accent || !this.installed) return;
    this.accent = accent;
    const disc = 'rgba(28, 28, 30, 0.92)';
    this.map.updateImage(ICON_LIVE, markImage(disc, '#ffffff', accent));
    this.map.updateImage(ICON_ON, markImage(accent, '#ffffff', null));
  }

  /** A camera or a group under a screen point (a little forgiving for fingers). */
  hit(point: PointLike & { x: number; y: number }): CameraHit | null {
    if (!this.installed || !this.visible) return null;
    const box: [PointLike, PointLike] = [
      [point.x - 8, point.y - 8],
      [point.x + 8, point.y + 8],
    ];
    const f = this.map.queryRenderedFeatures(box, { layers: [PICKED, ICONS, CLUSTERS].filter((id) => this.map.getLayer(id)) })[0];
    if (!f) return null;
    const p = f.properties as { i?: number; cluster_id?: number };
    if (p.cluster_id != null) {
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      return { cluster: p.cluster_id, lng, lat };
    }
    return p.i != null ? { cam: p.i } : null;
  }

  /** Zoom in until a group comes apart. */
  async openCluster(id: number, lng: number, lat: number): Promise<void> {
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const zoom = await src.getClusterExpansionZoom(id).catch(() => this.map.getZoom() + 2);
    // At least a full step in (cameras at one interchange only part past the grouping's last zoom).
    this.map.easeTo({ center: [lng, lat], zoom: Math.min(Math.max(zoom + 0.25, this.map.getZoom() + 1), 16), duration: 500 });
  }
}
