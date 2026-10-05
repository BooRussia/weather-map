import type { LatLon } from '../config';
import type { GridSample } from '../data/openmeteo';
import { isThunderCode } from '../data/openmeteo';
import { clampLat, latFromMercY, mercY, windToUV } from '../util/geo';

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface GridSpec extends Bounds {
  cols: number;
  rows: number;
}

/**
 * Pick a lattice over `bounds` (padded on every side) with roughly `target`
 * points, shaped to the viewport. Rows are evenly spaced in Mercator y so the
 * lattice looks even on screen. Points are row-major, north row first.
 */
export function planGrid(
  bounds: Bounds,
  widthPx: number,
  heightPx: number,
  target: number,
  pad = 0.2,
): { spec: GridSpec; points: LatLon[] } {
  const aspect = Math.max(0.2, Math.min(5, widthPx / Math.max(1, heightPx)));
  const cols = clampInt(Math.round(Math.sqrt(target * aspect)), 4, 10);
  const rows = clampInt(Math.round(target / cols), 4, 10);

  const lonSpan = bounds.east - bounds.west;
  const yN0 = mercY(bounds.north);
  const yS0 = mercY(bounds.south);
  const ySpan = yN0 - yS0;
  const west = bounds.west - lonSpan * pad;
  const east = bounds.east + lonSpan * pad;
  const north = clampLat(latFromMercY(yN0 + ySpan * pad));
  const south = clampLat(latFromMercY(yS0 - ySpan * pad));

  const yN = mercY(north);
  const yS = mercY(south);
  const points: LatLon[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = latFromMercY(yN - ((yN - yS) * r) / (rows - 1));
    for (let c = 0; c < cols; c++) {
      points.push({ lat, lon: west + ((east - west) * c) / (cols - 1) });
    }
  }
  return { spec: { west, east, south, north, cols, rows }, points };
}

export interface FieldSample {
  /** Wind toward east / north, mph. */
  u: number;
  v: number;
  /** 0..1 rain streak density. */
  rain: number;
  /** Nearest lattice point is a thunderstorm. */
  storm: boolean;
}

/** Streak density from precip rate (mm/h) scaled by probability (%). */
export function rainIntensity(rateMmH: number, probability: number): number {
  if (rateMmH < 0.05) return 0;
  const byRate = Math.min(1, Math.sqrt(rateMmH / 8));
  return byRate * (0.6 + 0.4 * Math.min(1, Math.max(0, probability / 100)));
}

export interface StormCell extends LatLon {
  /** 1 = thunderstorm, 2 = with hail, 3 = severe with hail. */
  level: number;
}

/** A fetched Open-Meteo lattice with bilinear sampling. */
export class WeatherGrid {
  readonly u: Float32Array;
  readonly v: Float32Array;
  readonly rain: Float32Array;
  readonly code: Uint8Array;
  private readonly yN: number;
  private readonly yS: number;

  constructor(
    readonly spec: GridSpec,
    samples: GridSample[],
    readonly fetchedAt: number,
    readonly zoom: number,
  ) {
    const n = spec.cols * spec.rows;
    if (samples.length !== n) throw new Error(`grid expects ${n} samples, got ${samples.length}`);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.code = new Uint8Array(n);
    samples.forEach((s, i) => {
      const { u, v } = windToUV(s.windMph, s.windFromDeg);
      this.u[i] = u;
      this.v[i] = v;
      this.rain[i] = rainIntensity(s.precipRate, s.precipProbability);
      this.code[i] = s.weatherCode;
    });
    this.yN = mercY(spec.north);
    this.yS = mercY(spec.south);
  }

  /** Fractional column for a longitude, clamped to the lattice. */
  fx(lon: number): number {
    const { west, east, cols } = this.spec;
    return clamp(((lon - west) / (east - west)) * (cols - 1), 0, cols - 1);
  }

  /** Fractional row for a latitude, clamped to the lattice. */
  fy(lat: number): number {
    const { rows } = this.spec;
    return clamp(((this.yN - mercY(lat)) / (this.yN - this.yS)) * (rows - 1), 0, rows - 1);
  }

  /** Bilinear sample at fractional lattice coordinates. */
  sampleAt(fx: number, fy: number, out: FieldSample): FieldSample {
    const { cols, rows } = this.spec;
    const c0 = Math.min(cols - 2, Math.floor(fx));
    const r0 = Math.min(rows - 2, Math.floor(fy));
    const tx = fx - c0;
    const ty = fy - r0;
    const i00 = r0 * cols + c0;
    const i10 = i00 + 1;
    const i01 = i00 + cols;
    const i11 = i01 + 1;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    out.u = this.u[i00] * w00 + this.u[i10] * w10 + this.u[i01] * w01 + this.u[i11] * w11;
    out.v = this.v[i00] * w00 + this.v[i10] * w10 + this.v[i01] * w01 + this.v[i11] * w11;
    out.rain = this.rain[i00] * w00 + this.rain[i10] * w10 + this.rain[i01] * w01 + this.rain[i11] * w11;
    out.storm = isThunderCode(this.code[Math.round(fy) * cols + Math.round(fx)]);
    return out;
  }

  sample(lon: number, lat: number, out: FieldSample): FieldSample {
    return this.sampleAt(this.fx(lon), this.fy(lat), out);
  }

  covers(b: Bounds): boolean {
    const s = this.spec;
    return b.west >= s.west && b.east <= s.east && b.south >= s.south && b.north <= s.north;
  }

  /** Lattice spacing in degrees, used to jitter strikes inside a cell. */
  get cellDeg(): { lon: number; lat: number } {
    const s = this.spec;
    return { lon: (s.east - s.west) / (s.cols - 1), lat: (s.north - s.south) / (s.rows - 1) };
  }

  stormCells(): StormCell[] {
    const out: StormCell[] = [];
    const { cols, rows, west, east } = this.spec;
    for (let r = 0; r < rows; r++) {
      const lat = latFromMercY(this.yN - ((this.yN - this.yS) * r) / (rows - 1));
      for (let c = 0; c < cols; c++) {
        const code = this.code[r * cols + c];
        if (!isThunderCode(code)) continue;
        out.push({ lat, lon: west + ((east - west) * c) / (cols - 1), level: code === 95 ? 1 : code === 96 ? 2 : 3 });
      }
    }
    return out;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clampInt = (n: number, lo: number, hi: number) => clamp(Math.round(n), lo, hi);
