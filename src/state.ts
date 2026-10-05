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
  /** The point the HUD describes. */
  selected: LatLon;
}

type Listener = (s: AppState, prev: AppState) => void;

const PREFS_KEY = 'weather-map:prefs';

interface Prefs {
  tempUnit?: TempUnit;
  windUnit?: WindUnit;
  sound?: boolean;
  basemap?: Basemap;
  colorMode?: ColorMode;
  rainStreaks?: boolean;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
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
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage blocked: preferences last for this visit only.
  }
}

/** Tiny observable store. Layer toggles are deliberately not persisted. */
export function createStore(selected: LatLon) {
  const prefs = readPrefs();
  let state: AppState = {
    layers: { wind: true, rain: true, thunder: false, clouds: false },
    tempUnit: prefs.tempUnit === 'C' ? 'C' : 'F',
    windUnit: prefs.windUnit === 'kmh' ? 'kmh' : 'mph',
    sound: prefs.sound ?? true,
    basemap: prefs.basemap === 'satellite' ? 'satellite' : 'dark',
    colorMode: prefs.colorMode === 'color' ? 'color' : 'mono',
    rainStreaks: prefs.rainStreaks ?? true,
    selected,
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
        patch.rainStreaks !== undefined
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
