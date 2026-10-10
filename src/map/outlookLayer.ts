import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { getOutlookAreas, type OutlookDay, type OutlookKind } from '../data/outlooks';
import type { OutlookHit } from '../ui/areaCard';

const SOURCE = 'outlook-areas';
const FILL = 'outlook-fill';
const LINE = 'outlook-line';
const LABEL = 'outlook-label';
/** Outlooks are reissued a few times a day. */
const STALE_MS = 30 * 60_000;

/**
 * The severe-storm (SPC) or flash-flood (WPC) outlook for a day, in the
 * forecasters' own colors: soft fills under the radar, outlined, the worst
 * risk on top, each area named ("Slight risk") so it reads without a legend.
 */
export class OutlookLayer {
  private visible = false;
  private kind: OutlookKind = 'severe';
  private day: OutlookDay = 1;
  private loadedKey = '';
  private loadedAt = 0;
  private ctrl: AbortController | null = null;

  constructor(private readonly map: MlMap) {}

  /** Add the (empty) layers below the radar. Call after `load`. */
  install(): void {
    const map = this.map;
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('radar') ? 'radar' : map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const vis = this.visible ? 'visible' : 'none';
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SOURCE,
        layout: { visibility: vis, 'fill-sort-key': ['get', 'rank'] },
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.32 },
      },
      before,
    );
    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SOURCE,
        layout: { visibility: vis, 'line-join': 'round', 'line-sort-key': ['get', 'rank'] },
        paint: { 'line-color': ['get', 'stroke'], 'line-width': 1.5, 'line-opacity': 0.9 },
      },
      before,
    );
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SOURCE,
      minzoom: 4,
      layout: {
        visibility: vis,
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
        'symbol-sort-key': ['-', 0, ['get', 'rank']],
        'text-padding': 8,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.75)', 'text-halo-width': 1.4 },
    });
    if (this.visible) void this.load();
  }

  set(visible: boolean, kind: OutlookKind, day: OutlookDay): void {
    this.visible = visible;
    this.kind = kind;
    this.day = day;
    for (const id of [FILL, LINE, LABEL]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    if (visible) void this.load();
  }

  /** The worst risk area under a tap, with which outlook and day it is. */
  hit(point: { x: number; y: number }): OutlookHit | null {
    if (!this.visible || !this.map.getLayer(FILL)) return null;
    const box: [PointLike, PointLike] = [
      [point.x - 2, point.y - 2],
      [point.x + 2, point.y + 2],
    ];
    let best: OutlookHit | null = null;
    for (const f of this.map.queryRenderedFeatures(box, { layers: [FILL] })) {
      const p = f.properties as { name: string; rank: number; fill: string };
      if (!best || p.rank > best.rank) best = { name: p.name, rank: p.rank, fill: p.fill, kind: this.kind, day: this.day };
    }
    return best;
  }

  refreshIfStale(): void {
    if (this.visible && Date.now() - this.loadedAt > STALE_MS) void this.load(true);
  }

  private async load(force = false): Promise<void> {
    const key = `${this.kind}|${this.day}`;
    if (!this.map.getSource(SOURCE) || (!force && key === this.loadedKey && Date.now() - this.loadedAt < STALE_MS)) return;
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const fc = await getOutlookAreas(this.kind, this.day, ctrl.signal);
      if (ctrl.signal.aborted) return;
      (this.map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      this.loadedKey = key;
      this.loadedAt = Date.now();
    } catch {
      // Keep whatever was drawn; the next refresh tries again.
    }
  }
}
