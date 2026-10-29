import type { Bounds } from '../field/grid';
import type { FieldGrid } from '../map/fieldLayer';
import { fetchJson } from '../util/http';
import type { WeatherMapId } from './catalog';
import type { Area, FieldSource } from './fieldController';

/** NOAA SWPC's OVATION aurora forecast: a 1° world grid of the chance of seeing an aurora overhead, every few minutes. */
const OVATION = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
/** It's redone about every five minutes; a fresh look this often is plenty. */
const TTL = 10 * 60_000;

interface Ovation {
  'Forecast Time': string;
  /** [longitude 0–359, latitude −90–90, chance %]. */
  coordinates: [number, number, number][];
}

/** The forecast as a world lattice, west to east from −180°, north to south. */
export function ovationGrid(o: Ovation): FieldGrid {
  const cols = 360;
  const rows = 181;
  const values = new Float32Array(cols * rows).fill(0);
  for (const [lon, lat, v] of o.coordinates) {
    const c = (Math.round(lon) + 180) % 360;
    const r = 90 - Math.round(lat);
    if (r >= 0 && r < rows) values[r * cols + c] = v;
  }
  return { west: -180, east: 179, north: 90, south: -90, cols, rows, values };
}

/**
 * The aurora (owner, 2026-10-29): NOAA's 30-to-90-minute forecast, one frame, the same at every moment
 * of the timeline (there's no history or longer forecast).
 */
export class AuroraSource implements FieldSource {
  private latest: { at: number; time: number; grid: Promise<FieldGrid> } | null = null;

  supports(id: WeatherMapId): boolean {
    return id === 'aurora';
  }

  plan(_id: WeatherMapId, _view: Bounds, zoom: number): Area {
    return { west: -180, east: 179, north: 90, south: -90, cols: 360, rows: 181, zoom, key: 'aurora' };
  }

  private load(signal: AbortSignal): Promise<{ time: number; grid: FieldGrid }> {
    if (!this.latest || Date.now() - this.latest.at > TTL) {
      const p = fetchJson<Ovation>(OVATION, { signal, timeoutMs: 20_000 });
      this.latest = { at: Date.now(), time: 0, grid: p.then(ovationGrid) };
      const mine = this.latest;
      void p.then((o) => (mine.time = Date.parse(o['Forecast Time']))).catch(() => (this.latest = null));
    }
    const l = this.latest;
    return l.grid.then((grid) => ({ time: l.time || Date.now(), grid }));
  }

  async times(_id: WeatherMapId, _from: number, _to: number, signal: AbortSignal): Promise<number[]> {
    return [(await this.load(signal)).time];
  }

  async frame(_id: WeatherMapId, _area: Area, _time: number, signal: AbortSignal): Promise<FieldGrid> {
    return (await this.load(signal)).grid;
  }
}
