import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAP_STYLE_URL, INITIAL_ZOOM, MAX_ZOOM, MIN_ZOOM, type LatLon } from '../config';
import { fetchJson } from '../util/http';
import { desaturateStyle, renameLabels } from './style';

maplibregl.setWorkerUrl(workerUrl);

/** A plain dark fallback if the Carto style can't be fetched. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }],
};

async function loadStyle(): Promise<StyleSpecification> {
  try {
    const style = await fetchJson<StyleSpecification>(BASEMAP_STYLE_URL, { timeoutMs: 8000 });
    return renameLabels(desaturateStyle(style as StyleSpecification & { layers: { paint?: Record<string, unknown> }[] }));
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
