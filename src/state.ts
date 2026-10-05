import type { Basemap, ColorMode, LatLon } from './config';
import type { TempUnit, WindUnit } from './util/units';

export interface AppState {
  layers: { wind: boolean; rain: boolean; thunder: boolean; clouds: boolean };
  tempUnit: TempUnit;
  windUnit: WindUnit;
  sound: boolean;
  /** Base map: dark vector (default) or aerial imagery. */
  basemap: Basemap;
  /** Imagery colors: grayscale (default) or real colors on radar and aerial imagery. */
  colorMode: ColorMode;
  /** Falling rain streaks on top of the radar. The Rain button still hides both. */
  rainStreaks: boolean;
  /** NWS warning/watch areas drawn on the map in the accent. */
  alertAreas: boolean;
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
  alertAreas?: boolean;
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
      alertAreas: s.alertAreas,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage blocked: preferences last for this visit only.
  }
}

/** Tiny observable store. Layer toggles are deliberately not persisted. */
export function createStore(selected: LatLon, gps: boolean) {
  const prefs = readPrefs();
  let state: AppState = {
    layers: { wind: true, rain: true, thunder: false, clouds: false },
    tempUnit: prefs.tempUnit === 'C' ? 'C' : 'F',
    windUnit: prefs.windUnit === 'kmh' ? 'kmh' : 'mph',
    sound: prefs.sound ?? true,
    basemap: prefs.basemap === 'dark' ? 'dark' : 'satellite',
    colorMode: prefs.colorMode === 'mono' ? 'mono' : 'color',
    rainStreaks: prefs.rainStreaks ?? false,
    alertAreas: prefs.alertAreas ?? true,
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
        patch.alertAreas !== undefined
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
