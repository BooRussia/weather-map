import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAP_STYLE_URL, INITIAL_ZOOM, MAX_ZOOM, MIN_ZOOM, RADAR_REFRESH_MS, RADAR_TILE_URL, type LatLon } from '../config';
import { fetchJson } from '../util/http';
import { desaturateStyle } from './style';

maplibregl.setWorkerUrl(workerUrl);

const RADAR_SOURCE = 'nws-radar';
const RADAR_LAYER = 'nws-radar';

/** A plain dark fallback if the Carto style can't be fetched. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }],
};

async function loadStyle(): Promise<StyleSpecification> {
  try {
    const style = await fetchJson<StyleSpecification>(BASEMAP_STYLE_URL, { timeoutMs: 8000 });
    return desaturateStyle(style as StyleSpecification & { layers: { paint?: Record<string, unknown> }[] });
  } catch {
    return FALLBACK_STYLE;
  }
}

export async function createMap(container: HTMLElement, center: LatLon): Promise<MlMap> {
  const style = await loadStyle();
  const map = new maplibregl.Map({
    container,
    style,
    center: [center.lon, center.lat],
    zoom: INITIAL_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    attributionControl: false,
    // No rotation or pitch: keeps the map north-up so particles can use a
    // separable screen projection.
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // Resolve before tiles load: projection works now, so data and particles
  // can start while the basemap is still streaming in.
  return map;
}

/** NWS reflectivity mosaic, drawn grayscale beneath the basemap labels. Call after `load`. */
export function addRadar(map: MlMap, visible: boolean): void {
  map.addSource(RADAR_SOURCE, {
    type: 'raster',
    tiles: [radarTiles()],
    tileSize: 256,
    minzoom: 3,
    maxzoom: 10,
  });
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer(
    {
      id: RADAR_LAYER,
      type: 'raster',
      source: RADAR_SOURCE,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'raster-saturation': -1,
        'raster-opacity': 0.3,
        'raster-brightness-max': 0.75,
        'raster-fade-duration': 0,
      },
    },
    firstSymbol,
  );
}

const radarBucket = () => Math.floor(Date.now() / RADAR_REFRESH_MS);
let loadedBucket = radarBucket();

/** Cache-bust per 5-minute bucket so tiles refresh as new scans arrive. */
function radarTiles(): string {
  loadedBucket = radarBucket();
  return `${RADAR_TILE_URL}&_t=${loadedBucket}`;
}

/** Reload radar tiles, but only once a new 5-minute bucket has started. Safe to call often. */
export function refreshRadar(map: MlMap): void {
  if (radarBucket() === loadedBucket) return;
  const src = map.getSource(RADAR_SOURCE) as maplibregl.RasterTileSource | undefined;
  src?.setTiles([radarTiles()]);
}

export function setRadarVisible(map: MlMap, visible: boolean): void {
  if (map.getLayer(RADAR_LAYER)) map.setLayoutProperty(RADAR_LAYER, 'visibility', visible ? 'visible' : 'none');
}

/** Thin crosshair marking the point the HUD describes. */
export function createCrosshair(map: MlMap, at: LatLon): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'crosshair';
  el.setAttribute('aria-hidden', 'true');
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([at.lon, at.lat]).addTo(map);
}
