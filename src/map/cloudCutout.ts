import { addProtocol, type Map as MlMap, type RasterTileSource } from 'maplibre-gl';
import { tileBbox } from './radarLayer';

/**
 * Satellite clouds, cut out (beta): NOAA nowCOAST's GOES East + West imagery
 * (reprojected to web-map tiles, so every pixel is already in the right
 * place) read pixel by pixel, keeping the clouds and dropping the ground and
 * sea, so the map shows through around them. By day the visible band gives
 * the detail (clouds are bright, the sea dark); at night, and for thin high
 * cloud, the infrared band does (clouds are cold, the surface warm).
 */
const WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';
const SOURCE = 'cloud-cutout';
const PROTOCOL = 'cloudcut';
/** Pixels per tile side: twice the tile size, for crisp edges on high-density screens. */
const SIZE = 512;
/** New imagery every 5–10 minutes. */
const REFRESH_MS = 10 * 60_000;
/** Where the GOES imagery ends (nowCOAST's extent), and how far inside it the clouds fade out, degrees. */
const EXTENT = { west: -179.5, east: -50.75, south: 10.9, north: 50.55 };
const FEATHER_DEG = 1.2;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One pixel: visible and infrared gray (0–255, as nowCOAST draws them) and
 * how much daylight there is (0 night … 1 day) → cloud brightness and
 * opacity, 0–255. Thresholds measured on the imagery: open sea reads ~38
 * visible / ~57 infrared, land up to ~60 / ~58, thin cloud from ~65 / ~70,
 * thick tops ~200 / ~230.
 */
export function cloudPixel(vis: number, ir: number, day: number): [lum: number, alpha: number] {
  const visA = smoothstep(62, 160, vis);
  const irA = smoothstep(70, 150, ir);
  const alpha = day * Math.max(visA, irA * 0.8) + (1 - day) * irA;
  const lum = day * smoothstep(62, 220, vis) + (1 - day) * smoothstep(70, 235, ir);
  return [Math.round(255 * (0.55 + 0.45 * lum)), Math.round(255 * 0.92 * alpha)];
}

/** Sun's elevation, degrees, at a place and time (NOAA's low-precision formula). */
export function sunElevation(lat: number, lon: number, ms: number): number {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const day = (ms - start) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const hourAngle = ((minutes + eqTime + 4 * lon) / 4 - 180) * (Math.PI / 180);
  const phi = (lat * Math.PI) / 180;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - (Math.acos(Math.max(-1, Math.min(1, cosZ))) * 180) / Math.PI;
}

const lonAt = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latAt = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function canvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

async function image(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`satellite tile: HTTP ${r.status}`);
  return createImageBitmap(await r.blob());
}

/** Daylight (0…1) across a tile, from the sun's height at a 9 × 9 grid, smoothed in between. */
function daylight(z: number, x: number, y: number, ms: number): (px: number, py: number) => number {
  const N = 9;
  const grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const el = sunElevation(latAt(y + j / (N - 1), z), lonAt(x + i / (N - 1), z), ms);
      grid[j * N + i] = smoothstep(-2, 8, el);
    }
  }
  return (px, py) => {
    const fx = (px / SIZE) * (N - 1);
    const fy = (py / SIZE) * (N - 1);
    const i = Math.min(N - 2, Math.floor(fx));
    const j = Math.min(N - 2, Math.floor(fy));
    const tx = fx - i;
    const ty = fy - j;
    const top = grid[j * N + i] * (1 - tx) + grid[j * N + i + 1] * tx;
    const bot = grid[(j + 1) * N + i] * (1 - tx) + grid[(j + 1) * N + i + 1] * tx;
    return top * (1 - ty) + bot * ty;
  };
}

let registered = false;

/** Tiles `cloudcut://z/x/y?t=…`: fetch both bands for the tile, cut the clouds out, hand MapLibre the pixels. */
function register(): void {
  if (registered) return;
  registered = true;
  addProtocol(PROTOCOL, async (params, abort) => {
    const m = /^cloudcut:\/\/(\d+)\/(\d+)\/(\d+)\?t=(\d+)/.exec(params.url);
    if (!m) throw new Error('bad cloud tile');
    const [z, x, y, t] = m.slice(1).map(Number);
    const wms = (layer: string) =>
      `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=&crs=EPSG:3857&bbox=${tileBbox(z, x, y)}` +
      `&width=${SIZE}&height=${SIZE}&format=image/png&transparent=true&_t=${t}`;
    const [vis, ir] = await Promise.all([image(wms('goes_visible_imagery'), abort.signal), image(wms('goes_longwave_imagery'), abort.signal)]);
    const c = canvas(SIZE);
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(vis, 0, 0, SIZE, SIZE);
    const v = ctx.getImageData(0, 0, SIZE, SIZE).data;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(ir, 0, 0, SIZE, SIZE);
    const g = ctx.getImageData(0, 0, SIZE, SIZE).data;
    vis.close();
    ir.close();
    const day = daylight(z, x, y, Date.now());
    // Fade out toward the edge of the imagery rather than stopping at a hard line.
    const rowFade = new Float32Array(SIZE);
    const colFade = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      const lat = latAt(y + (i + 0.5) / SIZE, z);
      const lon = lonAt(x + (i + 0.5) / SIZE, z);
      rowFade[i] = smoothstep(0, FEATHER_DEG, Math.min(EXTENT.north - lat, lat - EXTENT.south));
      colFade[i] = smoothstep(0, FEATHER_DEG, Math.min(EXTENT.east - lon, lon - EXTENT.west));
    }
    const out = ctx.createImageData(SIZE, SIZE);
    const o = out.data;
    for (let py = 0; py < SIZE; py++) {
      if (!rowFade[py]) continue;
      for (let px = 0; px < SIZE; px++) {
        const k = (py * SIZE + px) * 4;
        // Outside the satellites' view both bands are transparent.
        if (v[k + 3] < 128 && g[k + 3] < 128) continue;
        const [lum, alpha] = cloudPixel(v[k + 3] < 128 ? 0 : v[k], g[k + 3] < 128 ? 0 : g[k], day(px, py));
        if (!alpha) continue;
        o[k] = Math.round(lum * 0.965);
        o[k + 1] = Math.round(lum * 0.98);
        o[k + 2] = lum;
        o[k + 3] = Math.round(alpha * rowFade[py] * colFade[px]);
      }
    }
    ctx.putImageData(out, 0, 0);
    return { data: await createImageBitmap(c) };
  });
}

const bucket = () => Math.floor(Date.now() / REFRESH_MS);

/** The cutout as a map layer: under the weather map, radar, and labels; tiles load only while it's shown. */
export class CloudCutout {
  private shownBucket = bucket();

  constructor(private readonly map: MlMap) {
    register();
  }

  /** Add it (hidden) below `beforeId`. */
  install(beforeId: string | undefined, visible: boolean): void {
    this.map.addSource(SOURCE, { type: 'raster', tiles: [this.tiles()], tileSize: 256, maxzoom: 8 });
    this.map.addLayer(
      {
        id: SOURCE,
        type: 'raster',
        source: SOURCE,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: { 'raster-fade-duration': 300, 'raster-resampling': 'linear' },
      },
      beforeId,
    );
  }

  setVisible(on: boolean): void {
    if (!this.map.getLayer(SOURCE)) return;
    this.map.setLayoutProperty(SOURCE, 'visibility', on ? 'visible' : 'none');
    if (on) this.refresh();
  }

  /** Newer imagery, if a refresh interval has passed. */
  refresh(): void {
    if (bucket() === this.shownBucket) return;
    this.shownBucket = bucket();
    (this.map.getSource(SOURCE) as RasterTileSource | undefined)?.setTiles([this.tiles()]);
  }

  private tiles(): string {
    return `${PROTOCOL}://{z}/{x}/{y}?t=${this.shownBucket}`;
  }
}
