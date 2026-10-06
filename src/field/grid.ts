import type { LatLon } from '../config';
import type { GridSample } from '../data/openmeteo';
import { isThunderCode } from '../data/openmeteo';
import { windToUV } from '../util/geo';

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
 * Lattice spacings in degrees, coarse to fine. Each halves the one before and
 * all are anchored at 0°, so a finer lattice contains every point of a coarser
 * one: zooming in adds detail between the points you had, and panning at the
 * same zoom samples the very same points, instead of a fresh, differently
 * placed set that makes the wind appear to swing.
 */
const STEPS = [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
const LAT_LIMIT = 84;

/** An axis snapped outward to multiples of `step`: its ends and point count. */
function axis(lo: number, hi: number, step: number, limit: number): { from: number; to: number; n: number } {
  const from = Math.max(-limit, Math.floor(lo / step) * step);
  const to = Math.min(limit, Math.ceil(hi / step) * step);
  return { from, to, n: Math.max(2, Math.round((to - from) / step) + 1) };
}

/**
 * The finest anchored lattice over `bounds` (padded on every side) with at
 * most `maxPoints` points. Each axis has its own spacing, coarsened one at a
 * time (whichever has points closer together on screen), so the budget isn't
 * wasted by quartering the count in one jump. Points are row-major, north
 * row first.
 */
export function planGrid(bounds: Bounds, maxPoints: number, pad = 0.15): { spec: GridSpec; points: LatLon[] } {
  const lonPad = (bounds.east - bounds.west) * pad;
  const latPad = (bounds.north - bounds.south) * pad;
  // On a Mercator map a degree of latitude is taller than a degree of longitude is wide.
  const stretch = 1 / Math.cos((((bounds.north + bounds.south) / 2) * Math.PI) / 180);
  let kLon = STEPS.length - 1;
  let kLat = STEPS.length - 1;
  for (;;) {
    const lon = axis(bounds.west - lonPad, bounds.east + lonPad, STEPS[kLon], 180);
    const lat = axis(bounds.south - latPad, bounds.north + latPad, STEPS[kLat], LAT_LIMIT);
    if (lon.n * lat.n <= maxPoints || (kLon === 0 && kLat === 0)) {
      return build({ west: lon.from, east: lon.to, south: lat.from, north: lat.to, cols: lon.n, rows: lat.n });
    }
    if (kLat === 0 || (kLon > 0 && STEPS[kLon] <= STEPS[kLat] * stretch)) kLon--;
    else kLat--;
  }
}

function build(spec: GridSpec): { spec: GridSpec; points: LatLon[] } {
  const { west, east, south, north, cols, rows } = spec;
  const points: LatLon[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = north - ((north - south) * r) / (rows - 1);
    for (let c = 0; c < cols; c++) points.push({ lat, lon: west + ((east - west) * c) / (cols - 1) });
  }
  return { spec, points };
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

  constructor(
    readonly spec: GridSpec,
    samples: GridSample[] | null,
    readonly fetchedAt: number,
    readonly zoom: number,
  ) {
    const n = spec.cols * spec.rows;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.code = new Uint8Array(n);
    if (!samples) return; // filled by blend()
    if (samples.length !== n) throw new Error(`grid expects ${n} samples, got ${samples.length}`);
    samples.forEach((s, i) => {
      const { u, v } = windToUV(s.windMph, s.windFromDeg);
      this.u[i] = u;
      this.v[i] = v;
      this.rain[i] = rainIntensity(s.precipRate, s.precipProbability);
      this.code[i] = s.weatherCode;
    });
  }

  /**
   * Two grids of the same lattice mixed in time: f = 0 is `a`, 1 is `b`.
   * Wind mixes as components, so it turns smoothly instead of jumping.
   */
  static blend(a: WeatherGrid, b: WeatherGrid, f: number): WeatherGrid {
    const g = new WeatherGrid(a.spec, null, a.fetchedAt, a.zoom);
    for (let i = 0; i < g.u.length; i++) {
      g.u[i] = a.u[i] + (b.u[i] - a.u[i]) * f;
      g.v[i] = a.v[i] + (b.v[i] - a.v[i]) * f;
      g.rain[i] = a.rain[i] + (b.rain[i] - a.rain[i]) * f;
      g.code[i] = f < 0.5 ? a.code[i] : b.code[i];
    }
    return g;
  }

  /** Fractional column for a longitude, clamped to the lattice. */
  fx(lon: number): number {
    const { west, east, cols } = this.spec;
    return clamp(((lon - west) / (east - west)) * (cols - 1), 0, cols - 1);
  }

  /** Fractional row for a latitude (rows are evenly spaced in degrees), clamped to the lattice. */
  fy(lat: number): number {
    const { north, south, rows } = this.spec;
    return clamp(((north - lat) / (north - south)) * (rows - 1), 0, rows - 1);
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
    const { cols, rows, west, east, north, south } = this.spec;
    for (let r = 0; r < rows; r++) {
      const lat = north - ((north - south) * r) / (rows - 1);
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
