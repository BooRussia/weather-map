import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './styles.css';

import { CONDITIONS_REFRESH_MS, DEFAULT_LOCATION, DEFAULT_PLACE_LABEL, GRID_MAX_AGE_MS, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { geoPermission, getPosition } from './data/geolocate';
import { GridController } from './data/gridController';
import { Animator, type LayerFlags } from './layers/animator';
import { createCrosshair, createMap } from './map/map';
import { addImagery, refreshImagery, setBasemap, setColorMode, setImageryVisible } from './map/imagery';
import { AlertAreas } from './map/alertAreas';
import { RadarTimeline } from './map/radarTimeline';
import { makeTimeline, offsetTime, utcHourKey } from './data/timeline';
import { getHrrrInit } from './data/hrrr';
import { createStore, type AppState } from './state';
import { primeAudio, playCrackle } from './audio/crackle';
import { wrapLon } from './util/geo';
import { $, svg } from './ui/dom';
import { renderAlertTag, renderHud } from './ui/hud';
import { chevronIcon, closeIcon, cloudsIcon, gearIcon, gpsIcon, rainIcon, thunderIcon, warningIcon, windIcon } from './ui/icons';
import { showNote } from './ui/note';
import { alertsPanel, detailPanel, settingsPanel } from './ui/panels';
import { TimelineBar } from './ui/timelineBar';
import { Sheet } from './ui/sheet';

type Layer = keyof AppState['layers'];
const LAYERS: Layer[] = ['wind', 'rain', 'thunder', 'clouds'];
const LAYER_ICONS: Record<Layer, string> = { wind: windIcon, rain: rainIcon, thunder: thunderIcon, clouds: cloudsIcon };

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

  const store = createStore(start, located);
  const sheet = new Sheet();
  let conditions: Conditions | null = null;

  // Static chrome.
  $('#gear').append(svg(gearIcon));
  $('#hud-gps').append(svg(gpsIcon));
  $('#hud-chevron').append(svg(chevronIcon));
  $('#alert-tag').prepend(svg(warningIcon));
  $('#side-close').append(svg(closeIcon));
  document.querySelectorAll<HTMLButtonElement>('.layer-toggle').forEach((btn) => {
    const layer = btn.dataset.layer as Layer;
    btn.append(svg(LAYER_ICONS[layer]));
    btn.setAttribute('aria-pressed', String(store.get().layers[layer]));
  });
  renderHud(null, store.get());
  renderCredits(store.get());

  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg').trim() || '#f0f0fa';
  const muted = css.getPropertyValue('--muted').trim() || '#8a8a96';
  const accent = css.getPropertyValue('--accent').trim() || '#f5a623';

  const map = await createMap($('#map'), start);
  const alertAreas = new AlertAreas(map, accent, store.get().alertAreas);
  map.once('load', () => {
    const s = store.get();
    addImagery(map, { radar: s.layers.rain, clouds: s.layers.clouds, basemap: s.basemap, colorMode: s.colorMode });
    alertAreas.install();
  });
  const crosshair = createCrosshair(map, start);

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

  /* ---------- timeline: 24 h of radar history into the HRRR forecast ---------- */

  let hrrrInit: number | null = null;
  let timeline = makeTimeline(Date.now(), hrrrInit);
  const frames = new RadarTimeline(map, timeline, store.get().colorMode, store.get().layers.rain);
  // Radar frames and the wind/rain particles follow the same hour.
  const bar = new TimelineBar(timeline, (offset, direction) => {
    frames.show(offset, direction);
    // Past and forecast frames come from Iowa Environmental Mesonet: credit them while shown.
    $('[data-credit="iem"]').hidden = offset === 0;
    grids.setHour(offset === 0 ? null : utcHourKey(offsetTime(timeline, offset)));
  });
  const renderBar = () => bar.render({ colorMode: store.get().colorMode, radarOn: store.get().layers.rain });
  renderBar();
  map.once('load', () => frames.show(bar.offset));

  const refreshTimeline = () => {
    const next = makeTimeline(Date.now(), hrrrInit);
    if (next.base === timeline.base && next.maxOffset === timeline.maxOffset && next.init === timeline.init) return;
    timeline = next;
    frames.setTimeline(next);
    bar.setTimeline(next);
  };
  let hrrrCheckedAt = 0;
  const refreshHrrr = async () => {
    hrrrCheckedAt = Date.now();
    try {
      hrrrInit = await getHrrrInit();
      refreshTimeline();
    } catch {
      // No forecast frames until the next check; past radar still works.
    }
  };
  void refreshHrrr();

  // Desktop keyboard: Space plays/pauses, arrows step an hour, Home jumps to now.
  document.addEventListener('keydown', (e) => {
    if (sheet.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, button, a') && t.id !== 'tl-range') return;
    if (e.key === ' ') {
      e.preventDefault();
      bar.toggle();
    } else if (t.id !== 'tl-range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      bar.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Home' && t.id !== 'tl-range') {
      e.preventDefault();
      bar.now();
    }
  });

  /* ---------- conditions for the selected point ---------- */

  let loadCtrl: AbortController | null = null;
  // The detail sheet's alert rows open the full alert text in the same sheet.
  const detailActions = {
    openAlerts: () => {
      if (conditions) sheet.open('alerts', alertsTitle(conditions), alertsPanel(conditions.alerts), null);
    },
  };
  /* ---------- desktop: detail panel docked on the right ---------- */

  const wide = window.matchMedia('(min-width: 1100px)');
  const SIDE_KEY = 'weather-map:side';
  let sideOpen = readFlag(SIDE_KEY, true);
  const sideWidth = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10) || 380;
  let padRight = -1;
  const renderSide = () => {
    const show = wide.matches && sideOpen;
    $('#side').hidden = !show;
    document.body.classList.toggle('side-open', show);
    // Keep the map's center in the uncovered area.
    const pad = show ? sideWidth() : 0;
    if (pad !== padRight) {
      padRight = pad;
      map.setPadding({ top: 0, bottom: 0, left: 0, right: pad });
    }
    if (show && conditions) {
      $('#side-title').textContent = conditions.place ?? 'Forecast';
      const body = $('#side-body');
      const scroll = body.scrollTop;
      body.replaceChildren(detailPanel(conditions, store.get(), detailActions));
      body.scrollTop = scroll;
    }
  };
  const setSide = (open: boolean) => {
    sideOpen = open;
    writeFlag(SIDE_KEY, open);
    renderSide();
  };
  $('#side-close').addEventListener('click', () => setSide(false));
  wide.addEventListener('change', renderSide);
  renderSide();

  const refreshSheet = () => {
    renderSide();
    if (!conditions) return;
    if (sheet.current === 'forecast') sheet.update(conditions.place ?? 'Forecast', detailPanel(conditions, store.get(), detailActions));
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
  const select = (p: LatLon, opts: { jump: boolean; gps?: boolean }) => {
    store.set({ selected: { lat: p.lat, lon: wrapLon(p.lon) }, gps: !!opts.gps });
    // Marker keeps the raw longitude so it stays on the world copy that was tapped.
    crosshair.setLngLat([p.lon, p.lat]);
    if (opts.jump) map.jumpTo({ center: [p.lon, p.lat] });
    loadSelected(true);
    grids.refreshIfOlderThan(5 * 60_000);
  };

  loadSelected(true);

  if (!located && permission !== 'denied') {
    void getPosition(10_000).then((p) => {
      if (p && !userPicked) select(p, { jump: true, gps: true });
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
    const s = store.get();
    refreshImagery(map, { radar: s.layers.rain, clouds: s.layers.clouds });
    alertAreas.refreshIfStale();
    refreshTimeline();
    if (Date.now() - hrrrCheckedAt > 15 * 60_000) void refreshHrrr();
  };
  setInterval(refreshIfStale, 60_000);
  document.addEventListener('visibilitychange', refreshIfStale);

  /* ---------- layer toggles ---------- */

  document.querySelectorAll<HTMLButtonElement>('.layer-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer as Layer;
      // Turning Thunder on is the user gesture that unlocks audio.
      if (layer === 'thunder' && !store.get().layers.thunder) primeAudio();
      store.toggleLayer(layer);
    });
  });

  store.subscribe((s, prev) => {
    for (const layer of LAYERS) {
      const on = s.layers[layer];
      if (on === prev.layers[layer]) continue;
      document.querySelector(`.layer-toggle[data-layer="${layer}"]`)?.setAttribute('aria-pressed', String(on));
      if (layer === 'rain') {
        frames.setRadarOn(on);
        frames.show(bar.offset);
      }
      else if (layer === 'clouds') setImageryVisible(map, 'clouds', on);
      else animator.layerChanged(layer, on);
      if (layer === 'thunder' && on) {
        if (!grids.current) showNote('Storm data loading');
        else if (!animator.stormsInView()) showNote('No thunderstorms in view');
      }
    }
    if (streaksOn(s) !== streaksOn(prev)) animator.layerChanged('rain', streaksOn(s));
    if (s.layers.rain !== prev.layers.rain || s.layers.clouds !== prev.layers.clouds) {
      refreshImagery(map, { radar: s.layers.rain, clouds: s.layers.clouds });
    }
    if (s.colorMode !== prev.colorMode) {
      setColorMode(map, s.colorMode);
      frames.setColorMode(s.colorMode);
    }
    if (s.layers.rain !== prev.layers.rain || s.colorMode !== prev.colorMode) renderBar();
    if (s.alertAreas !== prev.alertAreas) alertAreas.setVisible(s.alertAreas);
    if (s.basemap !== prev.basemap) setBasemap(map, s.basemap);
    if (s.basemap !== prev.basemap || s.layers.clouds !== prev.layers.clouds) renderCredits(s);
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
          select(p, { jump: true, gps: true });
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
    // Desktop: the HUD toggles the docked panel. Phone: it opens the sheet.
    if (wide.matches) setSide(!sideOpen);
    else if (conditions) sheet.open('forecast', conditions.place ?? 'Forecast', detailPanel(conditions, store.get(), detailActions), readout);
  });
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
}

/** Credits for optional imagery appear only while that imagery is on screen. */
function renderCredits(s: AppState): void {
  $('[data-credit="esri"]').hidden = s.basemap !== 'satellite';
  $('[data-credit="goes"]').hidden = !s.layers.clouds;
}

function alertsTitle(c: Conditions): string {
  return c.alerts.length === 1 ? 'Active alert' : `${c.alerts.length} active alerts`;
}

void main();
