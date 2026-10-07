import { planGrid, type Bounds } from '../field/grid';
import type { FieldGrid } from '../map/fieldLayer';
import { fetchJson } from '../util/http';
import { wrapLon } from '../util/geo';
import type { WeatherMapId } from './catalog';
import type { Area, FieldSource } from './fieldController';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const HOUR = 3_600_000;
/** Hours of history and of forecast, matching the timeline (−24 h … +16 h). */
const PAST_HOURS = 25;
const AHEAD_HOURS = 17;
/** Lattice points per request: each point counts against Open-Meteo's fair use. */
const POINTS = 180;
/** Fetch a wider area than the view, so panning stays inside it. */
const PAD = 0.35;
const BATCH_TTL = 20 * 60_000;

interface Spec {
  url: string;
  variable: string;
  /** To base units (see catalog.ts). */
  scale?: (v: number) => number;
  extra?: Record<string, string>;
}

/** Only what GeoMet lacks: Open-Meteo's points are coarser than a model grid. */
const SPECS: Partial<Record<WeatherMapId, Spec>> = {
  feels: { url: FORECAST, variable: 'apparent_temperature' },
  lowClouds: { url: FORECAST, variable: 'cloud_cover_low' },
  visibility: { url: FORECAST, variable: 'visibility' },
  // km/h → m/s.
  currents: { url: MARINE, variable: 'ocean_current_velocity', scale: (k) => k / 3.6 },
  aqi: { url: AIR, variable: 'us_aqi' },
};

interface Item {
  hourly?: { time: string[] } & Record<string, (number | null)[] | string[]>;
}

interface Batch {
  at: number;
  times: number[];
  grids: FieldGrid[];
}

/** Short coordinates keep the URL small (lattice points are multiples of a power of two). */
const coord = (n: number) => String(+n.toFixed(4));

/**
 * Weather maps from Open-Meteo's point API on a lattice over the view, for
 * the variables no gridded source offers (feels like, low clouds, fog,
 * currents, air quality). One request brings every hour of the timeline.
 */
export class OpenMeteoSource implements FieldSource {
  private readonly batches = new Map<string, Promise<Batch>>();

  supports(id: WeatherMapId): boolean {
    return id in SPECS;
  }

  plan(_id: WeatherMapId, view: Bounds, zoom: number): Area {
    const { spec } = planGrid(view, POINTS, PAD);
    return { ...spec, zoom, key: `om:${spec.west},${spec.south},${spec.east},${spec.north},${spec.cols}x${spec.rows}` };
  }

  async times(_id: WeatherMapId, from: number, to: number): Promise<number[]> {
    const out: number[] = [];
    for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) out.push(t);
    return out;
  }

  async frame(id: WeatherMapId, area: Area, time: number, signal: AbortSignal): Promise<FieldGrid> {
    const key = `${id}|${area.key}`;
    let p = this.batches.get(key);
    if (p) {
      const b = await p.catch(() => null);
      if (!b || Date.now() - b.at > BATCH_TTL) p = undefined;
    }
    if (!p) {
      p = this.fetchBatch(id, area, signal);
      this.batches.set(key, p);
      p.catch(() => this.batches.delete(key));
      // Keep a few areas.
      while (this.batches.size > 4) this.batches.delete(this.batches.keys().next().value!);
    }
    const b = await p;
    let i = b.times.indexOf(time);
    if (i < 0) i = b.times.reduce((best, t, k) => (Math.abs(t - time) < Math.abs(b.times[best] - time) ? k : best), 0);
    if (!b.grids[i]) throw new Error('no data for that hour');
    return b.grids[i];
  }

  private async fetchBatch(id: WeatherMapId, area: Area, signal: AbortSignal): Promise<Batch> {
    const spec = SPECS[id];
    if (!spec) throw new Error(`no Open-Meteo source for ${id}`);
    const lats: string[] = [];
    const lons: string[] = [];
    for (let r = 0; r < area.rows; r++) {
      const lat = area.north - ((area.north - area.south) * r) / (area.rows - 1);
      for (let c = 0; c < area.cols; c++) {
        lats.push(coord(lat));
        lons.push(coord(wrapLon(area.west + ((area.east - area.west) * c) / (area.cols - 1))));
      }
    }
    const q = new URLSearchParams({ latitude: lats.join(','), longitude: lons.join(','), hourly: spec.variable, timezone: 'GMT', ...spec.extra });
    if (spec.url === AIR) {
      // The air-quality API takes days, not hours, for its range.
      q.set('past_days', '2');
      q.set('forecast_days', '2');
    } else {
      q.set('past_hours', String(PAST_HOURS));
      q.set('forecast_hours', String(AHEAD_HOURS));
    }
    const r = await fetchJson<Item[] | Item>(`${spec.url}?${q}`, { signal, timeoutMs: 20_000 });
    const items = Array.isArray(r) ? r : [r];
    const times = (items[0]?.hourly?.time ?? []).map((t) => Date.parse(`${t}Z`));
    const series = items.map((it) => (it.hourly?.[spec.variable] as (number | null)[] | undefined) ?? []);
    const grids = times.map((_, hi) => {
      const values = new Float32Array(items.length);
      for (let p = 0; p < items.length; p++) {
        const x = series[p][hi];
        values[p] = x == null ? NaN : spec.scale ? spec.scale(x) : x;
      }
      return { west: area.west, east: area.east, south: area.south, north: area.north, cols: area.cols, rows: area.rows, values };
    });
    return { at: Date.now(), times, grids };
  }
}
