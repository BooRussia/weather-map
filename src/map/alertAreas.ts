import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import type { Bounds } from '../field/grid';
import { alertColorExpression } from '../data/alertColors';
import { getAlertAreas, type AlertAreaProps } from '../data/warnings';

const SOURCE = 'nws-alert-areas';
const FILL = 'nws-alert-areas-fill';
const LINE = 'nws-alert-areas-line';
const STALE_MS = 5 * 60_000;
const SETTLE_MS = 800;

/** One alert (it may cover several zones), for the list. */
export interface AlertItem {
  id: string;
  props: AlertAreaProps;
  /** Bounding box of all its areas. */
  box: Bounds;
}

function extend(box: Bounds, coords: Position | Position[] | Position[][] | Position[][][]): void {
  if (typeof coords[0] === 'number') {
    const [lon, lat] = coords as Position;
    box.west = Math.min(box.west, lon);
    box.east = Math.max(box.east, lon);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
    return;
  }
  for (const c of coords as Position[]) extend(box, c);
}

/** One alert's identity across its zones. */
const alertId = (p: AlertAreaProps) => p.cap_id || p.url || `${p.prod_type}|${p.wfo}|${p.expiration}`;

const SIG_RANK: Record<string, number> = { W: 3, A: 2, Y: 1, S: 0 };

/** Zones of the same alert grouped into one item, with a box around them all. */
export function groupAlerts(features: Feature<Geometry, AlertAreaProps>[]): AlertItem[] {
  const byId = new Map<string, AlertItem>();
  for (const f of features) {
    if (!f.geometry || !f.properties) continue;
    const id = alertId(f.properties);
    let item = byId.get(id);
    if (!item) {
      item = { id, props: f.properties, box: { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity } };
      byId.set(id, item);
    }
    if ('coordinates' in f.geometry) extend(item.box, f.geometry.coordinates as Position[]);
  }
  return [...byId.values()].filter((a) => Number.isFinite(a.box.west));
}

const overlaps = (a: Bounds, b: Bounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

/**
 * Active NWS alert areas in their hazard colors (red tornado warning, orange
 * severe thunderstorm warning…): warnings outlined over a light fill,
 * watches a faint fill only (zone shapes would draw every county line).
 */
export class AlertAreas {
  private covered: Bounds | null = null;
  private fetchedAt = 0;
  private zoom = 0;
  private timer = 0;
  private ctrl: AbortController | null = null;
  private visible: boolean;
  private items: AlertItem[] = [];

  /** New alerts arrived (or the view changed which are in it). */
  onChange: (() => void) | null = null;

  constructor(
    private readonly map: MlMap,
    visible: boolean,
  ) {
    this.visible = visible;
    map.on('moveend', () => {
      this.schedule();
      this.onChange?.();
    });
  }

  /** Add the (empty) layers. Call after `load`, after the imagery layers. */
  install(): void {
    const map = this.map;
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const vis = this.visible ? 'visible' : 'none';
    const color = alertColorExpression() as never;
    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SOURCE,
        layout: { visibility: vis },
        paint: {
          'fill-color': color,
          'fill-opacity': ['case', ['==', ['get', 'sig'], 'W'], 0.16, 0.08],
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
        paint: { 'line-color': color, 'line-width': 1.75 },
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

  /** Alerts touching the current view, warnings first, then by soonest to end. */
  inView(): AlertItem[] {
    const b = this.map.getBounds();
    const view = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    return this.items
      .filter((a) => overlaps(a.box, view))
      .sort((a, b2) => (a.props.sig === b2.props.sig ? 0 : a.props.sig === 'W' ? -1 : 1) || Date.parse(a.props.expiration) - Date.parse(b2.props.expiration));
  }

  /** The alerts whose areas are under a tap: warnings, then watches, then advisories and statements. */
  hit(point: { x: number; y: number }): AlertItem[] {
    if (!this.visible || !this.map.getLayer(FILL)) return [];
    const box: [PointLike, PointLike] = [
      [point.x - 2, point.y - 2],
      [point.x + 2, point.y + 2],
    ];
    const ids = new Set(this.map.queryRenderedFeatures(box, { layers: [FILL] }).map((f) => alertId(f.properties as AlertAreaProps)));
    return this.items
      .filter((a) => ids.has(a.id))
      .sort((a, b) => (SIG_RANK[b.props.sig] ?? 0) - (SIG_RANK[a.props.sig] ?? 0) || Date.parse(a.props.expiration) - Date.parse(b.props.expiration));
  }

  /** Make sure alerts are loaded for the view now (e.g. when the list opens with the layer off). */
  ensure(): Promise<void> {
    return this.update(false, true);
  }

  /** Called on the 1-minute refresh tick. */
  refreshIfStale(): void {
    if (this.visible && Date.now() - this.fetchedAt > STALE_MS) void this.update(true);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.update(), SETTLE_MS);
  }

  private async update(force = false, evenIfHidden = false): Promise<void> {
    if ((!this.visible && !evenIfHidden) || !this.map.getSource(SOURCE)) return;
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
      const fc: FeatureCollection<Geometry, AlertAreaProps> = await getAlertAreas(area, z, ctrl.signal);
      if (ctrl.signal.aborted) return;
      (this.map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      this.items = groupAlerts(fc.features);
      this.covered = area;
      this.zoom = z;
      this.fetchedAt = Date.now();
      this.onChange?.();
    } catch {
      // Alerts on the map are a bonus; the HUD tag still comes from the point lookup.
    }
  }
}
