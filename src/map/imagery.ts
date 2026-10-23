import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { AERIAL_TILE_URL, STANDARD_STYLE_URL, type Basemap, type ColorMode } from '../config';
import { fetchJson } from '../util/http';
import { desaturateStyle } from './style';

/**
 * Raster imagery layers. Stack, bottom to top:
 *   Carto background → aerial (Satellite) → Carto fills/lines (Standard, Dark)
 *   → satellite clouds (cloudCutout.ts) → weather map → radar (radarLayer.ts) → Carto labels.
 */
const AERIAL = 'esri-aerial';
const OWN = new Set([AERIAL]);

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
};

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

  setBasemap(map, s.basemap, s.colorMode);
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

type Paints = Map<string, Record<string, unknown>>;

/** The dark style's paint, as loaded (grayscale), to put back after Standard. */
let darkPaints: Paints | null = null;
/** Voyager's paint by layer id, fetched the first time Standard is picked. */
let voyager: Promise<Paints> | null = null;
/** The latest look asked for, so a slow Voyager fetch doesn't repaint after you've moved on. */
let wanted = '';

function voyagerPaints(): Promise<Paints> {
  voyager ??= fetchJson<StyleSpecification>(STANDARD_STYLE_URL, { timeoutMs: 10_000 })
    .then((style) => new Map(style.layers.map((l) => [l.id, ('paint' in l ? l.paint : undefined) ?? {}] as [string, Record<string, unknown>])))
    .catch((e: unknown) => {
      voyager = null;
      throw e;
    });
  return voyager;
}

/** The base style's own layers (its vector tiles), not the app's (GeoJSON, rasters, custom). */
function baseLayers(map: MlMap) {
  return map.getStyle().layers.filter((l) => l.type === 'background' || ('source' in l && map.getSource(l.source as string)?.type === 'vector'));
}

function paint(map: MlMap, look: Paints, fallback: Paints | null): void {
  for (const l of baseLayers(map)) {
    const next = look.get(l.id) ?? {};
    const keys = new Set([...Object.keys(next), ...Object.keys(fallback?.get(l.id) ?? {})]);
    for (const k of keys) map.setPaintProperty(l.id, k as 'fill-color', next[k] as string | undefined);
  }
}

/**
 * Satellite: aerial imagery, with Carto's fills and lines hidden and its labels and boundaries on top (a
 * "hybrid" view). Standard: Carto's map in Voyager's colors (a light street map, labels dark on white).
 * Dark: Carto's map as loaded. Mono grays Voyager like everything else.
 */
export function setBasemap(map: MlMap, basemap: Basemap, mode: ColorMode): void {
  if (!map.getLayer(AERIAL)) return;
  map.setLayoutProperty(AERIAL, 'visibility', visibility(basemap === 'satellite'));
  const base = baseLayers(map);
  darkPaints ??= new Map(base.map((l) => [l.id, { ...(('paint' in l ? l.paint : undefined) ?? {}) } as Record<string, unknown>]));
  for (const l of base) {
    if (/boundary/.test(l.id)) continue;
    if (l.type === 'fill' || l.type === 'line' || l.type === 'fill-extrusion') {
      map.setLayoutProperty(l.id, 'visibility', visibility(basemap !== 'satellite'));
    }
  }
  const key = `${basemap} ${mode}`;
  wanted = key;
  if (basemap !== 'standard') {
    paint(map, darkPaints, darkPaints);
    return;
  }
  void voyagerPaints()
    .then((v) => {
      if (wanted !== key) return;
      const look = mode === 'mono' ? grayed(v) : v;
      paint(map, look, darkPaints);
    })
    .catch(() => {
      // No Voyager colors (offline): Standard stays the dark map until the next try.
    });
}

function grayed(v: Paints): Paints {
  const layers = [...v].map(([id, p]) => ({ id, paint: structuredClone(p) }));
  desaturateStyle({ layers });
  return new Map(layers.map((l) => [l.id, l.paint]));
}
