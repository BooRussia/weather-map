import type { WeatherGrid, FieldSample } from '../field/grid';

/** Screen speed for 1 mph of wind. 10 mph ≈ 50 px/s, independent of zoom. */
export const PX_PER_MPH = 5;

export interface Projector {
  /** Longitude at screen x (the map has no rotation or pitch). */
  lonAt(x: number): number;
  /** Latitude at screen y. */
  latAt(y: number): number;
}

/**
 * The weather grid resampled into screen space on a coarse cell lattice, so
 * particles can look up velocity and rain density with no projection math.
 * Rebuilt whenever the camera moves or a new grid arrives.
 */
export class ScreenField {
  readonly cell = 16;
  cols = 0;
  rows = 0;
  /** px/s */
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  rain = new Float32Array(0);
  ready = false;
  /** Mean rain density across the screen, 0..1. */
  meanRain = 0;

  /** `wind` moves the particles (falling back to `weather`'s wind); `weather` has the rain. */
  rebuild(wind: WeatherGrid | null, weather: WeatherGrid | null, proj: Projector, width: number, height: number): void {
    this.cols = Math.ceil(width / this.cell) + 1;
    this.rows = Math.ceil(height / this.cell) + 1;
    const n = this.cols * this.rows;
    if (this.vx.length !== n) {
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.rain = new Float32Array(n);
    }
    const grid = wind ?? weather;
    if (!grid) {
      this.ready = false;
      return;
    }
    const lons = new Float32Array(this.cols);
    for (let c = 0; c < this.cols; c++) lons[c] = proj.lonAt(c * this.cell);
    const s: FieldSample = { u: 0, v: 0, rain: 0, storm: false };
    const w: FieldSample = { u: 0, v: 0, rain: 0, storm: false };
    let rainSum = 0;
    for (let r = 0; r < this.rows; r++) {
      const lat = proj.latAt(r * this.cell);
      const fy = grid.fy(lat);
      const wy = weather ? weather.fy(lat) : 0;
      for (let c = 0; c < this.cols; c++) {
        grid.sampleAt(grid.fx(lons[c]), fy, s);
        const rain = weather ? (weather === grid ? s.rain : weather.sampleAt(weather.fx(lons[c]), wy, w).rain) : 0;
        const i = r * this.cols + c;
        // Screen y grows downward, so north (v > 0) is negative dy.
        this.vx[i] = s.u * PX_PER_MPH;
        this.vy[i] = -s.v * PX_PER_MPH;
        this.rain[i] = rain;
        rainSum += rain;
      }
    }
    this.meanRain = rainSum / n;
    this.ready = true;
  }

  private index(x: number, y: number): { i: number; tx: number; ty: number } {
    const fx = Math.max(0, Math.min(this.cols - 1.001, x / this.cell));
    const fy = Math.max(0, Math.min(this.rows - 1.001, y / this.cell));
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    return { i: r * this.cols + c, tx: fx - c, ty: fy - r };
  }

  /** Bilinear velocity at a screen point, written into out[0], out[1]. */
  velocity(x: number, y: number, out: Float32Array): void {
    const { i, tx, ty } = this.index(x, y);
    const j = i + this.cols;
    const a = (1 - tx) * (1 - ty);
    const b = tx * (1 - ty);
    const c = (1 - tx) * ty;
    const d = tx * ty;
    out[0] = this.vx[i] * a + this.vx[i + 1] * b + this.vx[j] * c + this.vx[j + 1] * d;
    out[1] = this.vy[i] * a + this.vy[i + 1] * b + this.vy[j] * c + this.vy[j + 1] * d;
  }

  rainAt(x: number, y: number): number {
    const { i, tx, ty } = this.index(x, y);
    const j = i + this.cols;
    return (
      this.rain[i] * (1 - tx) * (1 - ty) +
      this.rain[i + 1] * tx * (1 - ty) +
      this.rain[j] * (1 - tx) * ty +
      this.rain[j + 1] * tx * ty
    );
  }
}
