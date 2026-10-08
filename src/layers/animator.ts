import type { Map as MlMap, LngLat } from 'maplibre-gl';
import type { StormCell, WeatherGrid } from '../field/grid';
import { ScreenField, type Projector } from './screenField';
import { WindLayer } from './wind';
import { RainLayer } from './rain';
import { ThunderLayer, type Strike } from './thunder';

export interface LayerFlags {
  wind: boolean;
  rain: boolean;
  thunder: boolean;
}

export interface Palette {
  wind: string;
  rain: string;
  lightning: string;
}

/**
 * Runs the data layers on two canvases above the map: one for wind trails,
 * one for rain + lightning. Particles stay pinned to the map while it moves.
 */
export class Animator {
  private readonly windCtx: CanvasRenderingContext2D;
  private readonly fxCtx: CanvasRenderingContext2D;
  private readonly field = new ScreenField();
  private readonly wind = new WindLayer();
  private readonly rain = new RainLayer();
  private readonly thunder = new ThunderLayer();
  /** Rain, storms, and (if there's no `wind`) wind, from Open-Meteo. */
  private grid: WeatherGrid | null = null;
  /** Wind for the particles, from GeoMet's model. */
  private modelWind: WeatherGrid | null = null;
  /** The bolts follow live flashes rather than forecast cells. */
  private liveLightning = false;
  private fieldDirty = true;
  private refA: LngLat | null = null;
  private refB: LngLat | null = null;
  private w = 0;
  private h = 0;
  private last = 0;
  private raf = 0;
  private windWasOn = false;
  private readonly proj: Projector;

  onStrike: ((s: Strike) => void) | null = null;

  constructor(
    private readonly map: MlMap,
    private readonly windCanvas: HTMLCanvasElement,
    private readonly fxCanvas: HTMLCanvasElement,
    private readonly flags: () => LayerFlags,
    private readonly palette: Palette,
  ) {
    this.windCtx = windCanvas.getContext('2d')!;
    this.fxCtx = fxCanvas.getContext('2d')!;
    this.proj = {
      lonAt: (x) => this.map.unproject([x, this.h / 2]).lng,
      latAt: (y) => this.map.unproject([this.w / 2, y]).lat,
    };
  }

  start(): void {
    this.resize();
    this.map.on('resize', () => this.resize());
    this.map.on('move', () => this.onMove());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.run();
    });
    this.run();
  }

  setGrid(grid: WeatherGrid): void {
    this.grid = grid;
    // Forecast thunderstorm cells place the bolts only when there's no live lightning.
    if (!this.liveLightning) this.thunder.setCells(grid.stormCells(), grid.cellDeg);
    this.fieldDirty = true;
  }

  /** Live flashes (GOES lightning mapper) for the bolts; null goes back to forecast cells. */
  setLightning(cells: StormCell[] | null, cellDeg?: { lon: number; lat: number }): void {
    this.liveLightning = !!cells;
    if (cells && cellDeg) this.thunder.setCells(cells, cellDeg);
    else if (this.grid) this.thunder.setCells(this.grid.stormCells(), this.grid.cellDeg);
    else this.thunder.setCells([], { lon: 0, lat: 0 });
  }

  /** The model wind the particles follow (null: use the Open-Meteo grid's). */
  setWind(grid: WeatherGrid | null): void {
    if (grid === this.modelWind) return;
    this.modelWind = grid;
    this.fieldDirty = true;
  }

  /** Any storm cell inside the current view? */
  stormsInView(): boolean {
    return this.thunder.hasCellsIn(this.visible);
  }

  /** Called when a layer is switched; clears what it drew. */
  layerChanged(layer: keyof LayerFlags, on: boolean): void {
    if (layer === 'wind' && on) this.wind.scatter();
    if (layer === 'rain' && !on) this.rain.reset();
    if (layer === 'thunder' && !on) this.thunder.reset();
  }

  private run(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize(): void {
    const el = this.map.getContainer();
    this.w = el.clientWidth;
    this.h = el.clientHeight;
    // Cap DPR at 2: thin lines stay crisp and phones keep their frame rate.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const [canvas, ctx] of [
      [this.windCanvas, this.windCtx],
      [this.fxCanvas, this.fxCtx],
    ] as const) {
      canvas.width = Math.round(this.w * dpr);
      canvas.height = Math.round(this.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.wind.resize(this.w, this.h);
    this.rain.resize(this.w, this.h);
    this.captureRefs();
    this.fieldDirty = true;
  }

  private captureRefs(): void {
    this.refA = this.map.unproject([0, 0]);
    this.refB = this.map.unproject([this.w, this.h]);
  }

  /** Map moved: shift particles with it (uniform scale + translate; no rotation). */
  private onMove(): void {
    if (this.refA && this.refB && this.w > 0) {
      const a = this.map.project(this.refA);
      const b = this.map.project(this.refB);
      const s = (b.x - a.x) / this.w;
      if (Number.isFinite(s) && s > 0.1 && s < 10 && Math.abs(a.x) < this.w * 4 && Math.abs(a.y) < this.h * 4) {
        this.wind.transform(s, a.x, a.y);
        this.rain.transform(s, a.x, a.y);
      } else {
        this.wind.scatter();
        this.rain.reset();
      }
    }
    this.captureRefs();
    this.fieldDirty = true;
  }

  private readonly visible = (lon: number, lat: number): boolean => {
    const p = this.map.project([lon, lat]);
    return p.x >= 0 && p.y >= 0 && p.x <= this.w && p.y <= this.h;
  };

  private readonly project = (lon: number, lat: number) => this.map.project([lon, lat]);

  private readonly frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    if (this.fieldDirty) {
      this.field.rebuild(this.modelWind, this.grid, this.proj, this.w, this.h);
      this.fieldDirty = false;
    }
    const f = this.flags();

    if (f.wind && this.field.ready) {
      this.wind.step(dt, this.field);
      this.wind.draw(this.windCtx, this.palette.wind);
      this.windWasOn = true;
    } else if (this.windWasOn) {
      this.wind.clear(this.windCtx);
      this.windWasOn = false;
    }

    this.fxCtx.clearRect(0, 0, this.w, this.h);
    if (f.rain && this.field.ready) {
      this.rain.step(dt, this.field);
      this.rain.draw(this.fxCtx, this.palette.rain);
    }
    if (f.thunder) {
      const now = t / 1000;
      const strike = this.thunder.update(now, dt, this.visible);
      if (strike) this.onStrike?.(strike);
      this.thunder.draw(this.fxCtx, now, this.project, this.palette.lightning);
    }
  };
}
