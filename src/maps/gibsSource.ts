import type { Bounds } from '../field/grid';
import type { FieldGrid } from '../map/fieldLayer';
import { fetchText } from '../util/http';
import type { WeatherMapId } from './catalog';
import type { Area, FieldSource } from './fieldController';

/**
 * Infrared satellite from NASA GIBS: GOES band 13 (clean longwave window)
 * tiles, which come colored with NASA's palette, decoded back to cloud-top
 * brightness temperature (°C) so the map draws them with our own ramp.
 */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml';
const MINUTE = 60_000;
/** Images every 10 minutes, about half an hour behind; frames every 20 minutes are plenty. */
const STEP = 20 * MINUTE;
const LATENCY = 40 * MINUTE;
const MAX_ZOOM = 6;
const MAX_TILES = 12;
const LUT_BITS = 5;

interface Palette {
  exact: Map<number, number>;
  /** Nearest palette value for every color, at 5 bits per channel (resampled tiles blend colors). */
  lut: Float32Array;
}

let palette: Promise<Palette> | null = null;

/** NASA's colormap: each RGB → the middle of its °C bin. */
export function parseColormap(xml: string): { rgb: number; value: number }[] {
  const out: { rgb: number; value: number }[] = [];
  const re = /<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false"[^>]*?\svalue="[([]([-\d.]+),([-\d.]+)[)\]]"/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    out.push({ rgb: (+m[1] << 16) | (+m[2] << 8) | +m[3], value: (+m[4] + +m[5]) / 2 });
  }
  return out;
}

function buildPalette(entries: { rgb: number; value: number }[]): Palette {
  const exact = new Map(entries.map((e) => [e.rgb, e.value]));
  const n = 1 << LUT_BITS;
  const lut = new Float32Array(n * n * n);
  const shift = 8 - LUT_BITS;
  const half = 1 << (shift - 1);
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        const R = (r << shift) + half;
        const G = (g << shift) + half;
        const B = (b << shift) + half;
        let best = Infinity;
        let value = NaN;
        for (const e of entries) {
          const dr = ((e.rgb >> 16) & 255) - R;
          const dg = ((e.rgb >> 8) & 255) - G;
          const db = (e.rgb & 255) - B;
          const d = dr * dr + dg * dg + db * db;
          if (d < best) {
            best = d;
            value = e.value;
          }
        }
        lut[(r * n + g) * n + b] = value;
      }
    }
  }
  return { exact, lut };
}

function loadPalette(signal: AbortSignal): Promise<Palette> {
  palette ??= fetchText(COLORMAP, { signal, timeoutMs: 15_000 }).then((xml) => buildPalette(parseColormap(xml)));
  palette.catch(() => (palette = null));
  return palette;
}

const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const abort = () => {
      img.src = '';
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    img.onload = () => {
      signal.removeEventListener('abort', abort);
      resolve(img);
    };
    // A missing tile (off the disk, not yet published) is just empty.
    img.onerror = () => {
      signal.removeEventListener('abort', abort);
      resolve(null);
    };
    img.src = url;
  });
}

export class GibsInfraredSource implements FieldSource {
  supports(id: WeatherMapId): boolean {
    return id === 'infrared';
  }

  /** The tiles covering the padded view, at a zoom that keeps the count small. */
  plan(_id: WeatherMapId, view: Bounds, zoom: number): Area {
    const lonPad = (view.east - view.west) * 0.25;
    const latPad = (view.north - view.south) * 0.25;
    const west = Math.max(-180, view.west - lonPad);
    const east = Math.min(180, view.east + lonPad);
    const north = Math.min(84, view.north + latPad);
    const south = Math.max(-84, view.south - latPad);
    let z = Math.max(1, Math.min(MAX_ZOOM, Math.floor(zoom)));
    const count = (zz: number) =>
      (Math.floor(tileX(east, zz)) - Math.floor(tileX(west, zz)) + 1) * (Math.floor(tileY(south, zz)) - Math.floor(tileY(north, zz)) + 1);
    while (z > 1 && count(z) > MAX_TILES) z--;
    const x0 = Math.floor(tileX(west, z));
    const x1 = Math.floor(tileX(east, z));
    const y0 = Math.floor(tileY(north, z));
    const y1 = Math.floor(tileY(south, z));
    // The area is the tile block itself; the grid is one cell per two tile pixels.
    const cols = Math.min(1024, (x1 - x0 + 1) * 128);
    const rows = Math.min(1024, (y1 - y0 + 1) * 128);
    return {
      west: tileLon(x0, z),
      east: tileLon(x1 + 1, z),
      north: tileLat(y0, z),
      south: tileLat(y1 + 1, z),
      cols,
      rows,
      zoom,
      key: `ir:${z}/${x0}-${x1}/${y0}-${y1}`,
    };
  }

  async times(_id: WeatherMapId, from: number): Promise<number[]> {
    const latest = Math.floor((Date.now() - LATENCY) / (10 * MINUTE)) * 10 * MINUTE;
    const out: number[] = [];
    for (let t = latest; t >= from; t -= STEP) out.unshift(t);
    return out;
  }

  async frame(_id: WeatherMapId, area: Area, time: number, signal: AbortSignal): Promise<FieldGrid> {
    const pal = await loadPalette(signal);
    const m = /^ir:(\d+)\/(\d+)-(\d+)\/(\d+)-(\d+)$/.exec(area.key);
    if (!m) throw new Error('bad infrared area');
    const [z, x0, x1, y0, y1] = m.slice(1).map(Number);
    // GOES-East sees the Americas and the Atlantic; GOES-West the Pacific.
    const center = (area.west + area.east) / 2;
    const layer = center < -115 ? 'GOES-West_ABI_Band13_Clean_Infrared' : 'GOES-East_ABI_Band13_Clean_Infrared';
    const tw = x1 - x0 + 1;
    const th = y1 - y0 + 1;
    const canvas = document.createElement('canvas');
    canvas.width = tw * 256;
    canvas.height = th * 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D canvas');
    const jobs: Promise<void>[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const url = `${GIBS}/${layer}/default/${iso(time)}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
        jobs.push(
          loadImage(url, signal).then((img) => {
            if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256);
          }),
        );
      }
    }
    await Promise.all(jobs);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // Resample the Mercator image onto rows evenly spaced in latitude, decoding colors as we go.
    const { cols, rows } = area;
    const values = new Float32Array(cols * rows);
    const n = 1 << LUT_BITS;
    const shift = 8 - LUT_BITS;
    for (let r = 0; r < rows; r++) {
      const lat = area.north - ((area.north - area.south) * r) / (rows - 1);
      const py = Math.min(canvas.height - 1, Math.max(0, Math.floor((tileY(lat, z) - y0) * 256)));
      for (let c = 0; c < cols; c++) {
        const lon = area.west + ((area.east - area.west) * c) / (cols - 1);
        const pxX = Math.min(canvas.width - 1, Math.max(0, Math.floor((tileX(lon, z) - x0) * 256)));
        const o = (py * canvas.width + pxX) * 4;
        if (px[o + 3] < 128) {
          values[r * cols + c] = NaN;
          continue;
        }
        const rgb = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
        values[r * cols + c] = pal.exact.get(rgb) ?? pal.lut[((px[o] >> shift) * n + (px[o + 1] >> shift)) * n + (px[o + 2] >> shift)];
      }
    }
    return { west: area.west, east: area.east, north: area.north, south: area.south, cols, rows, values };
  }
}
