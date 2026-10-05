import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './styles.css';

import { CONDITIONS_REFRESH_MS, DEFAULT_LOCATION, DEFAULT_PLACE_LABEL, GRID_MAX_AGE_MS, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { geoPermission, getPosition } from './data/geolocate';
import { GridController } from './data/gridController';
import { Animator, type LayerFlags } from './layers/animator';
import { addRadar, createCrosshair, createMap, refreshRadar, setRadarStyle, setRadarVisible } from './map/map';
import { createStore, type AppState } from './state';
import { primeAudio, playCrackle } from './audio/crackle';
import { wrapLon } from './util/geo';
import { $, svg } from './ui/dom';
import { renderAlertTag, renderHud } from './ui/hud';
import { gearIcon, rainIcon, thunderIcon, windIcon } from './ui/icons';
import { showNote } from './ui/note';
import { alertsPanel, forecastPanel, settingsPanel } from './ui/panels';
import { Sheet } from './ui/sheet';

const LAYER_ICONS: Record<keyof LayerFlags, string> = { wind: windIcon, rain: rainIcon, thunder: thunderIcon };

async function main(): Promise<void> {
  // Geolocation: use it right away if already granted; otherwise start at the
  // default and move when (if) the person allows it.
  const permission = await geoPermission();
  let start: LatLon = DEFAULT_LOCATION;
  let located = false;
  if (permission === 'granted') {
    const p = await getPosition(5000);
    if (p) {
      start = p;
      located = true;
    }
  }

  const store = createStore(start);
  const sheet = new Sheet();
  let conditions: Conditions | null = null;

  // Static chrome.
  $('#gear').append(svg(gearIcon));
  document.querySelectorAll<HTMLButtonElement>('.layer-toggle').forEach((btn) => {
    const layer = btn.dataset.layer as keyof LayerFlags;
    btn.append(svg(LAYER_ICONS[layer]));
    btn.setAttribute('aria-pressed', String(store.get().layers[layer]));
  });
  renderHud(null, store.get());

  const map = await createMap($('#map'), start);
  map.once('load', () => addRadar(map, store.get().layers.rain, store.get().radarStyle));
  const crosshair = createCrosshair(map, start);

  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg').trim() || '#f0f0fa';
  const muted = css.getPropertyValue('--muted').trim() || '#8a8a96';
  // Rain streaks need the Rain layer on AND the falling-rain setting on; radar needs only the layer.
  const streaksOn = (s: AppState) => s.layers.rain && s.rainStreaks;
  const flags = (): LayerFlags => {
    const s = store.get();
    return { ...s.layers, rain: streaksOn(s) };
  };
  const animator = new Animator(map, $('#wind-canvas'), $('#fx-canvas'), flags, {
    wind: fg,
    rain: muted,
    lightning: fg,
  });
  animator.onStrike = () => {
    const s = store.get();
    if (s.sound && s.layers.thunder) playCrackle();
  };
  animator.start();

  const grids = new GridController(
    map,
    (g) => animator.setGrid(g),
    () => showNote('Wind and rain data unavailable. Retrying.'),
  );
  void grids.update(true);

  /* ---------- conditions for the selected point ---------- */

  let loadCtrl: AbortController | null = null;
  const refreshSheet = () => {
    if (!conditions) return;
    if (sheet.current === 'forecast') sheet.update(conditions.place ?? 'Forecast', forecastPanel(conditions, store.get()));
    if (sheet.current === 'alerts') sheet.update(alertsTitle(conditions), alertsPanel(conditions.alerts));
  };
  let lastLoaded = 0;
  /** New point: clear the HUD first. Refresh: keep showing the old values until new ones land. */
  const loadSelected = (newPoint: boolean) => {
    loadCtrl?.abort();
    loadCtrl = new AbortController();
    lastLoaded = Date.now();
    if (newPoint) {
      conditions = null;
      renderHud(null, store.get());
      renderAlertTag([]);
    }
    void loadConditions(store.get().selected, loadCtrl.signal, newPoint ? null : conditions, (c) => {
      conditions = c;
      renderHud(c, store.get());
      renderAlertTag(c.alerts);
      refreshSheet();
    });
  };

  let userPicked = false;
  const select = (p: LatLon, opts: { jump: boolean }) => {
    store.set({ selected: { lat: p.lat, lon: wrapLon(p.lon) } });
    // Marker keeps the raw longitude so it stays on the world copy that was tapped.
    crosshair.setLngLat([p.lon, p.lat]);
    if (opts.jump) map.jumpTo({ center: [p.lon, p.lat] });
    loadSelected(true);
    grids.refreshIfOlderThan(5 * 60_000);
  };

  loadSelected(true);

  if (!located && permission !== 'denied') {
    void getPosition(10_000).then((p) => {
      if (p && !userPicked) select(p, { jump: true });
      else if (!p) showNote(`Location unavailable. Showing ${DEFAULT_PLACE_LABEL}.`);
    });
  } else if (permission === 'denied') {
    showNote(`Location is off. Showing ${DEFAULT_PLACE_LABEL}.`);
  }

  // Tap empty map: describe that point. The camera stays where it is.
  map.on('click', (e) => {
    userPicked = true;
    select({ lat: e.lngLat.lat, lon: e.lngLat.lng }, { jump: false });
  });

  // Refresh only while visible: a locked phone or background tab costs no
  // battery and no API calls, and catches up as soon as it comes back.
  const refreshIfStale = () => {
    if (document.hidden) return;
    if (Date.now() - lastLoaded >= CONDITIONS_REFRESH_MS) loadSelected(false);
    grids.refreshIfOlderThan(GRID_MAX_AGE_MS);
    if (store.get().layers.rain) refreshRadar(map);
  };
  setInterval(refreshIfStale, 60_000);
  document.addEventListener('visibilitychange', refreshIfStale);

  /* ---------- layer toggles ---------- */

  document.querySelectorAll<HTMLButtonElement>('.layer-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer as keyof LayerFlags;
      // Turning Thunder on is the user gesture that unlocks audio.
      if (layer === 'thunder' && !store.get().layers.thunder) primeAudio();
      store.toggleLayer(layer);
    });
  });

  store.subscribe((s, prev) => {
    for (const layer of ['wind', 'rain', 'thunder'] as const) {
      const on = s.layers[layer];
      if (on === prev.layers[layer]) continue;
      document.querySelector(`.layer-toggle[data-layer="${layer}"]`)?.setAttribute('aria-pressed', String(on));
      if (layer === 'rain') setRadarVisible(map, on);
      else animator.layerChanged(layer, on);
      if (layer === 'thunder' && on) {
        if (!grids.current) showNote('Storm data loading');
        else if (!animator.stormsInView()) showNote('No thunderstorms in view');
      }
    }
    if (streaksOn(s) !== streaksOn(prev)) animator.layerChanged('rain', streaksOn(s));
    if (s.radarStyle !== prev.radarStyle) setRadarStyle(map, s.radarStyle);
    if (s.tempUnit !== prev.tempUnit || s.windUnit !== prev.windUnit) {
      renderHud(conditions, s);
      refreshSheet();
    }
  });

  /* ---------- sheets ---------- */

  const gear = $('#gear');
  gear.addEventListener('click', () => {
    sheet.open(
      'settings',
      'Settings',
      settingsPanel(store, {
        place: () => conditions?.place ?? DEFAULT_PLACE_LABEL,
        pickPlace: (lat, lon) => {
          userPicked = true;
          select({ lat, lon }, { jump: true });
          sheet.close();
        },
        useMyLocation: async () => {
          const p = await getPosition(10_000);
          if (!p) return false;
          userPicked = true;
          select(p, { jump: true });
          sheet.close();
          return true;
        },
      }),
      gear,
    );
  });

  const alertTag = $('#alert-tag');
  alertTag.addEventListener('click', () => {
    if (conditions) sheet.open('alerts', alertsTitle(conditions), alertsPanel(conditions.alerts), alertTag);
  });

  const readout = $('#hud-readout');
  readout.addEventListener('click', () => {
    if (conditions) sheet.open('forecast', conditions.place ?? 'Forecast', forecastPanel(conditions, store.get()), readout);
  });
}

function alertsTitle(c: Conditions): string {
  return c.alerts.length === 1 ? 'Active alert' : `${c.alerts.length} active alerts`;
}

void main();
