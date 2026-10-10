import type { Basemap, ColorMode, LatLon } from './config';
import type { ModelGroup } from './data/tropical';
import { WEATHER_MAPS, type WeatherMapId } from './maps/catalog';
import type { OutlookDay, OutlookKind } from './data/outlooks';
import { readTags, type Tag } from './data/tags';

export type Theme = 'liquid' | 'classic';
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

export const DEFAULT_TROPICS: TropicalOptions = {
  cone: true,
  track: true,
  models: true,
  past: true,
  warnings: true,
  windField: true,
  windProb: 0,
  arrival: false,
  surge: true,
  outlook: true,
  sst: false,
};

export const DEFAULT_MODEL_GROUPS: ModelGroup[] = ['official', 'consensus', 'hurricane', 'global', 'ensembleMean', 'member'];

export interface AppState {
  /** `clouds`: satellite clouds, cut out of live GOES imagery. `tropics`: hurricanes (NHC forecasts and model tracks), shown only while storms are active. */
  /** `outlook`: SPC severe-storm or WPC flash-flood outlook areas (`outlookKind`, `outlookDay`). */
  /** `cells`: strong storm cells and where they're headed (radar storm tracking). */
  layers: { wind: boolean; rain: boolean; thunder: boolean; clouds: boolean; tropics: boolean; outlook: boolean; cells: boolean };
  tempUnit: TempUnit;
  windUnit: WindUnit;
  sound: boolean;
  /** Base map: dark vector (default) or aerial imagery. */
  basemap: Basemap;
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
  colorMode?: ColorMode;
  rainStreaks?: boolean;
  precipType?: boolean;
  alertAreas?: boolean;
  theme?: Theme;
  /** The weather card's pin (2026-10-09: pinned by default; replaces the old followMap key). */
  pinned?: boolean;
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
      colorMode: s.colorMode,
      rainStreaks: s.rainStreaks,
      precipType: s.precipType,
      alertAreas: s.alertAreas,
      theme: s.theme,
      pinned: !s.followMap,
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

/** Model groups saved before they moved into prefs (2026-10-06). */
function legacyGroups(): ModelGroup[] | null {
  try {
    const v = JSON.parse(localStorage.getItem('weather-map:models:v1') ?? 'null') as ModelGroup[] | null;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Tiny observable store. Layer toggles are deliberately not persisted. */
export function createStore(selected: LatLon, gps: boolean) {
  const prefs = readPrefs();
  let state: AppState = {
    layers: { wind: true, rain: true, thunder: false, clouds: false, tropics: true, outlook: false, cells: true },
    tempUnit: prefs.tempUnit === 'C' ? 'C' : 'F',
    windUnit: prefs.windUnit === 'kmh' ? 'kmh' : 'mph',
    sound: prefs.sound ?? true,
    basemap: prefs.basemap === 'dark' ? 'dark' : 'satellite',
    colorMode: prefs.colorMode === 'mono' ? 'mono' : 'color',
    rainStreaks: prefs.rainStreaks ?? false,
    precipType: prefs.precipType ?? true,
    alertAreas: prefs.alertAreas ?? true,
    theme: prefs.theme === 'classic' ? 'classic' : 'liquid',
    followMap: prefs.pinned === false,
    tropics: { ...DEFAULT_TROPICS, ...prefs.tropics },
    modelGroups: Array.isArray(prefs.modelGroups) ? prefs.modelGroups : legacyGroups() ?? DEFAULT_MODEL_GROUPS,
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
        patch.colorMode ||
        patch.sound !== undefined ||
        patch.rainStreaks !== undefined ||
        patch.precipType !== undefined ||
        patch.alertAreas !== undefined ||
        patch.theme !== undefined ||
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
