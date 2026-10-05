import type { Map as MlMap } from 'maplibre-gl';
import { RADAR_TIME_URL, type ColorMode } from '../config';
import { aboveRadar, radarPaint, setImageryVisible } from './imagery';

const FRAMES = 7;
const STEP_MS = 10 * 60_000;
/** The time-enabled service lags real time by a few minutes. */
const LAG_MS = 4 * 60_000;
const TICK_MS = 500;
/** Ticks to hold on the newest frame before looping. */
const HOLD_TICKS = 4;

const id = (i: number) => `nws-radar-loop-${i}`;

export interface LoopFrame {
  index: number;
  count: number;
  time: Date;
}

/**
 * The last hour of radar as 7 frames, 10 minutes apart, stepped like a
 * MyRadar loop. Frames are only requested when playback starts. The live
 * radar layer is hidden while the loop runs and comes back when it stops.
 */
export class RadarLoop {
  private times: number[] = [];
  private index = 0;
  private hold = 0;
  private timer = 0;
  private installed = false;
  /** Opacity of the visible frame; matches the live radar for the color mode. */
  private opacity = 0.3;

  constructor(
    private readonly map: MlMap,
    private readonly onFrame: (f: LoopFrame | null) => void,
  ) {}

  get playing(): boolean {
    return this.timer !== 0;
  }

  play(mode: ColorMode): void {
    if (this.playing) return;
    // Newer frames than an installed set: rebuild so the loop ends near "now".
    const end = Math.floor((Date.now() - LAG_MS) / 60_000) * 60_000;
    if (!this.installed || end - this.times[FRAMES - 1] > STEP_MS / 2) {
      this.remove();
      this.times = Array.from({ length: FRAMES }, (_, i) => end - (FRAMES - 1 - i) * STEP_MS);
      this.install(mode);
      this.index = 0;
    }
    setImageryVisible(this.map, 'radar', false);
    this.show(this.index);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  pause(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Stop, drop the frames, and give the live radar back (if Rain is on). */
  stop(radarOn: boolean): void {
    this.pause();
    this.remove();
    setImageryVisible(this.map, 'radar', radarOn);
    this.onFrame(null);
  }

  setColorMode(mode: ColorMode): void {
    if (!this.installed) return;
    const paint = radarPaint(mode);
    for (let i = 0; i < FRAMES; i++) {
      for (const [k, v] of Object.entries(paint)) {
        if (k === 'raster-opacity') continue;
        this.map.setPaintProperty(id(i), k as 'raster-saturation', v);
      }
    }
    this.opacity = paint['raster-opacity'];
    this.show(this.index);
  }

  private install(mode: ColorMode): void {
    const paint = radarPaint(mode);
    this.opacity = paint['raster-opacity'];
    const before = aboveRadar(this.map);
    this.times.forEach((t, i) => {
      this.map.addSource(id(i), {
        type: 'raster',
        tiles: [`${RADAR_TIME_URL}&time=${t}`],
        tileSize: 256,
        minzoom: 3,
        maxzoom: 10,
      });
      // Every frame stays "visible" at opacity 0 so its tiles preload.
      this.map.addLayer(
        {
          id: id(i),
          type: 'raster',
          source: id(i),
          paint: { ...paint, 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 } },
        },
        before,
      );
    });
    this.installed = true;
  }

  private remove(): void {
    if (!this.installed) return;
    for (let i = 0; i < FRAMES; i++) {
      if (this.map.getLayer(id(i))) this.map.removeLayer(id(i));
      if (this.map.getSource(id(i))) this.map.removeSource(id(i));
    }
    this.installed = false;
  }

  private show(i: number): void {
    if (!this.installed) return;
    for (let k = 0; k < FRAMES; k++) {
      this.map.setPaintProperty(id(k), 'raster-opacity', k === i ? this.opacity : 0);
    }
    this.onFrame({ index: i, count: FRAMES, time: new Date(this.times[i]) });
  }

  private tick(): void {
    if (this.index === FRAMES - 1 && this.hold < HOLD_TICKS) {
      this.hold++;
      return;
    }
    this.hold = 0;
    this.index = (this.index + 1) % FRAMES;
    this.show(this.index);
  }
}
