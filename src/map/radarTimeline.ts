import type { Map as MlMap } from 'maplibre-gl';
import type { ColorMode } from '../config';
import { frameSource, type Timeline } from '../data/timeline';
import { aboveRadar, radarPaint, setImageryVisible } from './imagery';

/** Frame layers kept on the map at once (current + prefetch + recent). */
const MAX_FRAMES = 8;
/** Frames loaded ahead of the one on screen while playing or scrubbing. */
const PREFETCH = 2;

/**
 * Radar frames for the timeline. "Now" is the live NWS layer; past hours are
 * IEM's NEXRAD archive; future hours are HRRR simulated radar. Frame layers
 * are created when first needed and evicted least-recently-used, so a phone
 * never holds more than a handful.
 */
export class RadarTimeline {
  /** Tile URL → layer/source id, in least- to most-recently used order. */
  private frames = new Map<string, string>();
  private seq = 0;
  private visibleId: string | null = null;

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
        if (k === 'raster-opacity') continue;
        this.map.setPaintProperty(id, k as 'raster-saturation', v);
      }
      this.map.setPaintProperty(id, 'raster-opacity', id === this.visibleId ? this.opacityFor(this.urlOf(id)) : 0);
    }
  }

  setRadarOn(on: boolean): void {
    this.radarOn = on;
  }

  /** Put the frame for `offset` on screen; `direction` picks which neighbors to preload. */
  /** Forecast frames draw lighter: HRRR paints trace returns as a wide pale wash. */
  private opacityFor(url: string): number {
    const o = radarPaint(this.mode)['raster-opacity'];
    return url.includes('hrrr::') ? o * 0.75 : o;
  }

  show(offset: number, direction: 1 | -1 = 1): void {
    // Imagery layers go in on map load; until then there is nothing to swap.
    if (!this.map.getLayer('nws-radar')) return;
    const src = frameSource(this.timeline, offset);
    if (!this.radarOn) {
      this.setVisible(null);
      setImageryVisible(this.map, 'radar', false);
      return;
    }
    if (src.kind === 'live') {
      this.setVisible(null);
      setImageryVisible(this.map, 'radar', true);
    } else {
      this.setVisible(this.ensure(src.url));
      setImageryVisible(this.map, 'radar', false);
    }
    // Preload the next frames so playback doesn't wait on the network.
    for (let k = 1; k <= PREFETCH; k++) {
      const next = offset + k * direction;
      if (next < this.timeline.minOffset || next > this.timeline.maxOffset) break;
      const n = frameSource(this.timeline, next);
      if (n.kind !== 'live') this.ensure(n.url);
    }
    this.evict();
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
    this.map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, minzoom: 3, maxzoom: 10 });
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

  private setVisible(id: string | null): void {
    if (this.visibleId && this.visibleId !== id && this.map.getLayer(this.visibleId)) {
      this.map.setPaintProperty(this.visibleId, 'raster-opacity', 0);
    }
    if (id) this.map.setPaintProperty(id, 'raster-opacity', this.opacityFor(this.urlOf(id)));
    this.visibleId = id;
  }

  private urlOf(id: string): string {
    for (const [url, fid] of this.frames) if (fid === id) return url;
    return '';
  }

  private evict(): void {
    while (this.frames.size > MAX_FRAMES) {
      const [url, id] = this.frames.entries().next().value as [string, string];
      if (id === this.visibleId) {
        // Never drop the frame on screen; recycle it to the end instead.
        this.frames.delete(url);
        this.frames.set(url, id);
        continue;
      }
      this.frames.delete(url);
      if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }
}
