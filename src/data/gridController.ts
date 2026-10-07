import type { Map as MlMap } from 'maplibre-gl';
import { GRID_MAX_AGE_MS, GRID_MIN_INTERVAL_MS, GRID_TARGET_POINTS, TIMELINE_PAST_HOURS } from '../config';
import { planGrid, WeatherGrid, type Bounds, type GridSpec } from '../field/grid';
import { getGridSamples, type GridData } from './openmeteo';

/** Hard floor between requests, even when the view has left the grid. */
const MIN_GAP_MS = 8_000;
const SETTLE_MS = 600;
const CACHE_SIZE = 6;
const HOUR = 3_600_000;
/** The field is blended to the nearest quarter hour (the timeline's frame step). */
const QUARTER = HOUR / 4;
/** Lattice spacing in degrees (exact: every step is a power of two). */
const lonStep = (s: GridSpec) => (s.east - s.west) / (s.cols - 1);
const latStep = (s: GridSpec) => (s.north - s.south) / (s.rows - 1);

/**
 * One fetched lattice: every hour of the timeline, blended to any moment on
 * demand. Blending in time (rather than snapping to the nearest hour, with a
 * separate "current" grid for now) keeps the wind turning smoothly as the
 * timeline plays, instead of jumping at each hour.
 */
class GridSet {
  private readonly hourMs: number[];
  private readonly hourly = new Map<number, WeatherGrid>();
  private readonly blended = new Map<number, WeatherGrid>();
  /** Current conditions, used only if the hourly series is missing. */
  private readonly fallback: WeatherGrid;

  constructor(
    private readonly spec: GridSpec,
    private readonly data: GridData,
    readonly fetchedAt: number,
    readonly zoom: number,
  ) {
    // Open-Meteo hours are GMT ("2026-10-06T19:00").
    this.hourMs = data.hours.map((h) => Date.parse(`${h}Z`));
    this.fallback = new WeatherGrid(spec, data.current, fetchedAt, zoom);
  }

  covers(b: Bounds): boolean {
    return this.fallback.covers(b);
  }

  get lonStep(): number {
    return lonStep(this.spec);
  }

  get latStep(): number {
    return latStep(this.spec);
  }

  private hour(i: number): WeatherGrid {
    let g = this.hourly.get(i);
    if (!g) {
      g = new WeatherGrid(this.spec, this.data.samplesAt[i], this.fetchedAt, this.zoom);
      this.hourly.set(i, g);
    }
    return g;
  }

  /** The field at a moment (epoch ms), to the quarter hour. */
  at(time: number): WeatherGrid {
    const hours = this.hourMs;
    const n = hours.length;
    if (!n) return this.fallback;
    const q = Math.round(time / QUARTER) * QUARTER;
    let g = this.blended.get(q);
    if (g) return g;
    if (q <= hours[0]) g = this.hour(0);
    else if (q >= hours[n - 1]) g = this.hour(n - 1);
    else {
      let i = 0;
      while (hours[i + 1] <= q) i++;
      const f = (q - hours[i]) / (hours[i + 1] - hours[i]);
      g = f === 0 ? this.hour(i) : WeatherGrid.blend(this.hour(i), this.hour(i + 1), f);
    }
    this.blended.set(q, g);
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
  /** The moment the particles show (epoch ms); null = now, which keeps moving. */
  private time: number | null = null;
  private emitted: WeatherGrid | null = null;
  private lastFetch = 0;
  private inflight: AbortController | null = null;
  private settleTimer = 0;
  private retryTimer = 0;
  private failures = 0;
  private enabled = true;

  constructor(
    private readonly map: MlMap,
    private readonly onGrid: (g: WeatherGrid) => void,
    private readonly onError: (err: unknown) => void,
  ) {
    map.on('moveend', () => this.schedule());
    // "Now" moves on: follow it (the field changes at most every quarter hour).
    window.setInterval(() => {
      if (this.time == null) this.emit();
    }, 60_000);
  }

  /**
   * Fetch only while something needs it: falling rain, lightning, or wind when
   * the model wind (GeoMet) is unavailable. Each lattice point counts against
   * Open-Meteo's fair use, so idle means no requests.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) void this.update();
    else {
      this.inflight?.abort();
      clearTimeout(this.retryTimer);
      clearTimeout(this.settleTimer);
    }
  }

  /** The grid the particles are using. */
  get current(): WeatherGrid | null {
    return this.set?.at(this.time ?? Date.now()) ?? null;
  }

  /** Follow the timeline: a moment (epoch ms), or null for now. */
  setTime(time: number | null): void {
    this.time = time;
    this.emit();
  }

  private emit(): void {
    const g = this.current;
    if (!g || g === this.emitted) return;
    this.emitted = g;
    this.onGrid(g);
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

  /**
   * A lattice can serve this view if it covers it, is at least as fine as the
   * lattice this view would get (a coarser one would show broad flow, then
   * shift when the detail arrived), and is fresh.
   */
  private fits(s: GridSet, b: Bounds, want: GridSpec, now: number): boolean {
    return s.covers(b) && s.lonStep <= lonStep(want) && s.latStep <= latStep(want) && now - s.fetchedAt < GRID_MAX_AGE_MS;
  }

  async update(force = false): Promise<void> {
    if (!this.enabled) return;
    const now = Date.now();
    const b = this.bounds();
    const { spec, points } = planGrid(b, GRID_TARGET_POINTS);
    if (!force && this.set && this.fits(this.set, b, spec, now)) return;

    // The coarsest cached lattice that still fits: the closest match to this view.
    const cached = this.cache
      .filter((s) => this.fits(s, b, spec, now))
      .sort((p, q) => q.lonStep * q.latStep - p.lonStep * p.latStep)[0];
    if (!force && cached) {
      this.use(cached);
      return;
    }

    const since = now - this.lastFetch;
    // Only age changed (the view is covered at enough detail): wait for the normal interval.
    const fresh = this.set && this.set.covers(b) && this.set.lonStep <= lonStep(spec) && this.set.latStep <= latStep(spec);
    const wait = fresh && !force ? GRID_MIN_INTERVAL_MS - since : MIN_GAP_MS - since;
    if (wait > 0) {
      this.schedule(wait);
      return;
    }

    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    this.lastFetch = now;
    const zoom = this.map.getZoom();
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
    this.emit();
  }
}
