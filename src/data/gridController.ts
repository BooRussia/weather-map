import type { Map as MlMap } from 'maplibre-gl';
import { GRID_MAX_AGE_MS, GRID_MIN_INTERVAL_MS, GRID_TARGET_POINTS, TIMELINE_PAST_HOURS } from '../config';
import { planGrid, WeatherGrid, type Bounds, type GridSpec } from '../field/grid';
import { getGridSamples, type GridData } from './openmeteo';

/** Hard floor between requests, even when the view has left the grid. */
const MIN_GAP_MS = 8_000;
const SETTLE_MS = 600;
const CACHE_SIZE = 6;

/** One fetched lattice: "now" plus every hour of the timeline, built on demand. */
class GridSet {
  readonly now: WeatherGrid;
  private readonly built = new Map<string, WeatherGrid>();

  constructor(
    private readonly spec: GridSpec,
    private readonly data: GridData,
    readonly fetchedAt: number,
    readonly zoom: number,
  ) {
    this.now = new WeatherGrid(spec, data.current, fetchedAt, zoom);
  }

  /** The grid for a UTC hour key, or "now" when the hour is missing. */
  at(hourKey: string | null): WeatherGrid {
    if (!hourKey) return this.now;
    let g = this.built.get(hourKey);
    if (!g) {
      const i = this.data.hours.indexOf(hourKey);
      if (i < 0) return this.now;
      g = new WeatherGrid(this.spec, this.data.samplesAt[i], this.fetchedAt, this.zoom);
      this.built.set(hourKey, g);
    }
    return g;
  }
}

/**
 * Keeps one Open-Meteo lattice covering the view. Fetches only when the view
 * leaves the lattice, the zoom changes enough to need finer or coarser data,
 * or the data goes stale — never per particle, never per frame. Each fetch
 * carries the timeline's hours too, so scrubbing never fetches.
 */
export class GridController {
  private set: GridSet | null = null;
  private cache: GridSet[] = [];
  /** UTC hour key the timeline is on; null = now. */
  private hourKey: string | null = null;
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

  /** The grid the particles are using (now, or the timeline hour). */
  get current(): WeatherGrid | null {
    return this.set?.at(this.hourKey) ?? null;
  }

  /** Follow the timeline: a UTC hour key, or null for now. */
  setHour(hourKey: string | null): void {
    if (hourKey === this.hourKey) return;
    this.hourKey = hourKey;
    if (this.set) this.onGrid(this.set.at(hourKey));
  }

  schedule(delay = SETTLE_MS): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => void this.update(), delay);
  }

  /** Refetch if the current data is older than `maxAgeMs`. */
  refreshIfOlderThan(maxAgeMs: number): void {
    if (!this.set || Date.now() - this.set.fetchedAt > maxAgeMs) void this.update(true);
  }

  private bounds(): Bounds {
    const b = this.map.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  }

  private fits(s: GridSet, b: Bounds, zoom: number, now: number): boolean {
    return s.now.covers(b) && Math.abs(zoom - s.zoom) < 2 && now - s.fetchedAt < GRID_MAX_AGE_MS;
  }

  async update(force = false): Promise<void> {
    const now = Date.now();
    const b = this.bounds();
    const zoom = this.map.getZoom();
    if (!force && this.set && this.fits(this.set, b, zoom, now)) return;

    const cached = this.cache.find((s) => this.fits(s, b, zoom, now));
    if (!force && cached) {
      this.use(cached);
      return;
    }

    const covered = this.set?.now.covers(b) ?? false;
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
      const data = await getGridSamples(points, TIMELINE_PAST_HOURS + 1, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const set = new GridSet(spec, data, Date.now(), zoom);
      this.cache = [set, ...this.cache].slice(0, CACHE_SIZE);
      this.failures = 0;
      this.use(set);
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

  private use(s: GridSet): void {
    this.set = s;
    this.onGrid(s.at(this.hourKey));
  }
}
