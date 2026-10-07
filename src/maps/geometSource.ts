import type { Bounds } from '../field/grid';
import type { FieldGrid } from '../map/fieldLayer';
import { fetchBuffer, fetchText } from '../util/http';
import type { WeatherMapId } from './catalog';
import type { Area, FieldSource } from './fieldController';
import { readGeoTiff } from './geotiff';

/** Environment and Climate Change Canada's MSC GeoMet: raw model fields (WCS) with open CORS, no key. */
const GEOMET = 'https://geo.weather.gc.ca/geomet';
const HOUR = 3_600_000;
const CAPS_TTL = 15 * 60_000;
/** Fetch a wider area than the view, so panning stays inside it. */
const PAD = 0.3;
/** Cells per frame at most (float32: ~4 bytes each). */
const MAX_CELLS = 64_000;
const LAT_LIMIT = 84;

interface Layer {
  coverage: string;
  /** Native grid spacing, degrees. */
  res: number;
  /** To base units (see catalog.ts). */
  scale?: (v: number) => number;
  /** GeoMet returns 0 where there's no data; ocean layers treat it as land. */
  zeroIsMissing?: boolean;
  /** Accumulations ending this long after the moment shown ("next 24 h"). */
  ahead?: number;
}

const GDPS = 0.15;
const LAYERS: Partial<Record<WeatherMapId, Layer>> = {
  wind: { coverage: 'GDPS_15km_WindSpeed_10m', res: GDPS },
  gust: { coverage: 'GDPS_15km_WindGust_10m', res: GDPS },
  temp: { coverage: 'GDPS_15km_AirTemp_2m', res: GDPS },
  rain: { coverage: 'GDPS_15km_Precip-Accum1h', res: GDPS },
  rainTotal: { coverage: 'GDPS_15km_Precip-Accum24h', res: GDPS, ahead: 24 * HOUR },
  thunder: { coverage: 'GDPS_15km_CAPE', res: GDPS },
  clouds: { coverage: 'GDPS_15km_TotalCloudCover', res: GDPS },
  humidity: { coverage: 'GDPS_15km_RelativeHumidity_2m', res: GDPS },
  dewpoint: { coverage: 'GDPS_15km_DewPoint_2m', res: GDPS },
  pressure: { coverage: 'GDPS_15km_Pressure_MSL', res: GDPS, scale: (pa) => pa / 100 },
  snowDepth: { coverage: 'GDPS_15km_SnowDepth', res: GDPS, scale: (m) => m * 100 },
  // mm of melted snow → cm of snow, at the usual 10:1.
  newSnow: { coverage: 'GDPS_15km_Snow-Accum24h', res: GDPS, ahead: 24 * HOUR },
  waves: { coverage: 'GDWPS_25km_HTSGW_PT1H', res: 0.25, zeroIsMissing: true },
  swell: { coverage: 'GDWPS_25km_SWHFSWEL_PT1H', res: 0.25, zeroIsMissing: true },
  sst: { coverage: 'OCEAN.GIOPS.2D_TM2', res: 0.2, zeroIsMissing: true, scale: (k) => k - 273.15 },
};

/** Maps drawn from GeoMet (for the credit line). */
export const GEOMET_MAPS = new Set(Object.keys(LAYERS) as WeatherMapId[]);

/** "PT1H", "PT3H", "PT12H", "P1D" → ms. */
export function isoDuration(s: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s);
  if (!m) return NaN;
  return ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000;
}

/** A WMS time dimension: comma-separated instants and/or "start/end/period" intervals → epoch ms. */
export function parseTimes(text: string): number[] {
  const out: number[] = [];
  for (const part of text.trim().split(',')) {
    const [a, b, p] = part.trim().split('/');
    if (!b) {
      const t = Date.parse(a);
      if (Number.isFinite(t)) out.push(t);
      continue;
    }
    const start = Date.parse(a);
    const end = Date.parse(b);
    const step = isoDuration(p ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(step > 0)) continue;
    for (let t = start; t <= end && out.length < 5000; t += step) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

interface Caps {
  at: number;
  /** Valid times of the newest run. */
  times: number[];
  /** Model runs kept, oldest first. */
  refs: number[];
}

/** Which run and valid time to ask for, for each moment the map can show. */
export interface Slot {
  /** The moment shown (valid time minus `ahead`). */
  shown: number;
  valid: number;
  ref: number;
}

/**
 * Moments within [from, to] that a layer can show, each tied to a run: the
 * newest run's own valid times, and before it, the older runs' first hours
 * (each run until the next one starts), so the timeline's past has frames.
 */
export function slots(caps: { times: number[]; refs: number[] }, from: number, to: number, ahead = 0): Slot[] {
  const { times, refs } = caps;
  if (!times.length || !refs.length) return [];
  const latest = refs[refs.length - 1];
  const firstLead = times[0] - latest;
  const step = times.length > 1 ? times[1] - times[0] : HOUR;
  const out: Slot[] = [];
  for (let k = 0; k < refs.length - 1; k++) {
    for (let valid = refs[k] + firstLead; valid < refs[k + 1] + firstLead; valid += step) {
      out.push({ shown: valid - ahead, valid, ref: refs[k] });
    }
  }
  for (const valid of times) out.push({ shown: valid - ahead, valid, ref: latest });
  return out.filter((s) => s.shown >= from && s.shown <= to);
}

const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const num = (n: number) => String(+n.toFixed(4));

/**
 * Weather maps from GeoMet's global model (GDPS, 15 km), wave model (GDWPS,
 * 25 km), and ocean model (GIOPS): each frame is one WCS request for the
 * padded view, resampled to about the model's own resolution.
 */
export class GeoMetSource implements FieldSource {
  private readonly caps = new Map<string, Promise<Caps>>();
  /** Moment shown → the request that draws it, per map. */
  private readonly slotsById = new Map<WeatherMapId, Map<number, Slot>>();

  supports(id: WeatherMapId): boolean {
    return id in LAYERS;
  }

  plan(id: WeatherMapId, view: Bounds, zoom: number): Area {
    const res = LAYERS[id]?.res ?? GDPS;
    const lonPad = (view.east - view.west) * PAD;
    const latPad = (view.north - view.south) * PAD;
    // Snap to a coarse step so small pans reuse the same area (and cached frames).
    const snap = res * 8;
    const west = Math.max(-180, Math.floor((view.west - lonPad) / snap) * snap);
    const east = Math.min(180, Math.ceil((view.east + lonPad) / snap) * snap);
    const south = Math.max(-LAT_LIMIT, Math.floor((view.south - latPad) / snap) * snap);
    const north = Math.min(LAT_LIMIT, Math.ceil((view.north + latPad) / snap) * snap);
    let cols = Math.max(16, Math.round((east - west) / res));
    let rows = Math.max(16, Math.round((north - south) / res));
    // Zoomed out, the model has more detail than the screen needs: resample down.
    const k = Math.sqrt(MAX_CELLS / (cols * rows));
    if (k < 1) {
      cols = Math.max(16, Math.floor(cols * k));
      rows = Math.max(16, Math.floor(rows * k));
    }
    return { west, east, south, north, cols, rows, zoom, key: `gm:${west},${south},${east},${north},${cols}x${rows}` };
  }

  private capabilities(coverage: string, signal: AbortSignal): Promise<Caps> {
    const hit = this.caps.get(coverage);
    if (hit) {
      return hit.then((c) => (Date.now() - c.at < CAPS_TTL ? c : this.fetchCaps(coverage, signal)));
    }
    return this.fetchCaps(coverage, signal);
  }

  private fetchCaps(coverage: string, signal: AbortSignal): Promise<Caps> {
    const q = new URLSearchParams({ service: 'WMS', version: '1.3.0', request: 'GetCapabilities', layer: coverage });
    const p = fetchText(`${GEOMET}?${q}`, { signal, timeoutMs: 15_000 }).then((xml) => {
      const dim = (name: string) => new RegExp(`<Dimension name="${name}"[^>]*>([^<]*)</Dimension>`).exec(xml)?.[1] ?? '';
      const caps = { at: Date.now(), times: parseTimes(dim('time')), refs: parseTimes(dim('reference_time')) };
      if (!caps.times.length) throw new Error(`no times for ${coverage}`);
      return caps;
    });
    this.caps.set(coverage, p);
    p.catch(() => this.caps.delete(coverage));
    return p;
  }

  async times(id: WeatherMapId, from: number, to: number, signal: AbortSignal): Promise<number[]> {
    const layer = LAYERS[id];
    if (!layer) throw new Error(`no GeoMet layer for ${id}`);
    const list = slots(await this.capabilities(layer.coverage, signal), from, to, layer.ahead);
    this.slotsById.set(id, new Map(list.map((s) => [s.shown, s])));
    return list.map((s) => s.shown);
  }

  async frame(id: WeatherMapId, area: Area, time: number, signal: AbortSignal): Promise<FieldGrid> {
    const layer = LAYERS[id];
    const slot = this.slotsById.get(id)?.get(time);
    if (!layer || !slot) throw new Error(`no ${id} frame at ${iso(time)}`);
    const q = new URLSearchParams({
      service: 'WCS',
      version: '2.0.1',
      request: 'GetCoverage',
      coverageId: layer.coverage,
      format: 'image/tiff',
      TIME: iso(slot.valid),
      DIM_REFERENCE_TIME: iso(slot.ref),
    });
    // Repeated keys: URLSearchParams can't hold these in one init object.
    q.append('subset', `lat(${num(area.south)},${num(area.north)})`);
    q.append('subset', `long(${num(area.west)},${num(area.east)})`);
    q.append('SCALESIZE', `long(${area.cols}),lat(${area.rows})`);
    const buf = await fetchBuffer(`${GEOMET}?${q}`, { signal, timeoutMs: 25_000 });
    const r = readGeoTiff(buf);
    const values = r.values;
    for (let i = 0; i < values.length; i++) {
      let v = values[i];
      if (layer.zeroIsMissing && v === 0) v = NaN;
      else if (layer.scale) v = layer.scale(v);
      values[i] = v;
    }
    // Raster cells → lattice points at their centers.
    return {
      west: r.west + r.dx / 2,
      east: r.west + (r.cols - 0.5) * r.dx,
      north: r.north - r.dy / 2,
      south: r.north - (r.rows - 0.5) * r.dy,
      cols: r.cols,
      rows: r.rows,
      values,
    };
  }
}

/** Each map from the best source that has it: GeoMet's model grids first, Open-Meteo's points for the rest. */
export class RoutedSource implements FieldSource {
  constructor(private readonly sources: FieldSource[]) {}

  private pick(id: WeatherMapId): FieldSource {
    const s = this.sources.find((x) => x.supports(id));
    if (!s) throw new Error(`no source for ${id}`);
    return s;
  }

  supports(id: WeatherMapId): boolean {
    return this.sources.some((s) => s.supports(id));
  }

  plan(id: WeatherMapId, view: Bounds, zoom: number): Area {
    return this.pick(id).plan(id, view, zoom);
  }

  times(id: WeatherMapId, from: number, to: number, signal: AbortSignal): Promise<number[]> {
    return this.pick(id).times(id, from, to, signal);
  }

  frame(id: WeatherMapId, area: Area, time: number, signal: AbortSignal): Promise<FieldGrid> {
    return this.pick(id).frame(id, area, time, signal);
  }
}
