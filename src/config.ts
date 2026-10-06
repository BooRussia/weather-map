export interface LatLon {
  lat: number;
  lon: number;
}

/** Imagery colors: grayscale (DESIGN.md default) or real colors (NWS radar scale, true-color ground). */
export type ColorMode = 'mono' | 'color';

/** Base map: Carto Dark Matter vector, or Esri aerial imagery with the Carto labels on top. */
export type Basemap = 'dark' | 'satellite';

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

/** Carto Dark Matter (vector). Credit: © CARTO © OpenStreetMap contributors. */
export const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** NWS base reflectivity mosaic (ArcGIS export), under the rain streaks. */
export const RADAR_TILE_URL =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/export' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';

/** Same mosaic, time-enabled (last ~2 hours), for the radar loop. Append &time=<epoch ms>. */
export const RADAR_TIME_URL =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';

/** Live clouds: NOAA nowCOAST GOES East + West longwave infrared (works day and night, minutes old). */
export const CLOUDS_TILE_URL =
  'https://nowcoast.noaa.gov/geoserver/satellite/wms?service=WMS&version=1.3.0&request=GetMap' +
  '&layers=goes_longwave_imagery&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256' +
  '&format=image/png&transparent=true';

/** Aerial imagery. Credit: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. */
export const AERIAL_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Open-Meteo grid: aim for this many points per request (each point counts as one API call). */
export const GRID_TARGET_POINTS = 40;
/** Never fetch a new grid more often than this, unless the view left the old grid. */
export const GRID_MIN_INTERVAL_MS = 45_000;
/** Data older than this is refetched on the next settle. */
export const GRID_MAX_AGE_MS = 15 * 60_000;
export const CONDITIONS_REFRESH_MS = 10 * 60_000;
/** Radar and cloud tiles are re-requested once per bucket of this length. */
export const IMAGERY_REFRESH_MS = 5 * 60_000;

/* ---------- radar timeline ---------- */

/** Hours of past radar on the timeline (hourly stops). */
export const TIMELINE_PAST_HOURS = 24;
/** HRRR forecasts run 18 hours from each hourly init. */
export const HRRR_MAX_MINUTES = 18 * 60;

/** Archived NEXRAD composite (IEM): `{stamp}` = UTC YYYYMMDDHHMM. */
export const PAST_RADAR_TILE_URL =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-{stamp}/{z}/{x}/{y}.png';
/** HRRR simulated reflectivity (IEM): `{minutes}` = 4-digit forecast minute, `{init}` = UTC YYYYMMDDHHMM. */
export const FUTURE_RADAR_TILE_URL =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F{minutes}-{init}/{z}/{x}/{y}.png';
/**
 * IEM serves the same tiles from four hostnames, over HTTP/1.1. Browsers open
 * six connections per host, so spreading a frame's tiles across all four lets
 * playback load four times as many at once.
 */
export const IEM_HOSTS = ['mesonet', 'mesonet1', 'mesonet2', 'mesonet3'];
/** Latest HRRR run time (IEM). */
export const HRRR_META_URL = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0000.json';
