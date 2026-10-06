import type { Map as MlMap } from 'maplibre-gl';
import type { ColorMode } from '../config';
import { frameSource, STEP_H, tileMirrors, type Timeline } from '../data/timeline';
import { aboveRadar, radarPaint, setImageryVisible } from './imagery';

/**
 * Frame layers kept on the map at once. Each holds its tiles on the GPU
 * (about 4 MB a frame on a phone), so this bounds memory.
 */
const MAX_FRAMES = 16;
const LIVE = 'nws-radar';

/**
 * Radar frames for the timeline. "Now" is the live NWS layer; past frames
 * are IEM's NEXRAD archive; future frames are HRRR simulated radar. Frame
 * layers are created ahead of playback (opacity 0, so their tiles load),
 * crossfaded while playing, and evicted least-recently-used.
 */
export class RadarTimeline {
  /** Tile URL → layer/source id, least- to most-recently used. */
  private frames = new Map<string, string>();
  private seq = 0;
  /** Opacity currently set on each layer we have touched (skip no-op paint updates). */
  private opacity = new Map<string, number>();
  private last: [number, number, number] = [0, 0, 0];
  private liveVisible: boolean | null = null;

  constructor(
    private readonly map: MlMap,
    private timeline: Timeline,
    private mode: ColorMode,
    private radarOn: boolean,
  ) {}

  setTimeline(t: Timeline): void {
    this.timeline = t;
  }

  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    const paint = radarPaint(mode);
    for (const id of this.frames.values()) {
      for (const [k, v] of Object.entries(paint)) {
        if (k !== 'raster-opacity') this.map.setPaintProperty(id, k as 'raster-saturation', v);
      }
    }
    // imagery.setColorMode also reset the live layer's opacity; re-apply the blend.
    this.opacity.clear();
    this.liveVisible = null;
    this.blend(...this.last);
  }

  setRadarOn(on: boolean): void {
    this.radarOn = on;
    this.opacity.clear();
    this.liveVisible = null;
    this.blend(...this.last);
  }

  /** Frame at `offset` has every tile in view loaded (or failed), so it can go on screen without a gap. */
  ready(offset: number): boolean {
    const src = frameSource(this.timeline, offset);
    if (src.kind === 'live') return true;
    const id = this.frames.get(src.url);
    // Ask the map, not the source: a raster source reports loaded() as soon as
    // its URL template is set, before a single tile has arrived.
    return !!id && !!this.map.getLayer(id) && this.map.isSourceLoaded(id) === true;
  }

  /** Create the next `count` frames from `offset` so their tiles start loading. */
  prefetch(offset: number, direction: 1 | -1, count: number): void {
    if (!this.map.getLayer(LIVE)) return;
    for (let k = 0; k < count; k++) {
      const o = offset + k * STEP_H * direction;
      if (o < this.timeline.minOffset || o > this.timeline.maxOffset) break;
      const src = frameSource(this.timeline, o);
      if (src.kind !== 'live') this.ensure(src.url);
    }
    this.evict(offset, direction, count);
  }

  /**
   * Show frame `a` fading into frame `b` (f = 0…1). Where both have rain the
   * combined coverage stays constant, so nothing pulses mid-fade.
   */
  blend(a: number, b: number, f: number): void {
    this.last = [a, b, f];
    if (!this.map.getLayer(LIVE)) return;
    if (!this.radarOn) {
      for (const id of this.opacity.keys()) this.set(id, 0);
      this.setLiveVisible(false);
      return;
    }
    this.setLiveVisible(true);
    const ia = this.layerFor(a);
    const oa = this.opacityFor(ia);
    const want = new Map<string, number>();
    // Only touch frame b mid-fade: on the last frame, b is past the end of the
    // HRRR run and its tiles don't exist.
    const ib = f > 0 && b <= this.timeline.maxOffset ? this.layerFor(b) : ia;
    const ob = this.opacityFor(ib);
    if (ia === ib) {
      want.set(ia, oa);
    } else if (f >= 1) {
      want.set(ib, ob);
    } else {
      // Alpha over alpha: A + B − AB = target, with A fading out linearly.
      const A = oa * (1 - f);
      const target = oa + (ob - oa) * f;
      const B = A >= 1 ? 0 : (target - A) / (1 - A);
      want.set(ia, A);
      want.set(ib, Math.max(0, Math.min(1, B)));
    }
    for (const id of this.opacity.keys()) if (!want.has(id)) this.set(id, 0);
    if (!want.has(LIVE)) this.set(LIVE, 0);
    for (const [id, o] of want) this.set(id, o);
  }

  private setLiveVisible(on: boolean): void {
    if (on === this.liveVisible) return;
    this.liveVisible = on;
    setImageryVisible(this.map, 'radar', on);
  }

  private layerFor(offset: number): string {
    const src = frameSource(this.timeline, offset);
    return src.kind === 'live' ? LIVE : this.ensure(src.url);
  }

  /** Forecast frames draw lighter: HRRR paints trace returns as a wide pale wash. */
  private opacityFor(id: string): number {
    const o = radarPaint(this.mode)['raster-opacity'];
    if (id === LIVE) return o;
    for (const [url, fid] of this.frames) if (fid === id) return url.includes('hrrr::') ? o * 0.75 : o;
    return o;
  }

  private set(id: string, o: number): void {
    const prev = this.opacity.get(id);
    if (prev !== undefined && Math.abs(prev - o) < 0.004) return;
    if (!this.map.getLayer(id)) return;
    this.map.setPaintProperty(id, 'raster-opacity', o);
    if (o === 0 && id !== LIVE) this.opacity.delete(id);
    else this.opacity.set(id, o);
  }

  private ensure(url: string): string {
    const existing = this.frames.get(url);
    if (existing) {
      // Move to most-recently-used.
      this.frames.delete(url);
      this.frames.set(url, existing);
      return existing;
    }
    const id = `radar-frame-${this.seq++}`;
    this.map.addSource(id, { type: 'raster', tiles: tileMirrors(url), tileSize: 256, minzoom: 3, maxzoom: 10 });
    this.map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        // Opacity 0, not hidden: tiles for "visible" layers load, so this preloads.
        paint: { ...radarPaint(this.mode), 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 } },
      },
      aboveRadar(this.map),
    );
    this.frames.set(url, id);
    return id;
  }

  /** Drop the least-recently-used frames, never the ones on screen or just prefetched. */
  private evict(offset: number, direction: 1 | -1, count: number): void {
    if (this.frames.size <= MAX_FRAMES) return;
    const keep = new Set<string>();
    for (let k = -1; k < count; k++) {
      const src = frameSource(this.timeline, offset + k * STEP_H * direction);
      if (src.kind !== 'live') keep.add(src.url);
    }
    for (const [url, id] of this.frames) {
      if (this.frames.size <= MAX_FRAMES) break;
      if (keep.has(url) || this.opacity.has(id)) continue;
      this.frames.delete(url);
      this.opacity.delete(id);
      if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }
}
