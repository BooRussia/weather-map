import { addProtocol, type Map as MlMap, type RasterTileSource } from 'maplibre-gl';
import { tileBbox } from './radarLayer';

/**
 * Satellite clouds, cut out (beta): NOAA nowCOAST's GOES East + West imagery
 * (reprojected to web-map tiles, so every pixel is already in the right
 * place) read pixel by pixel, keeping the clouds and dropping the ground and
 * sea, so the map shows through around them. By day the visible band gives
 * the detail (clouds are bright, the sea dark); at night, and for thin high
 * cloud, the infrared band does (clouds are cold, the surface warm). Past
 * GOES's reach (the eastern Atlantic, the deep tropics, the rest of the
 * world) NOAA's global satellite mosaic takes over: infrared only, about
 * 3 km and a couple of hours old, blended in across the edge.
 */
const WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';
const SOURCE = 'cloud-cutout';
const PROTOCOL = 'cloudcut';
/** Pixels per tile side: twice the tile size, for crisp edges on high-density screens. */
const SIZE = 512;
/** New imagery every 5–10 minutes. */
const REFRESH_MS = 10 * 60_000;
/**
 * Pixels of margin fetched around each tile, and the width of the hand-over
 * from GOES to the global mosaic before GOES's data ends. GOES's real edge
 * is ragged (57.7° W at 40° N, 61.5° W at 20° N, 70° W at 12° N, not the
 * 50.75° W its extent claims), so the blend follows its pixels, and the
 * margin lets it see past the tile so neighbors fade alike.
 */
const MARGIN = 32;
const FULL = SIZE + 2 * MARGIN;
/** Inside this box GOES always has data: the global mosaic isn't fetched unless a tile proves otherwise. */
const GOES_SURE = { west: -125, east: -72, south: 15, north: 48 };

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

/**
 * One pixel of the global mosaic's infrared (its own gray scale: open sea
 * ~37, thin cloud ~85, the coldest tops ~230; GOES's 70 and 150 land at
 * about 25 and 103 on it) → cloud brightness and opacity, 0–255.
 */
export function globalCloudPixel(ir: number): [lum: number, alpha: number] {
  const alpha = smoothstep(35, 115, ir);
  const lum = smoothstep(35, 230, ir);
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
    const [bx0, by0, bx1, by1] = tileBbox(z, x, y).split(',').map(Number);
    const pad = ((bx1 - bx0) / SIZE) * MARGIN;
    const bbox = [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad].map((n) => n.toFixed(2)).join(',');
    const wms = (layer: string) =>
      `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=&crs=EPSG:3857&bbox=${bbox}` +
      `&width=${FULL}&height=${FULL}&format=image/png&transparent=true&_t=${t}`;
    // GOES where it has data; the global mosaic past it, blended across the last MARGIN pixels before GOES ends.
    const west = lonAt(x, z);
    const east = lonAt(x + 1, z);
    const north = latAt(y, z);
    const south = latAt(y + 1, z);
    const sure = west >= GOES_SURE.west && east <= GOES_SURE.east && south >= GOES_SURE.south && north <= GOES_SURE.north;
    const c = canvas(FULL);
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const pixels = (img: ImageBitmap | null) => {
      if (!img) return null;
      ctx.clearRect(0, 0, FULL, FULL);
      ctx.drawImage(img, 0, 0, FULL, FULL);
      img.close();
      return ctx.getImageData(0, 0, FULL, FULL).data;
    };
    const [vis, ir, gir] = await Promise.all([
      image(wms('goes_visible_imagery'), abort.signal),
      image(wms('goes_longwave_imagery'), abort.signal),
      sure ? null : image(wms('global_longwave_imagery_mosaic'), abort.signal),
    ]);
    const v = pixels(vis)!;
    const g = pixels(ir)!;
    // GOES's share: how far each pixel is from where its data stops (chamfer distance, capped at MARGIN).
    const dist = new Float32Array(FULL * FULL);
    let gaps = false;
    for (let i = 0; i < FULL * FULL; i++) {
      const ok = v[i * 4 + 3] >= 128 || g[i * 4 + 3] >= 128;
      dist[i] = ok ? MARGIN : 0;
      if (!ok) gaps = true;
    }
    if (gaps) {
      for (let yy = 0; yy < FULL; yy++) {
        for (let xx = 0; xx < FULL; xx++) {
          const i = yy * FULL + xx;
          if (!dist[i]) continue;
          if (xx) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
          if (yy) dist[i] = Math.min(dist[i], dist[i - FULL] + 1);
          if (xx && yy) dist[i] = Math.min(dist[i], dist[i - FULL - 1] + 1.414);
          if (xx < FULL - 1 && yy) dist[i] = Math.min(dist[i], dist[i - FULL + 1] + 1.414);
        }
      }
      for (let yy = FULL - 1; yy >= 0; yy--) {
        for (let xx = FULL - 1; xx >= 0; xx--) {
          const i = yy * FULL + xx;
          if (!dist[i]) continue;
          if (xx < FULL - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
          if (yy < FULL - 1) dist[i] = Math.min(dist[i], dist[i + FULL] + 1);
          if (xx < FULL - 1 && yy < FULL - 1) dist[i] = Math.min(dist[i], dist[i + FULL + 1] + 1.414);
          if (xx && yy < FULL - 1) dist[i] = Math.min(dist[i], dist[i + FULL - 1] + 1.414);
        }
      }
    }
    // A tile in the "sure" box that has a hole after all: fetch the global mosaic now.
    const q = gir ? pixels(gir) : gaps ? pixels(await image(wms('global_longwave_imagery_mosaic'), abort.signal)) : null;
    const day = daylight(z, x, y, Date.now());
    const out = ctx.createImageData(SIZE, SIZE);
    const o = out.data;
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const i = (py + MARGIN) * FULL + px + MARGIN;
        const k = i * 4;
        const w = smoothstep(0, MARGIN, dist[i]);
        let aA = 0;
        let lumA = 0;
        if (w > 0) [lumA, aA] = cloudPixel(v[k + 3] < 128 ? 0 : v[k], g[k + 3] < 128 ? 0 : g[k], day(px, py));
        let aB = 0;
        let lumB = 0;
        if (q && w < 1 && q[k + 3] >= 128) [lumB, aB] = globalCloudPixel(q[k]);
        const wa = aA * w;
        const wb = aB * (1 - w);
        const alpha = wa + wb;
        if (alpha < 1) continue;
        const lum = (lumA * wa + lumB * wb) / alpha;
        const ko = (py * SIZE + px) * 4;
        o[ko] = Math.round(lum * 0.965);
        o[ko + 1] = Math.round(lum * 0.98);
        o[ko + 2] = Math.round(lum);
        o[ko + 3] = Math.round(alpha);
      }
    }
    ctx.putImageData(out, 0, 0);
    return { data: await createImageBitmap(c, 0, 0, SIZE, SIZE) };
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
