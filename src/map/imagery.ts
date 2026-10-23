import type { Map as MlMap } from 'maplibre-gl';
import { AERIAL_TILE_URL, STANDARD_TILE_URLS, type Basemap, type ColorMode } from '../config';

/**
 * Raster imagery layers. Stack, bottom to top:
 *   Carto background → aerial (Satellite) or Voyager (Standard) → Carto fills/lines (Dark)
 *   → satellite clouds (cloudCutout.ts) → weather map → radar (radarLayer.ts) → Carto labels.
 */
const AERIAL = 'esri-aerial';
const STANDARD = 'carto-voyager';
const OWN = new Set([AERIAL, STANDARD]);
/** The raster each style shows (Dark shows Carto's own vector fills instead). */
const RASTER: Partial<Record<Basemap, string>> = { satellite: AERIAL, standard: STANDARD };

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
 * particles and HUD type stay readable.
 */
const PAINT: Record<string, Record<ColorMode, RasterPaint>> = {
  [AERIAL]: {
    mono: { saturation: -1, opacity: 1, brightnessMax: 0.6, contrast: 0 },
    color: { saturation: -0.1, opacity: 1, brightnessMax: 0.7, contrast: 0 },
  },
  // A light street map: full brightness; Mono grays it like the rest.
  [STANDARD]: {
    mono: { saturation: -1, opacity: 1, brightnessMax: 1, contrast: 0 },
    color: { saturation: 0, opacity: 1, brightnessMax: 1, contrast: 0 },
  },
};

/** Carto's labels on the light Standard map: dark type on a white halo (the style's own are light on dark). */
const LIGHT_LABELS = { 'text-color': '#3a3a3c', 'text-halo-color': 'rgba(255, 255, 255, 0.9)' } as const;
const savedLabels = new Map<string, Record<string, unknown>>();

export interface ImageryState {
  basemap: Basemap;
  colorMode: ColorMode;
}

/** Add all imagery layers in their resting state. Call once, after `load`. */
export function addImagery(map: MlMap, s: ImageryState): void {
  const layers = map.getStyle().layers;
  const firstVector = layers.find((l) => l.type !== 'background')?.id;

  map.addSource(AERIAL, { type: 'raster', tiles: [AERIAL_TILE_URL], tileSize: 256, maxzoom: 19 });
  addRaster(map, AERIAL, s.basemap === 'satellite', s.colorMode, firstVector);
  map.addSource(STANDARD, { type: 'raster', tiles: STANDARD_TILE_URLS, tileSize: 256, maxzoom: 20 });
  addRaster(map, STANDARD, s.basemap === 'standard', s.colorMode, firstVector);

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
 * Satellite and Standard: show that raster and hide Carto's fills and lines, keeping labels and
 * boundaries on top (a "hybrid" view); Standard's labels turn dark for the light map. Dark: Carto's
 * own vector map.
 */
export function setBasemap(map: MlMap, basemap: Basemap): void {
  if (!map.getLayer(AERIAL)) return;
  for (const id of OWN) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(RASTER[basemap] === id));
  const vector = basemap === 'dark';
  for (const l of map.getStyle().layers) {
    if (OWN.has(l.id) || /boundary/.test(l.id)) continue;
    if (l.type === 'fill' || l.type === 'line' || l.type === 'fill-extrusion') {
      map.setLayoutProperty(l.id, 'visibility', visibility(vector));
    }
    // The base style's labels (its vector tiles; the app's own symbols use GeoJSON and draw their own colors).
    if (l.type === 'symbol' && 'source' in l && map.getSource(l.source as string)?.type === 'vector') {
      if (!savedLabels.has(l.id)) {
        savedLabels.set(l.id, Object.fromEntries(Object.keys(LIGHT_LABELS).map((k) => [k, map.getPaintProperty(l.id, k as 'text-color')])));
      }
      const paint = basemap === 'standard' ? LIGHT_LABELS : savedLabels.get(l.id)!;
      for (const [k, v] of Object.entries(paint)) map.setPaintProperty(l.id, k as 'text-color', (v ?? undefined) as string | undefined);
    }
  }
}
