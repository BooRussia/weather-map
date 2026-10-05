import type { Map as MlMap } from 'maplibre-gl';
import { GRID_MAX_AGE_MS, GRID_MIN_INTERVAL_MS, GRID_TARGET_POINTS } from '../config';
import { planGrid, WeatherGrid, type Bounds } from '../field/grid';
import { getGridSamples } from './openmeteo';

/** Hard floor between requests, even when the view has left the grid. */
const MIN_GAP_MS = 8_000;
const SETTLE_MS = 600;
const CACHE_SIZE = 6;

/**
 * Keeps one Open-Meteo lattice covering the view. Fetches only when the view
 * leaves the lattice, the zoom changes enough to need finer or coarser data,
 * or the data goes stale — never per particle, never per frame.
 */
export class GridController {
  private grid: WeatherGrid | null = null;
  private cache: WeatherGrid[] = [];
  private lastFetch = 0;
  private inflight: AbortController | null = null;
  private settleTimer = 0;
  private retryTimer = 0;
  private failures = 0;

  constructor(
    private readonly map: MlMap,
    private readonly onGrid: (g: WeatherGrid) => void,
    private readonly onError: (err: unknown) => void,
  ) {
    map.on('moveend', () => this.schedule());
  }

  get current(): WeatherGrid | null {
    return this.grid;
  }

  schedule(delay = SETTLE_MS): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => void this.update(), delay);
  }

  /** Refetch if the current grid is older than `maxAgeMs`. */
  refreshIfOlderThan(maxAgeMs: number): void {
    if (!this.grid || Date.now() - this.grid.fetchedAt > maxAgeMs) void this.update(true);
  }

  private bounds(): Bounds {
    const b = this.map.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  }

  private fits(g: WeatherGrid, b: Bounds, zoom: number, now: number): boolean {
    return g.covers(b) && Math.abs(zoom - g.zoom) < 2 && now - g.fetchedAt < GRID_MAX_AGE_MS;
  }

  async update(force = false): Promise<void> {
    const now = Date.now();
    const b = this.bounds();
    const zoom = this.map.getZoom();
    if (!force && this.grid && this.fits(this.grid, b, zoom, now)) return;

    const cached = this.cache.find((g) => this.fits(g, b, zoom, now));
    if (!force && cached) {
      this.use(cached);
      return;
    }

    const covered = this.grid?.covers(b) ?? false;
    const since = now - this.lastFetch;
    // Only zoom detail or age changed: that can wait for the normal interval.
    const wait = covered && !force ? GRID_MIN_INTERVAL_MS - since : MIN_GAP_MS - since;
    if (wait > 0) {
      this.schedule(wait);
      return;
    }

    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    this.lastFetch = now;
    const el = this.map.getContainer();
    const { spec, points } = planGrid(b, el.clientWidth, el.clientHeight, GRID_TARGET_POINTS);
    try {
      const samples = await getGridSamples(points, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const grid = new WeatherGrid(spec, samples, Date.now(), zoom);
      this.cache = [grid, ...this.cache].slice(0, CACHE_SIZE);
      this.failures = 0;
      this.use(grid);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      this.failures++;
      this.onError(err);
      clearTimeout(this.retryTimer);
      // Back off: 15 s, 30 s, 60 s … capped at 5 min.
      const backoff = Math.min(300_000, 15_000 * 2 ** (this.failures - 1));
      this.retryTimer = window.setTimeout(() => void this.update(true), backoff);
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  private use(g: WeatherGrid): void {
    this.grid = g;
    this.onGrid(g);
  }
}
