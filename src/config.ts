export interface LatLon {
  lat: number;
  lon: number;
}

/** Radar look: grayscale (DESIGN.md default) or the NWS color intensity scale. */
export type RadarStyle = 'mono' | 'color';

/** Used when geolocation is denied, unavailable, or slow. */
export const DEFAULT_LOCATION: LatLon = { lat: 29.0491, lon: -82.4612 };
export const DEFAULT_PLACE_LABEL = 'Dunnellon, FL';

export const INITIAL_ZOOM = 7;
export const MIN_ZOOM = 2.5;
export const MAX_ZOOM = 13;

/**
 * NWS asks every client to identify itself with an app name and a contact.
 * Browsers that refuse to let scripts set User-Agent (Chrome, Safari) send their
 * own; Firefox sends this one. Set VITE_NWS_USER_AGENT in .env.local.
 */
export const NWS_USER_AGENT =
  (import.meta.env.VITE_NWS_USER_AGENT as string | undefined)?.trim() ||
  'WeatherMap/1.0 (contact@example.com)';

export const NWS_BASE = 'https://api.weather.gov';
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

/** Carto Dark Matter (vector). Credit: © CARTO © OpenStreetMap contributors. */
export const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** NWS base reflectivity mosaic (ArcGIS export), drawn grayscale under the rain layer. */
export const RADAR_TILE_URL =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/export' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';

/** Open-Meteo grid: aim for this many points per request (each point counts as one API call). */
export const GRID_TARGET_POINTS = 40;
/** Never fetch a new grid more often than this, unless the view left the old grid. */
export const GRID_MIN_INTERVAL_MS = 45_000;
/** Data older than this is refetched on the next settle. */
export const GRID_MAX_AGE_MS = 15 * 60_000;
export const CONDITIONS_REFRESH_MS = 10 * 60_000;
export const RADAR_REFRESH_MS = 5 * 60_000;
