import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { Bounds } from '../field/grid';
import { getAlertAreas } from '../data/warnings';

const SOURCE = 'nws-alert-areas';
const FILL = 'nws-alert-areas-fill';
const LINE = 'nws-alert-areas-line';
const STALE_MS = 5 * 60_000;
const SETTLE_MS = 800;

/**
 * Active NWS alert areas in the accent: warnings outlined with a light fill,
 * watches as a faint fill only (zone shapes would draw every county line).
 */
export class AlertAreas {
  private covered: Bounds | null = null;
  private fetchedAt = 0;
  private zoom = 0;
  private timer = 0;
  private ctrl: AbortController | null = null;
  private visible: boolean;

  constructor(
    private readonly map: MlMap,
    private readonly accent: string,
    visible: boolean,
  ) {
    this.visible = visible;
    map.on('moveend', () => this.schedule());
  }

  /** Add the (empty) layers. Call after `load`, after the imagery layers. */
  install(): void {
    const map = this.map;
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const vis = this.visible ? 'visible' : 'none';
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SOURCE,
        layout: { visibility: vis },
        paint: {
          'fill-color': this.accent,
          'fill-opacity': ['case', ['==', ['get', 'sig'], 'W'], 0.14, 0.07],
        },
      },
      firstSymbol,
    );
    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'sig'], 'W'],
        layout: { visibility: vis, 'line-join': 'round' },
        paint: { 'line-color': this.accent, 'line-width': 1.5 },
      },
      firstSymbol,
    );
    if (this.visible) void this.update(true);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of [FILL, LINE]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
    if (on) void this.update();
  }

  /** Called on the 1-minute refresh tick. */
  refreshIfStale(): void {
    if (this.visible && Date.now() - this.fetchedAt > STALE_MS) void this.update(true);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.update(), SETTLE_MS);
  }

  private async update(force = false): Promise<void> {
    if (!this.visible || !this.map.getSource(SOURCE)) return;
    const b = this.map.getBounds();
    const view = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    const z = this.map.getZoom();
    const inside =
      this.covered &&
      view.west >= this.covered.west &&
      view.east <= this.covered.east &&
      view.south >= this.covered.south &&
      view.north <= this.covered.north &&
      Math.abs(z - this.zoom) < 2;
    if (!force && inside && Date.now() - this.fetchedAt < STALE_MS) return;

    // Fetch a padded area so small pans don't refetch.
    const padX = (view.east - view.west) * 0.3;
    const padY = (view.north - view.south) * 0.3;
    const area = {
      west: view.west - padX,
      east: view.east + padX,
      south: Math.max(-85, view.south - padY),
      north: Math.min(85, view.north + padY),
    };
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const fc = await getAlertAreas(area, z, ctrl.signal);
      if (ctrl.signal.aborted) return;
      (this.map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      this.covered = area;
      this.zoom = z;
      this.fetchedAt = Date.now();
    } catch {
      // Alerts on the map are a bonus; the HUD tag still comes from the point lookup.
    }
  }
}
