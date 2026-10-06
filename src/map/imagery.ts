import type { Map as MlMap, RasterTileSource } from 'maplibre-gl';
import { AERIAL_TILE_URL, CLOUDS_TILE_URL, IMAGERY_REFRESH_MS, type Basemap, type ColorMode } from '../config';

/**
 * Raster imagery layers. Stack, bottom to top:
 *   Carto background → aerial (Satellite style) → Carto fills/lines (Dark style)
 *   → clouds → radar (its own layer, radarLayer.ts) → Carto labels.
 */
const AERIAL = 'esri-aerial';
const CLOUDS = 'goes-clouds';
const OWN = new Set([AERIAL, CLOUDS]);

interface RasterPaint {
  saturation: number;
  opacity: number;
  brightnessMax: number;
  contrast: number;
}

/**
 * Mono is the DESIGN.md default: everything grayscale. Color is the
 * owner-requested data exception: true color on aerial imagery (and the radar
 * ramp, in radarPalette.ts). Aerial is dimmed in both modes so white wind
 * particles and HUD type stay readable. Clouds are infrared: grayscale either way.
 */
const PAINT: Record<string, Record<ColorMode, RasterPaint>> = {
  [AERIAL]: {
    mono: { saturation: -1, opacity: 1, brightnessMax: 0.6, contrast: 0 },
    color: { saturation: -0.1, opacity: 1, brightnessMax: 0.7, contrast: 0 },
  },
  // Dimmed so white wind lines and HUD type stay readable under full overcast.
  [CLOUDS]: {
    mono: { saturation: -1, opacity: 0.55, brightnessMax: 0.75, contrast: 0.2 },
    color: { saturation: -1, opacity: 0.55, brightnessMax: 0.75, contrast: 0.2 },
  },
};

export interface ImageryState {
  clouds: boolean;
  basemap: Basemap;
  colorMode: ColorMode;
}

/** Add all imagery layers in their resting state. Call once, after `load`. */
export function addImagery(map: MlMap, s: ImageryState): void {
  const layers = map.getStyle().layers;
  const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
  const firstVector = layers.find((l) => l.type !== 'background')?.id;

  map.addSource(AERIAL, { type: 'raster', tiles: [AERIAL_TILE_URL], tileSize: 256, maxzoom: 19 });
  addRaster(map, AERIAL, s.basemap === 'satellite', s.colorMode, firstVector);

  map.addSource(CLOUDS, { type: 'raster', tiles: [liveTiles()], tileSize: 256, maxzoom: 9 });
  addRaster(map, CLOUDS, s.clouds, s.colorMode, firstSymbol);

  setBasemap(map, s.basemap);
}

function addRaster(map: MlMap, id: string, visible: boolean, mode: ColorMode, beforeId: string | undefined): void {
  const p = PAINT[id][mode];
  map.addLayer(
    {
      id,
      type: 'raster',
      source: id,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'raster-saturation': p.saturation,
        'raster-opacity': p.opacity,
        'raster-brightness-max': p.brightnessMax,
        'raster-contrast': p.contrast,
        'raster-fade-duration': 0,
      },
    },
    beforeId,
  );
}

const visibility = (on: boolean) => (on ? 'visible' : 'none');

export function setCloudsVisible(map: MlMap, visible: boolean): void {
  if (map.getLayer(CLOUDS)) map.setLayoutProperty(CLOUDS, 'visibility', visibility(visible));
}

export function setColorMode(map: MlMap, mode: ColorMode): void {
  for (const id of OWN) {
    if (!map.getLayer(id)) continue;
    const p = PAINT[id][mode];
    map.setPaintProperty(id, 'raster-saturation', p.saturation);
    map.setPaintProperty(id, 'raster-opacity', p.opacity);
    map.setPaintProperty(id, 'raster-brightness-max', p.brightnessMax);
    map.setPaintProperty(id, 'raster-contrast', p.contrast);
  }
}

/**
 * Satellite: show aerial imagery and hide Carto's fills and lines, keeping
 * labels and boundaries on top (a "hybrid" view). Dark: the reverse.
 */
export function setBasemap(map: MlMap, basemap: Basemap): void {
  if (!map.getLayer(AERIAL)) return;
  const satellite = basemap === 'satellite';
  map.setLayoutProperty(AERIAL, 'visibility', visibility(satellite));
  for (const l of map.getStyle().layers) {
    if (OWN.has(l.id) || /boundary/.test(l.id)) continue;
    if (l.type === 'fill' || l.type === 'line' || l.type === 'fill-extrusion') {
      map.setLayoutProperty(l.id, 'visibility', visibility(!satellite));
    }
  }
}

/* ---------- keeping clouds fresh ---------- */

const bucket = () => Math.floor(Date.now() / IMAGERY_REFRESH_MS);
let loadedBucket = -1;

/** Cache-bust per bucket so tiles refresh as new scans arrive. */
function liveTiles(): string {
  loadedBucket = bucket();
  return `${CLOUDS_TILE_URL}&_t=${loadedBucket}`;
}

/** Re-request cloud tiles once a new bucket has started. Safe to call often. */
export function refreshClouds(map: MlMap, visible: boolean): void {
  if (!visible || loadedBucket === bucket()) return;
  (map.getSource(CLOUDS) as RasterTileSource | undefined)?.setTiles([liveTiles()]);
}
