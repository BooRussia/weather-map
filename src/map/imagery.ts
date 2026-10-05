import type { Map as MlMap, RasterTileSource } from 'maplibre-gl';
import {
  AERIAL_TILE_URL,
  CLOUDS_TILE_URL,
  IMAGERY_REFRESH_MS,
  RADAR_TILE_URL,
  type Basemap,
  type ColorMode,
} from '../config';

/**
 * Raster imagery layers. Stack, bottom to top:
 *   Carto background → aerial (Satellite style) → Carto fills/lines (Dark style)
 *   → clouds → radar → Carto labels.
 */
const AERIAL = 'esri-aerial';
const CLOUDS = 'goes-clouds';
const RADAR = 'nws-radar';
const OWN = new Set([AERIAL, CLOUDS, RADAR]);

type LiveLayer = typeof CLOUDS | typeof RADAR;

interface RasterPaint {
  saturation: number;
  opacity: number;
  brightnessMax: number;
  contrast: number;
}

/**
 * Mono is the DESIGN.md default: everything grayscale. Color is the
 * owner-requested data exception: the NWS reflectivity scale on radar and
 * true color on aerial imagery. Aerial is dimmed in both modes so white wind
 * particles and HUD type stay readable. Clouds are infrared: grayscale either way.
 */
const PAINT: Record<string, Record<ColorMode, RasterPaint>> = {
  [RADAR]: {
    mono: { saturation: -1, opacity: 0.3, brightnessMax: 0.75, contrast: 0 },
    color: { saturation: 0, opacity: 0.7, brightnessMax: 1, contrast: 0 },
  },
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
  radar: boolean;
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

  map.addSource(CLOUDS, { type: 'raster', tiles: [liveTiles(CLOUDS)], tileSize: 256, maxzoom: 9 });
  addRaster(map, CLOUDS, s.clouds, s.colorMode, firstSymbol);

  map.addSource(RADAR, { type: 'raster', tiles: [liveTiles(RADAR)], tileSize: 256, minzoom: 3, maxzoom: 10 });
  addRaster(map, RADAR, s.radar, s.colorMode, firstSymbol);

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

export function setImageryVisible(map: MlMap, which: 'radar' | 'clouds', visible: boolean): void {
  const id = which === 'radar' ? RADAR : CLOUDS;
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(visible));
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

/* ---------- keeping live layers fresh ---------- */

const bucket = () => Math.floor(Date.now() / IMAGERY_REFRESH_MS);
const loaded = new Map<LiveLayer, number>();
const BASE_URL: Record<LiveLayer, string> = { [CLOUDS]: CLOUDS_TILE_URL, [RADAR]: RADAR_TILE_URL };

/** Cache-bust per bucket so tiles refresh as new scans arrive. */
function liveTiles(id: LiveLayer): string {
  const b = bucket();
  loaded.set(id, b);
  return `${BASE_URL[id]}&_t=${b}`;
}

/** Re-request radar/cloud tiles once a new bucket has started. Safe to call often. */
export function refreshImagery(map: MlMap, visible: { radar: boolean; clouds: boolean }): void {
  const b = bucket();
  for (const [id, on] of [
    [RADAR, visible.radar],
    [CLOUDS, visible.clouds],
  ] as const) {
    if (!on || loaded.get(id) === b) continue;
    (map.getSource(id) as RasterTileSource | undefined)?.setTiles([liveTiles(id)]);
  }
}

/* ---------- shared with the radar loop ---------- */

/** Radar raster paint for a color mode, so loop frames look like the live layer. */
export function radarPaint(mode: ColorMode): Record<string, number> {
  const p = PAINT[RADAR][mode];
  return {
    'raster-saturation': p.saturation,
    'raster-opacity': p.opacity,
    'raster-brightness-max': p.brightnessMax,
    'raster-contrast': p.contrast,
    'raster-fade-duration': 0,
  };
}

/** Id of the layer drawn just above the live radar (new layers go here to sit in its slot). */
export function aboveRadar(map: MlMap): string | undefined {
  const layers = map.getStyle().layers;
  const i = layers.findIndex((l) => l.id === RADAR);
  return i >= 0 ? layers[i + 1]?.id : undefined;
}
