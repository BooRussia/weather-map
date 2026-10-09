import { REALEARTH_API, REALEARTH_TILE_URL } from '../config';
import { fetchJson } from '../util/http';

/** "20261008.222400" → epoch ms. */
export function realEarthTime(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

/** Epoch ms → "20261008_222400", as tile requests name a frame. */
export function realEarthStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
}

/** The tile template for one frame of a product. */
export const realEarthTiles = (product: string, at: number) =>
  REALEARTH_TILE_URL.replace('{product}', product).replace('{stamp}', realEarthStamp(at));

/** A product's frame times on the server, epoch ms, oldest first. */
export async function getRealEarthTimes(product: string, signal?: AbortSignal): Promise<number[]> {
  const r = await fetchJson<Record<string, string[]>>(`${REALEARTH_API}/times?products=${product}`, { signal, timeoutMs: 10_000 });
  const times = (r[product] ?? [])
    .map(realEarthTime)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!times.length) throw new Error(`no ${product} frames`);
  return times;
}
