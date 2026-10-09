import { REALEARTH_API } from '../config';
import type { Bounds, StormCell } from '../field/grid';
import { fetchJson } from '../util/http';
import { realEarthTime } from './realearth';

/**
 * Live lightning from the GOES Geostationary Lightning Mapper (flash extent
 * density, one-minute frames, about a minute behind), via SSEC RealEarth's
 * tiles. The tiles are colored; we read the colors back to where the
 * flashes are and how many, and draw our own glow and bolts there.
 */
const REALEARTH = REALEARTH_API;
/** GOES-East sees the U.S. and the Atlantic; GOES-West the West and the Pacific. */
const EAST = 'GOESEastGLMFEDRadC';
const WEST = 'GOESWestGLMFEDRadC';
/** RealEarth serves the flash grid (~2 km) to zoom 7. */
const MAX_ZOOM = 7;
const MAX_TILES = 16;

/** Flashes binned on a coarse grid: where, how strong (1..4), and the bin size in degrees. */
export interface LightningData {
  cells: StormCell[];
  cellDeg: { lon: number; lat: number };
  /** Frame time, epoch ms. */
  at: number;
  covers: Bounds;
}

const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-84, Math.min(84, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const lonAt = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latAt = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export { realEarthTime };

/**
 * Flash density from a tile color: the product runs dark blue (a flash or
 * two) through brighter blue to cyan and beyond (many). 1..4.
 */
export function flashLevel(r: number, g: number, b: number): number {
  if (r > 128) return 4;
  if (g >= 100) return 3;
  if (g >= 20 || b >= 240) return 2;
  return 1;
}

/**
 * The density itself, finely: the ramp brightens blue, then adds green, then
 * red, so the channel sum climbs with it. 0: no flashes. Black is how
 * RealEarth paints an empty tile (opaque), so it counts as none.
 */
export const flashDensity = (r: number, g: number, b: number) => (r + g + b < 30 ? 0 : r + g + b);

/**
 * Where flashes centered on one tile's density grid: the satellite records
 * each flash as a smear (its extent), so a lone flash is a flat patch and
 * overlapping flashes stack into a peak. Each local maximum (a pixel at least
 * as dense as its eight neighbors, flat stretches of equal value taken
 * together) becomes one point at its middle, in pixel units.
 */
export function densityPeaks(d: Uint16Array, w: number, h: number): { x: number; y: number; d: number }[] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  const isMax = (x: number, y: number) => {
    const v = d[y * w + x];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy) > v) return false;
    return true;
  };
  const seen = new Uint8Array(w * h);
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = d[i];
      if (!v || seen[i] || !isMax(x, y)) continue;
      // The flat stretch of this value around it; a true peak only if nothing next to it is higher.
      let sx = 0;
      let sy = 0;
      let n = 0;
      let peak = true;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const kx = k % w;
        const ky = (k / w) | 0;
        sx += kx;
        sy += ky;
        n++;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = kx + dx;
            const ny = ky + dy;
            const nv = at(nx, ny);
            if (nv > v) peak = false;
            if (nv !== v) continue;
            const j = ny * w + nx;
            if (seen[j]) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      if (peak) out.push({ x: sx / n + 0.5, y: sy / n + 0.5, d: v });
    }
  }
  return out;
}

async function tilePixels(url: string, signal: AbortSignal): Promise<ImageData | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export interface FlashPixel {
  lon: number;
  lat: number;
  level: number;
}

/** Peaks closer than this merge, degrees (~2 km): the same flash split by a tile edge, or two pixels of one peak. */
const MIN_SPACING_DEG = 0.02;

/**
 * Merge flash points closer than `spacing` degrees, keeping the densest
 * (greedy non-maximum suppression on a spatial hash).
 */
export function flashPoints(lit: FlashPixel[], spacing: number): StormCell[] {
  if (!lit.length) return [];
  const key = (lon: number, lat: number) => `${Math.floor(lon / spacing)},${Math.floor(lat / spacing)}`;
  const crowd = new Map<string, number>();
  for (const p of lit) {
    const k = key(p.lon, p.lat);
    crowd.set(k, (crowd.get(k) ?? 0) + 1);
  }
  const around = (lon: number, lat: number) => {
    const cx = Math.floor(lon / spacing);
    const cy = Math.floor(lat / spacing);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += crowd.get(`${cx + dx},${cy + dy}`) ?? 0;
    return n;
  };
  const ranked = lit.map((p) => ({ p, score: p.level * 1e6 + around(p.lon, p.lat) })).sort((a, b) => b.score - a.score);
  const kept = new Map<string, StormCell[]>();
  const out: StormCell[] = [];
  for (const { p } of ranked) {
    const cx = Math.floor(p.lon / spacing);
    const cy = Math.floor(p.lat / spacing);
    const cosLat = Math.cos((p.lat * Math.PI) / 180);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) {
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (const q of kept.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot((q.lon - p.lon) * cosLat, q.lat - p.lat) < spacing) {
            near = true;
            break;
          }
        }
      }
    }
    if (near) continue;
    const cell: StormCell = { lon: p.lon, lat: p.lat, level: p.level };
    out.push(cell);
    const k = `${cx},${cy}`;
    (kept.get(k) ?? kept.set(k, []).get(k)!).push(cell);
  }
  return out;
}

/** The latest minute of lightning over (a padded) view. */
export async function getLightning(view: Bounds, mapZoom: number, signal: AbortSignal): Promise<LightningData> {
  const center = (view.west + view.east) / 2;
  const product = center < -115 ? WEST : EAST;
  const latest = await fetchJson<Record<string, string>>(`${REALEARTH}/latest?products=${product}`, { signal, timeoutMs: 10_000 });
  const stamp = latest[product];
  const at = realEarthTime(stamp ?? '');
  if (!stamp || !Number.isFinite(at)) throw new Error('no lightning frame');
  const [day, time] = stamp.split('.');

  const padX = (view.east - view.west) * 0.2;
  const padY = (view.north - view.south) * 0.2;
  const west = Math.max(-180, view.west - padX);
  const east = Math.min(180, view.east + padX);
  const north = Math.min(84, view.north + padY);
  const south = Math.max(-84, view.south - padY);
  let z = Math.max(2, Math.min(MAX_ZOOM, Math.floor(mapZoom)));
  const span = (zz: number) => ({
    x0: Math.floor(tileX(west, zz)),
    x1: Math.floor(tileX(east, zz)),
    y0: Math.floor(tileY(north, zz)),
    y1: Math.floor(tileY(south, zz)),
  });
  let t = span(z);
  while (z > 2 && (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1) > MAX_TILES) t = span(--z);

  // The density peaks on each tile: where flashes centered.
  const deg = 360 / (256 * 2 ** z);
  const lit: FlashPixel[] = [];
  const jobs: Promise<void>[] = [];
  for (let x = t.x0; x <= t.x1; x++) {
    for (let y = t.y0; y <= t.y1; y++) {
      const url = `${REALEARTH}/image?products=${product}_${day}_${time}&x=${x}&y=${y}&z=${z}`;
      jobs.push(
        tilePixels(url, signal).then((img) => {
          if (!img) return;
          const px = img.data;
          const dens = new Uint16Array(img.width * img.height);
          const level = new Uint8Array(img.width * img.height);
          for (let i = 0, p = 0; i < px.length; i += 4, p++) {
            if (px[i + 3] < 128) continue;
            dens[p] = flashDensity(px[i], px[i + 1], px[i + 2]);
            if (dens[p]) level[p] = flashLevel(px[i], px[i + 1], px[i + 2]);
          }
          for (const pk of densityPeaks(dens, img.width, img.height)) {
            const k = Math.min(img.width * img.height - 1, Math.floor(pk.y) * img.width + Math.floor(pk.x));
            lit.push({ lon: lonAt(x + pk.x / img.width, z), lat: latAt(y + pk.y / img.height, z), level: level[k] || 1 });
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return {
    cells: flashPoints(lit, Math.max(1.5 * deg, MIN_SPACING_DEG)),
    cellDeg: { lon: deg, lat: deg },
    at,
    covers: { west: lonAt(t.x0, z), east: lonAt(t.x1 + 1, z), north: latAt(t.y0, z), south: latAt(t.y1 + 1, z) },
  };
}
