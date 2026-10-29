import type { Basemap, ColorMode, LatLon } from './config';
import type { ModelGroup } from './data/tropical';
import { WEATHER_MAPS, type WeatherMapId } from './maps/catalog';
import type { OutlookDay, OutlookKind } from './data/outlooks';
import { readTags, type Tag } from './data/tags';

export type Theme = 'liquid' | 'classic';
/** What the phone banner's strip shows at full size: the days, or the hours. */
export type BannerForecast = 'daily' | 'hourly';
/** What the small banner's graphs cover: today by the hour, or the ten days, a dot a day. */
export type BannerGraphs = 'today' | 'week';
/** What the small banner shows under the place: the graphs, or the strip (the days or the hours). */
export type SmallBanner = 'graphs' | 'forecast';
import type { TempUnit, WindUnit } from './util/units';

/** What the Hurricanes layer shows (the dropdown under it in Layers). */
export interface TropicalOptions {
  cone: boolean;
  /** Forecast track and points. */
  track: boolean;
  /** Spaghetti models; which groups is `modelGroups`. */
  models: boolean;
  past: boolean;
  warnings: boolean;
  /** Current extent of tropical-storm- and hurricane-force winds. */
  windField: boolean;
  /** Wind-speed odds: off (0), or the threshold in kt. */
  windProb: 0 | 34 | 50 | 64;
  /** Most likely arrival time of tropical-storm-force winds. */
  arrival: boolean;
  /** Potential storm surge flooding, when NHC issues it. */
  surge: boolean;
  /** Seven-day development outlook areas. */
  outlook: boolean;
  /** Sea surface temperature. */
  sst: boolean;
}

/**
 * First load shows only the essentials (owner, 2026-10-10: everything at once was too cluttered):
 * where the storm is going (cone and track), where it's been, the coast's warnings, and storms that may
 * form. The rest is one tap away in Layers → Hurricanes.
 */
export const DEFAULT_TROPICS: TropicalOptions = {
  cone: true,
  track: true,
  models: false,
  past: true,
  warnings: true,
  windField: false,
  windProb: 0,
  arrival: false,
  surge: false,
  outlook: true,
  sst: false,
};

/** Spaghetti groups when first switched on: the main models; ensemble means and members are opt-in. */
export const DEFAULT_MODEL_GROUPS: ModelGroup[] = ['official', 'consensus', 'hurricane', 'global'];

/** Saved hurricane choices from before this version give way to the defaults above, once. */
const TROPICS_PREFS_V = 2;
/** Saved state/county line choices from when they were off by default give way to on, once. */
const LINES_PREFS_V = 1;

export interface AppState {
  /** `clouds`: satellite clouds, cut out of live GOES imagery. `tropics`: hurricanes (NHC forecasts and model tracks), shown only while storms are active. */
  /** `outlook`: SPC severe-storm or WPC flash-flood outlook areas (`outlookKind`, `outlookDay`). */
  /** `cells`: strong storm cells and where they're headed (radar storm tracking). */
  /** `cams`: state DOTs' traffic cameras (off on first load; the camera button). */
  /** `fires`: burning wildfires and their edges (NIFC); `rivers`: river gauges by flood status (NWS); `airports`: METAR flight categories (AWC). */
  layers: {
    wind: boolean;
    rain: boolean;
    thunder: boolean;
    clouds: boolean;
    tropics: boolean;
    outlook: boolean;
    cells: boolean;
    cams: boolean;
    fires: boolean;
    rivers: boolean;
    airports: boolean;
  };
  tempUnit: TempUnit;
  windUnit: WindUnit;
  sound: boolean;
  /** Base map: aerial imagery (default), a standard street map, or dark vector. */
  basemap: Basemap;
  /** State borders over the map, at every zoom. */
  stateLines: boolean;
  /** County borders over the map, once zoomed in to about a state (COUNTY_MIN_ZOOM). */
  countyLines: boolean;
  /** Live traffic speeds on the roads (TomTom; with a key); on at each visit, like the other layers' first state. */
  traffic: boolean;
  /** Imagery colors: grayscale (default) or real colors on radar and aerial imagery. */
  colorMode: ColorMode;
  /** Falling rain streaks on top of the radar. The Rain button still hides both. */
  rainStreaks: boolean;
  /** Radar colored by what's falling: rain, snow, mix (sleet), ice (freezing rain). */
  precipType: boolean;
  /** NWS warning/watch areas drawn on the map in the accent. */
  alertAreas: boolean;
  /** Liquid (Apple-like, default) or Classic (the original black-and-amber). */
  theme: Theme;
  /** Phones: the full banner's strip, ten days (default) or the hours ahead (owner, 2026-10-24). */
  bannerForecast: BannerForecast;
  /**
   * The small banner's graphs (owner, 2026-10-29): today (the default) or the ten days. The full
   * banner's graphs follow its strip instead: the days under the days, the hours under the hours.
   */
  bannerGraphs: BannerGraphs;
  /** The small banner's row (owner, 2026-10-29): the graphs (default) or the forecast; a sideways swipe on it swaps them. */
  smallBanner: SmallBanner;
  /** Notifications for where you are (owner, 2026-10-29): new warnings and watches, and rain about to start. */
  notify: boolean;
  /** The weather page's pilot cards (winds aloft and the sounding), off by default so it stays simple. */
  pilotCards: boolean;
  /**
   * Moving the map moves the readout to the center cross. Off (the default, the pin on the weather
   * card): the readout stays on your location, or the place it shows, while you look around.
   */
  followMap: boolean;
  tropics: TropicalOptions;
  /** Spaghetti model groups drawn. */
  modelGroups: ModelGroup[];
  /** The colored weather map under everything (Windy's layers), or none. */
  weatherMap: WeatherMapId;
  outlookKind: OutlookKind;
  outlookDay: OutlookDay;
  /** The day's storm reports with the storm cells. */
  stormReports: boolean;
  /** Places tagged on the map (kept on the device). */
  tags: Tag[];
  /** The point the HUD describes. */
  selected: LatLon;
  /** The selected point came from the device location (shows the GPS arrow). */
  gps: boolean;
}

type Listener = (s: AppState, prev: AppState) => void;

/** v2: the owner changed the defaults (Satellite, Color, falling rain off) on 2026-10-05. */
const PREFS_KEY = 'weather-map:prefs:v2';
const PREFS_KEY_V1 = 'weather-map:prefs';

interface Prefs {
  tempUnit?: TempUnit;
  windUnit?: WindUnit;
  sound?: boolean;
  basemap?: Basemap;
  stateLines?: boolean;
  countyLines?: boolean;
  /** Which border defaults stateLines and countyLines were saved under (LINES_PREFS_V). */
  linesV?: number;
  colorMode?: ColorMode;
  rainStreaks?: boolean;
  precipType?: boolean;
  alertAreas?: boolean;
  theme?: Theme;
  bannerForecast?: BannerForecast;
  bannerGraphs?: BannerGraphs;
  smallBanner?: SmallBanner;
  notify?: boolean;
  pilotCards?: boolean;
  /** The weather card's pin (2026-10-09: pinned by default; replaces the old followMap key). */
  pinned?: boolean;
  /** Which hurricane defaults `tropics` and `modelGroups` were saved under (TROPICS_PREFS_V). */
  tropicsV?: number;
  tropics?: Partial<TropicalOptions>;
  modelGroups?: ModelGroup[];
  weatherMap?: WeatherMapId;
  outlookKind?: OutlookKind;
  outlookDay?: OutlookDay;
  stormReports?: boolean;
  tags?: Tag[];
}

function readPrefs(): Prefs {
  try {
    const v2 = localStorage.getItem(PREFS_KEY);
    if (v2) return JSON.parse(v2) as Prefs;
    // From v1, keep personal choices; the map look resets to the new defaults.
    const v1 = JSON.parse(localStorage.getItem(PREFS_KEY_V1) ?? '{}') as Prefs;
    return { tempUnit: v1.tempUnit, windUnit: v1.windUnit, sound: v1.sound, alertAreas: v1.alertAreas };
  } catch {
    return {};
  }
}

function writePrefs(s: AppState): void {
  try {
    const p: Prefs = {
      tempUnit: s.tempUnit,
      windUnit: s.windUnit,
      sound: s.sound,
      basemap: s.basemap,
      stateLines: s.stateLines,
      countyLines: s.countyLines,
      linesV: LINES_PREFS_V,
      colorMode: s.colorMode,
      rainStreaks: s.rainStreaks,
      precipType: s.precipType,
      alertAreas: s.alertAreas,
      theme: s.theme,
      bannerForecast: s.bannerForecast,
      bannerGraphs: s.bannerGraphs,
      smallBanner: s.smallBanner,
      notify: s.notify,
      pilotCards: s.pilotCards,
      pinned: !s.followMap,
      tropicsV: TROPICS_PREFS_V,
      tropics: s.tropics,
      modelGroups: s.modelGroups,
      weatherMap: s.weatherMap,
      outlookKind: s.outlookKind,
      outlookDay: s.outlookDay,
      stormReports: s.stormReports,
      tags: s.tags,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage blocked: preferences last for this visit only.
  }
}

/** Tiny observable store. Layer toggles are deliberately not persisted. */
export function createStore(selected: LatLon, gps: boolean) {
  const prefs = readPrefs();
  // Hurricane choices saved under the old everything-on defaults start over from the new ones.
  const tropicsCurrent = prefs.tropicsV === TROPICS_PREFS_V;
  const linesCurrent = prefs.linesV === LINES_PREFS_V;
  let state: AppState = {
    // Hurricanes off on first load too (owner, 2026-10-23): the hurricane button turns them on.
    layers: { wind: true, rain: true, thunder: false, clouds: false, tropics: false, outlook: false, cells: false, cams: false, fires: false, rivers: false, airports: false },
    tempUnit: prefs.tempUnit === 'C' ? 'C' : 'F',
    windUnit: prefs.windUnit === 'kmh' || prefs.windUnit === 'kt' ? prefs.windUnit : 'mph',
    sound: prefs.sound ?? true,
    basemap: prefs.basemap === 'dark' || prefs.basemap === 'standard' ? prefs.basemap : 'satellite',
    // On by default (owner, 2026-10-23); choices saved under the old off defaults start over, once.
    stateLines: (linesCurrent ? prefs.stateLines : undefined) ?? true,
    countyLines: (linesCurrent ? prefs.countyLines : undefined) ?? true,
    traffic: true,
    colorMode: prefs.colorMode === 'mono' ? 'mono' : 'color',
    rainStreaks: prefs.rainStreaks ?? false,
    precipType: prefs.precipType ?? true,
    alertAreas: prefs.alertAreas ?? true,
    theme: prefs.theme === 'classic' ? 'classic' : 'liquid',
    bannerForecast: prefs.bannerForecast === 'hourly' ? 'hourly' : 'daily',
    bannerGraphs: prefs.bannerGraphs === 'week' ? 'week' : 'today',
    smallBanner: prefs.smallBanner === 'forecast' ? 'forecast' : 'graphs',
    notify: prefs.notify === true,
    pilotCards: prefs.pilotCards === true,
    followMap: prefs.pinned === false,
    tropics: { ...DEFAULT_TROPICS, ...(tropicsCurrent ? prefs.tropics : {}) },
    modelGroups: tropicsCurrent && Array.isArray(prefs.modelGroups) ? prefs.modelGroups : DEFAULT_MODEL_GROUPS,
    weatherMap: WEATHER_MAPS.some((m) => m.id === prefs.weatherMap) ? prefs.weatherMap! : 'none',
    outlookKind: prefs.outlookKind === 'flood' ? 'flood' : 'severe',
    outlookDay: prefs.outlookDay === 2 || prefs.outlookDay === 3 ? prefs.outlookDay : 1,
    stormReports: prefs.stormReports ?? false,
    tags: readTags(prefs.tags),
    selected,
    gps,
  };
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set(patch: Partial<AppState>) {
      const prev = state;
      state = { ...state, ...patch };
      if (
        patch.tempUnit ||
        patch.windUnit ||
        patch.basemap ||
        patch.stateLines !== undefined ||
        patch.countyLines !== undefined ||
        patch.colorMode ||
        patch.sound !== undefined ||
        patch.rainStreaks !== undefined ||
        patch.precipType !== undefined ||
        patch.alertAreas !== undefined ||
        patch.theme !== undefined ||
        patch.bannerForecast !== undefined ||
        patch.bannerGraphs !== undefined ||
        patch.smallBanner !== undefined ||
        patch.notify !== undefined ||
        patch.pilotCards !== undefined ||
        patch.followMap !== undefined ||
        patch.tropics !== undefined ||
        patch.modelGroups !== undefined ||
        patch.weatherMap !== undefined ||
        patch.outlookKind !== undefined ||
        patch.outlookDay !== undefined ||
        patch.stormReports !== undefined ||
        patch.tags !== undefined
      ) {
        writePrefs(state);
      }
      listeners.forEach((l) => l(state, prev));
    },
    toggleLayer(layer: keyof AppState['layers']) {
      this.set({ layers: { ...state.layers, [layer]: !state.layers[layer] } });
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
