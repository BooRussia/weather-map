import type { Map as MlMap } from 'maplibre-gl';
import type { Bounds } from '../field/grid';
import type { FieldGrid, FieldLayer } from '../map/fieldLayer';
import type { WeatherMapId } from './catalog';

/** An area to fetch, at a lattice size suited to the zoom. `key` identifies it in caches. */
export interface Area extends Bounds {
  cols: number;
  rows: number;
  zoom: number;
  key: string;
}

/** Where a weather map's data comes from. */
export interface FieldSource {
  supports(id: WeatherMapId): boolean;
  /** The area (and detail) to fetch for a view. */
  plan(id: WeatherMapId, view: Bounds, zoom: number): Area;
  /** Valid times within [from, to], epoch ms, ascending. */
  times(id: WeatherMapId, from: number, to: number, signal: AbortSignal): Promise<number[]>;
  /** The map at one of those times over an area. */
  frame(id: WeatherMapId, area: Area, time: number, signal: AbortSignal): Promise<FieldGrid>;
}

/** The timeline's reach: 24 h back, 16 h ahead, with an hour's margin each side. */
const SPAN_BACK = 25 * 3_600_000;
const SPAN_AHEAD = 17 * 3_600_000;
const SETTLE_MS = 450;
/** Refetch times (new model runs) this often; cached frames expire with them. */
const TIMES_TTL = 15 * 60_000;
const FRAME_TTL = 30 * 60_000;
/** Zoom in this far past the area's zoom before fetching more detail. */
const ZOOM_SLACK = 1.5;
const MAX_FRAMES = 32;
const MAX_INFLIGHT = 3;
/** Frames to load ahead of the moment, for playback. */
const AHEAD = 2;

const inside = (v: Bounds, c: Bounds) => v.west >= c.west && v.east <= c.east && v.south >= c.south && v.north <= c.north;

/** Bilinear value of a grid at a point (NaN outside or where there's no data). */
export function sampleGrid(g: FieldGrid, lon: number, lat: number): number {
  const fx = ((lon - g.west) / (g.east - g.west)) * (g.cols - 1);
  const fy = ((g.north - lat) / (g.north - g.south)) * (g.rows - 1);
  if (!(fx >= 0 && fy >= 0 && fx <= g.cols - 1 && fy <= g.rows - 1)) return NaN;
  const c0 = Math.min(g.cols - 2, Math.floor(fx));
  const r0 = Math.min(g.rows - 2, Math.floor(fy));
  const tx = fx - c0;
  const ty = fy - r0;
  const at = (r: number, c: number) => g.values[r * g.cols + c];
  return at(r0, c0) * (1 - tx) * (1 - ty) + at(r0, c0 + 1) * tx * (1 - ty) + at(r0 + 1, c0) * (1 - tx) * ty + at(r0 + 1, c0 + 1) * tx * ty;
}

interface Entry {
  grid: FieldGrid | null;
  failed: boolean;
  at: number;
}

/**
 * Keeps the chosen weather map covering the view and hands the field layer
 * the two frames around the timeline's moment, with the mix between them, so
 * the colors flow as the timeline plays. Frames load on demand (the moment's
 * pair first, then a couple ahead) and stay cached; until a new pair arrives
 * the last one stays up, so the map never blinks out.
 */
export class FieldController {
  private id: WeatherMapId = 'none';
  private area: Area | null = null;
  private times: number[] = [];
  private timesAt = 0;
  private time: number | null = null;
  private readonly frames = new Map<string, Entry>();
  private readonly queue: { key: string; time: number; area: Area; id: WeatherMapId }[] = [];
  private inflight = 0;
  private ctrl = new AbortController();
  private shown: [FieldGrid | null, FieldGrid | null, number] = [null, null, 0];
  private settle = 0;
  private failures = 0;
  private retry = 0;

  constructor(
    private readonly map: MlMap,
    private readonly layer: FieldLayer,
    private readonly source: FieldSource,
    private readonly onChange: () => void,
    private readonly onError: (err: unknown) => void,
  ) {
    map.on('moveend', () => {
      clearTimeout(this.settle);
      this.settle = window.setTimeout(() => this.replan(), SETTLE_MS);
    });
    // "Now" moves on, and new model runs arrive.
    window.setInterval(() => {
      if (this.id === 'none') return;
      if (Date.now() - this.timesAt > TIMES_TTL) void this.loadTimes();
      else if (this.time == null) this.apply();
    }, 60_000);
  }

  get mapId(): WeatherMapId {
    return this.id;
  }

  setMap(id: WeatherMapId): void {
    if (id === this.id) return;
    this.id = id;
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.queue.length = 0;
    this.frames.clear();
    this.times = [];
    this.area = null;
    this.shown = [null, null, 0];
    this.layer.setFrames(null);
    this.failures = 0;
    if (id !== 'none') {
      this.replan();
      void this.loadTimes();
    }
    this.onChange();
  }

  /** Follow the timeline: a moment (epoch ms), or null for now. */
  setTime(time: number | null): void {
    this.time = time;
    this.apply();
  }

  /** The map's value at a point at the current moment (base units), or null. */
  valueAt(lon: number, lat: number): number | null {
    const [a, b, f] = this.shown;
    if (!a) return null;
    const va = sampleGrid(a, lon, lat);
    const vb = b ? sampleGrid(b, lon, lat) : va;
    const v = Number.isFinite(va) && Number.isFinite(vb) ? va + (vb - va) * f : Number.isFinite(va) ? va : vb;
    return Number.isFinite(v) ? v : null;
  }

  private view(): Bounds {
    const b = this.map.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  }

  /** A new area when the view leaves the current one or wants more detail. */
  private replan(): void {
    if (this.id === 'none') return;
    const view = this.view();
    const zoom = this.map.getZoom();
    const a = this.area;
    if (a && inside(view, a) && zoom - a.zoom < ZOOM_SLACK && a.zoom - zoom < ZOOM_SLACK + 1) return;
    const next = this.source.plan(this.id, view, zoom);
    if (a && next.key === a.key) return;
    this.area = next;
    // Requests for the old area are no longer worth finishing.
    this.queue.length = 0;
    this.apply();
  }

  private async loadTimes(): Promise<void> {
    const id = this.id;
    const now = Date.now();
    try {
      const times = await this.source.times(id, now - SPAN_BACK, now + SPAN_AHEAD, this.ctrl.signal);
      if (id !== this.id) return;
      if (this.timesAt && times[times.length - 1] !== this.times[this.times.length - 1]) this.frames.clear(); // a new run
      this.times = times;
      this.timesAt = Date.now();
      this.failures = 0;
      this.apply();
    } catch (err) {
      if (this.ctrl.signal.aborted || id !== this.id) return;
      this.fail(err, () => void this.loadTimes());
    }
  }

  private fail(err: unknown, again: () => void): void {
    this.failures++;
    this.onError(err);
    clearTimeout(this.retry);
    // Back off: 15 s, 30 s, 60 s … capped at 5 min.
    this.retry = window.setTimeout(again, Math.min(300_000, 15_000 * 2 ** (this.failures - 1)));
  }

  private key(area: Area, time: number): string {
    return `${this.id}|${area.key}|${time}`;
  }

  /** A frame if it's here (and fresh); otherwise queue it. */
  private get(time: number, urgent: boolean): FieldGrid | null {
    const area = this.area;
    if (!area) return null;
    const key = this.key(area, time);
    const e = this.frames.get(key);
    if (e && Date.now() - e.at < FRAME_TTL) {
      // Recently used: move to the back of the eviction order.
      this.frames.delete(key);
      this.frames.set(key, e);
      return e.grid;
    }
    if (!this.queue.some((q) => q.key === key)) {
      const item = { key, time, area, id: this.id };
      if (urgent) this.queue.unshift(item);
      else this.queue.push(item);
    }
    this.pump();
    return null;
  }

  private pump(): void {
    while (this.inflight < MAX_INFLIGHT && this.queue.length) {
      const q = this.queue.shift()!;
      if (q.id !== this.id) continue;
      const placeholder: Entry = { grid: null, failed: false, at: Date.now() };
      this.frames.set(q.key, placeholder);
      this.inflight++;
      const signal = this.ctrl.signal;
      this.source
        .frame(q.id, q.area, q.time, signal)
        .then((grid) => {
          if (signal.aborted) return;
          this.frames.set(q.key, { grid, failed: false, at: Date.now() });
          this.failures = 0;
          this.evict();
          this.apply();
        })
        .catch((err) => {
          if (signal.aborted) return;
          // Forget it so it can be asked for again after the back-off.
          this.frames.delete(q.key);
          this.fail(err, () => this.apply());
        })
        .finally(() => {
          this.inflight--;
          this.pump();
        });
    }
  }

  private evict(): void {
    for (const k of this.frames.keys()) {
      if (this.frames.size <= MAX_FRAMES) break;
      if (this.frames.get(k)?.grid) this.frames.delete(k);
    }
  }

  private apply(): void {
    const times = this.times;
    if (this.id === 'none' || !times.length || !this.area) return;
    const t = this.time ?? Date.now();
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const ta = times[i];
    const tb = times[i + 1];
    const f = tb != null && t > ta ? Math.min(1, (t - ta) / (tb - ta)) : 0;
    const a = this.get(ta, true);
    const b = tb != null && f > 0 ? this.get(tb, true) : null;
    for (let k = 2; k <= AHEAD + 1; k++) if (times[i + k] != null) this.get(times[i + k], false);
    // Show what's here; keep the last frames up until something new arrives.
    if (a && (b || f === 0)) this.shown = [a, b, b ? f : 0];
    else if (a) this.shown = [a, null, 0];
    else if (b) this.shown = [b, null, 0];
    if (this.shown[0]) this.layer.setFrames(...this.shown);
    this.onChange();
  }
}
