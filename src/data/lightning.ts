import type { Bounds, StormCell } from '../field/grid';
import { fetchJson } from '../util/http';

/**
 * Live lightning from the GOES Geostationary Lightning Mapper (flash extent
 * density, one-minute frames, about a minute behind), via SSEC RealEarth's
 * tiles. The tiles are colored; we read the colors back to where the
 * flashes are and how many, and draw our own glow and bolts there.
 */
const REALEARTH = 'https://realearth.ssec.wisc.edu/api';
/** GOES-East sees the U.S. and the Atlantic; GOES-West the West and the Pacific. */
const EAST = 'GOESEastGLMFEDRadC';
const WEST = 'GOESWestGLMFEDRadC';
const MAX_ZOOM = 6;
const MAX_TILES = 12;

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

/** "20261008.222400" → epoch ms. */
export function realEarthTime(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

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
  let z = Math.max(2, Math.min(MAX_ZOOM, Math.floor(mapZoom) - 1));
  const span = (zz: number) => ({
    x0: Math.floor(tileX(west, zz)),
    x1: Math.floor(tileX(east, zz)),
    y0: Math.floor(tileY(north, zz)),
    y1: Math.floor(tileY(south, zz)),
  });
  let t = span(z);
  while (z > 2 && (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1) > MAX_TILES) t = span(--z);

  // Bin flashes about two tile pixels wide: enough detail, not too many glows.
  const deg = (360 / (256 * 2 ** z)) * 2;
  const bins = new Map<string, StormCell>();
  const jobs: Promise<void>[] = [];
  for (let x = t.x0; x <= t.x1; x++) {
    for (let y = t.y0; y <= t.y1; y++) {
      const url = `${REALEARTH}/image?products=${product}_${day}_${time}&x=${x}&y=${y}&z=${z}`;
      jobs.push(
        tilePixels(url, signal).then((img) => {
          if (!img) return;
          const d = img.data;
          for (let i = 0, p = 0; i < d.length; i += 4, p++) {
            if (d[i + 3] < 128) continue;
            const px = p % img.width;
            const py = (p / img.width) | 0;
            const lon = lonAt(x + (px + 0.5) / img.width, z);
            const lat = latAt(y + (py + 0.5) / img.height, z);
            const key = `${Math.floor(lon / deg)},${Math.floor(lat / deg)}`;
            const level = flashLevel(d[i], d[i + 1], d[i + 2]);
            const cell = bins.get(key);
            if (!cell) bins.set(key, { lon: (Math.floor(lon / deg) + 0.5) * deg, lat: (Math.floor(lat / deg) + 0.5) * deg, level });
            else if (level > cell.level) cell.level = level;
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return {
    cells: [...bins.values()],
    cellDeg: { lon: deg, lat: deg },
    at,
    covers: { west: lonAt(t.x0, z), east: lonAt(t.x1 + 1, z), north: latAt(t.y0, z), south: latAt(t.y1 + 1, z) },
  };
}
