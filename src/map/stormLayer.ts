import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { cellFeatures, getStormCells, getStormReports, type StormCell, type StormReport } from '../data/stormCells';

const CELLS = 'storm-cells';
const TRACKS = 'storm-tracks';
const REPORTS = 'storm-reports';
const L = {
  track: 'storm-track-line',
  ticks: 'storm-track-ticks',
  cells: 'storm-cell-dots',
  reports: 'storm-report-dots',
  reportText: 'storm-report-letters',
};
const CELLS_EVERY_MS = 2 * 60_000;
const REPORTS_EVERY_MS = 5 * 60_000;

/** Threat colors: tornado signature red, rotation orange, large hail green, other strong storms white. */
export const THREAT_COLOR = { tornado: '#ff0000', rotation: '#ff9f0a', hail: '#30d158', storm: '#ffffff' } as const;
/** SPC's report colors: tornado red, hail green, wind blue; floods sea green. */
export const REPORT_COLOR = { tornado: '#ff0000', hail: '#30d158', wind: '#0a84ff', flood: '#2e8b57', other: '#8e8e93' } as const;
const REPORT_LETTER = { tornado: 'T', hail: 'H', wind: 'W', flood: 'F', other: '•' } as const;

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export type StormHit = { kind: 'cell'; cell: StormCell } | { kind: 'report'; report: StormReport };

/**
 * Strong storm cells from the radars' storm tracking, each with where it's
 * headed over the next hour (ticks every 15 minutes) and colored by its
 * worst threat; optionally the day's storm reports. Only from zoom 5, and
 * only strong or dangerous cells, so the map stays readable.
 */
export class StormLayer {
  private cells: StormCell[] = [];
  private reports: StormReport[] = [];
  private visible = false;
  private showReports = false;
  private cellsAt = 0;
  private reportsAt = 0;

  constructor(private readonly map: MlMap) {}

  install(): void {
    const m = this.map;
    m.addSource(TRACKS, { type: 'geojson', data: empty() });
    m.addSource(CELLS, { type: 'geojson', data: empty() });
    m.addSource(REPORTS, { type: 'geojson', data: empty() });
    const threat = ['match', ['get', 'threat'], 'tornado', THREAT_COLOR.tornado, 'rotation', THREAT_COLOR.rotation, 'hail', THREAT_COLOR.hail, THREAT_COLOR.storm] as never;
    m.addLayer({
      id: L.track,
      type: 'line',
      source: TRACKS,
      minzoom: 5,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': threat, 'line-width': 1.5, 'line-opacity': ['case', ['==', ['get', 'threat'], 'storm'], 0.55, 0.9], 'line-dasharray': [2, 1.5] },
    });
    m.addLayer({
      id: L.ticks,
      type: 'circle',
      source: TRACKS,
      minzoom: 6,
      // Ticks only on dangerous cells' tracks.
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'threat'], 'storm']],
      paint: { 'circle-radius': 2.5, 'circle-color': threat, 'circle-stroke-color': '#000', 'circle-stroke-width': 1 },
    });
    m.addLayer({
      id: L.cells,
      type: 'circle',
      source: CELLS,
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 9, 7],
        'circle-color': threat,
        'circle-stroke-color': '#000',
        'circle-stroke-width': 1.5,
      },
    });
    m.addLayer({
      id: L.reports,
      type: 'circle',
      source: REPORTS,
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 9, 9],
        'circle-color': ['match', ['get', 'kind'], 'tornado', REPORT_COLOR.tornado, 'hail', REPORT_COLOR.hail, 'wind', REPORT_COLOR.wind, 'flood', REPORT_COLOR.flood, REPORT_COLOR.other] as never,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5,
      },
    });
    m.addLayer({
      id: L.reportText,
      type: 'symbol',
      source: REPORTS,
      minzoom: 5,
      layout: {
        'text-field': ['get', 'letter'],
        'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 9, 12],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#fff' },
    });
    this.apply();
  }

  set(visible: boolean, showReports: boolean): void {
    this.visible = visible;
    this.showReports = showReports;
    this.apply();
    void this.refresh();
  }

  /** On the 1-minute tick: storm cells move fast, so they refresh every couple of minutes. */
  async refresh(): Promise<void> {
    if (!this.visible || document.hidden) return;
    const now = Date.now();
    const jobs: Promise<void>[] = [];
    if (now - this.cellsAt > CELLS_EVERY_MS) {
      this.cellsAt = now;
      jobs.push(
        getStormCells()
          .then((c) => {
            this.cells = c;
          })
          .catch(() => {
            this.cellsAt = 0;
          }),
      );
    }
    if (this.showReports && now - this.reportsAt > REPORTS_EVERY_MS) {
      this.reportsAt = now;
      jobs.push(
        getStormReports(24)
          .then((r) => {
            this.reports = r;
          })
          .catch(() => {
            this.reportsAt = 0;
          }),
      );
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    this.draw();
  }

  private apply(): void {
    const set = (id: string, on: boolean) => this.map.getLayer(id) && this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of [L.track, L.ticks, L.cells]) set(id, this.visible);
    for (const id of [L.reports, L.reportText]) set(id, this.visible && this.showReports);
  }

  private draw(): void {
    // Strong cells (50 dBZ and up) or any with hail, rotation, or a tornado signature.
    const shown = this.cells.filter((c) => c.maxDbz >= 50 || c.threat !== 'storm');
    const { points, tracks } = cellFeatures(shown);
    (this.map.getSource(CELLS) as GeoJSONSource | undefined)?.setData(points);
    (this.map.getSource(TRACKS) as GeoJSONSource | undefined)?.setData(tracks);
    (this.map.getSource(REPORTS) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.reports.map((r, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { i, kind: r.kind, letter: REPORT_LETTER[r.kind] },
      })),
    });
  }

  /** The cell or report under a tap, if any (a little slop for fingers). */
  hit(point: { x: number; y: number }): StormHit | null {
    if (!this.visible) return null;
    const box: [PointLike, PointLike] = [
      [point.x - 10, point.y - 10],
      [point.x + 10, point.y + 10],
    ];
    const layers = [L.cells, ...(this.showReports ? [L.reports] : [])].filter((id) => this.map.getLayer(id));
    // Several under a finger: the most dangerous cell wins, then reports.
    const rank: Record<string, number> = { tornado: 0, rotation: 1, hail: 2, storm: 3 };
    const f = this.map
      .queryRenderedFeatures(box, { layers })
      .filter((x) => x.properties)
      .sort((a, b) => (rank[a.properties.threat] ?? 4) - (rank[b.properties.threat] ?? 4))[0];
    if (!f?.properties) return null;
    if (f.layer.id === L.reports) {
      const report = this.reports[Number(f.properties.i)];
      return report ? { kind: 'report', report } : null;
    }
    const cell = this.cells.find((c) => c.key === f.properties.key);
    return cell ? { kind: 'cell', cell } : null;
  }
}
