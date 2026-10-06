import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './styles.css';

import { CONDITIONS_REFRESH_MS, DEFAULT_LOCATION, DEFAULT_PLACE_LABEL, GRID_MAX_AGE_MS, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { geoPermission, getPosition } from './data/geolocate';
import { GridController } from './data/gridController';
import { getHrrrInit } from './data/hrrr';
import { makeTimeline, offsetTime, utcHourKey } from './data/timeline';
import type { Place } from './data/photon';
import { Animator, type LayerFlags } from './layers/animator';
import { createMap } from './map/map';
import { addImagery, refreshImagery, setBasemap, setColorMode, setImageryVisible } from './map/imagery';
import { AlertAreas } from './map/alertAreas';
import { LocationDot } from './map/location';
import { RadarTimeline } from './map/radarTimeline';
import { createStore, type AppState } from './state';
import { primeAudio, playCrackle } from './audio/crackle';
import { wrapLon } from './util/geo';
import { $, svg } from './ui/dom';
import { renderAlertPill, renderCapsule } from './ui/capsule';
import { locateIcon, warningIcon } from './ui/icons';
import { LayersMenu } from './ui/layersMenu';
import { showNote } from './ui/note';
import { WeatherPage } from './ui/page';
import { SearchBox } from './ui/search';
import { settingsPanel } from './ui/settings';
import { Sheet } from './ui/sheet';
import { TimelineBar } from './ui/timelineBar';

type Layer = keyof AppState['layers'];
const LAYERS: Layer[] = ['wind', 'rain', 'thunder', 'clouds'];
/** Wait this long after the map settles before loading weather for its center. */
const SETTLE_MS = 350;

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

  const applyTheme = (s: AppState) => {
    document.documentElement.dataset.theme = s.theme;
  };
  applyTheme(store.get());
  const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Static chrome.
  $('#locate-btn').append(svg(locateIcon));
  $('#alert-pill-icon').append(svg(warningIcon));
  $('#cap-gps').append(svg(locateIcon));
  renderCapsule(null, store.get());
  renderCredits(store.get());

  const map = await createMap($('#map'), start);
  const alertAreas = new AlertAreas(map, token('--c-alert') || '#ff9f0a', store.get().alertAreas);
  map.once('load', () => {
    const s = store.get();
    addImagery(map, { radar: s.layers.rain, clouds: s.layers.clouds, basemap: s.basemap, colorMode: s.colorMode });
    alertAreas.install();
  });

  // Rain streaks need the Rain layer on AND the falling-rain setting on; radar needs only the layer.
  const streaksOn = (s: AppState) => s.layers.rain && s.rainStreaks;
  const flags = (): LayerFlags => {
    const s = store.get();
    return { ...s.layers, rain: streaksOn(s) };
  };
  const palette = { wind: token('--fg') || '#ffffff', rain: token('--muted') || '#c8c8d0', lightning: token('--fg') || '#ffffff' };
  const animator = new Animator(map, $('#wind-canvas'), $('#fx-canvas'), flags, palette);
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

  /* ---------- weather page (live sky + cards) ---------- */

  let padRight = -1;
  // The page reports layout changes (docked on desktop or not), including during its constructor.
  const onPageLayout = (docked: boolean) => {
    // Docked on desktop: keep the map's center in the uncovered area.
    const pad = docked ? parseInt(token('--page-w'), 10) || 400 : 0;
    if (pad !== padRight) {
      padRight = pad;
      map.setPadding({ top: 0, bottom: 0, left: 0, right: pad });
    }
  };
  const page = new WeatherPage(onPageLayout);

  const renderAll = () => {
    const s = store.get();
    renderCapsule(conditions, s);
    renderAlertPill(conditions?.alerts ?? []);
    if (page.open) page.render(conditions, s);
  };

  /* ---------- conditions for the selected point ---------- */

  let loadCtrl: AbortController | null = null;
  let lastLoaded = 0;
  /** A search result's own name beats the NWS "3 mi ESE of …" label for that point. */
  let labelOverride: string | null = null;
  /** New point: clear the readout first. Refresh: keep showing the old values until new ones land. */
  const loadSelected = (newPoint: boolean) => {
    loadCtrl?.abort();
    loadCtrl = new AbortController();
    lastLoaded = Date.now();
    if (newPoint) {
      conditions = null;
      renderAll();
    }
    void loadConditions(store.get().selected, loadCtrl.signal, newPoint ? null : conditions, (c) => {
      conditions = labelOverride ? { ...c, place: labelOverride } : c;
      renderAll();
    });
  };

  const select = (p: LatLon, opts: { gps?: boolean; label?: string | null } = {}) => {
    labelOverride = opts.label ?? null;
    store.set({ selected: { lat: p.lat, lon: wrapLon(p.lon) }, gps: !!opts.gps });
    loadSelected(true);
    grids.refreshIfOlderThan(5 * 60_000);
  };

  /* ---------- you (blue dot) vs. the map center (cross) ---------- */

  type Mode = 'gps' | 'center';
  let mode: Mode = located ? 'gps' : 'center';
  const reticle = $('#reticle');
  const locateBtn = $('#locate-btn');
  const setMode = (m: Mode) => {
    mode = m;
    reticle.hidden = m === 'gps';
    locateBtn.setAttribute('aria-pressed', String(m === 'gps'));
    locateBtn.setAttribute('aria-label', m === 'gps' ? 'Showing your location' : 'Show my location');
  };
  setMode(mode);

  const dot = new LocationDot(map, (p) => {
    // Following you: keep the map on the dot; reload weather only after a real move.
    if (mode !== 'gps') return;
    map.easeTo({ center: [p.lon, p.lat], duration: 600 });
    const s = store.get().selected;
    if (Math.hypot(p.lat - s.lat, p.lon - s.lon) > 0.01) select(p, { gps: true });
  });
  if (located) dot.set(start);

  // Any gesture that moves the map hands the readout to the center cross.
  map.on('movestart', (e) => {
    if ((e as { originalEvent?: Event }).originalEvent && mode === 'gps') setMode('center');
  });
  let pendingLabel: string | null = null;
  let settleTimer = 0;
  map.on('moveend', () => {
    if (mode !== 'center') return;
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      const c = map.getCenter();
      const s = store.get().selected;
      // Ignore sub-pixel settles (and the moveend that follows a programmatic select).
      if (Math.abs(c.lat - s.lat) < 0.0005 && Math.abs(wrapLon(c.lng) - s.lon) < 0.0005) return;
      const label = pendingLabel;
      pendingLabel = null;
      select({ lat: c.lat, lon: c.lng }, { label });
    }, SETTLE_MS);
  });

  // Tap: bring that spot under the cross.
  map.on('click', (e) => {
    setMode('center');
    map.easeTo({ center: e.lngLat, duration: 450 });
  });

  const goToMe = async () => {
    locateBtn.classList.add('busy');
    const p = dot.position && mode !== 'gps' ? dot.position : await dot.locate(true);
    locateBtn.classList.remove('busy');
    if (!p) {
      showNote('Location is unavailable. Check location permission for this site.');
      return;
    }
    setMode('gps');
    map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 8), duration: 700 });
    select(p, { gps: true });
  };
  locateBtn.addEventListener('click', () => void goToMe());

  loadSelected(true);

  if (!located && permission !== 'denied') {
    // First visit: ask once. If allowed and you haven't moved the map yet, go there.
    void dot.locate(false).then((p) => {
      if (!p) showNote(`Location unavailable. Showing ${DEFAULT_PLACE_LABEL}.`);
      else if (mode === 'center' && store.get().selected === start) {
        setMode('gps');
        map.jumpTo({ center: [p.lon, p.lat] });
        select(p, { gps: true });
      }
    });
  } else if (located) {
    void dot.locate(false);
  } else {
    showNote(`Location is off. Showing ${DEFAULT_PLACE_LABEL}.`);
  }

  /* ---------- search ---------- */

  const search = new SearchBox(
    () => store.get().selected,
    (place: Place) => {
      setMode('center');
      pendingLabel = place.subtitle ? `${place.title}, ${place.subtitle}` : place.title;
      const zoom = place.kind === 'area' ? Math.max(map.getZoom(), 8) : Math.max(map.getZoom(), 11);
      map.flyTo({ center: [place.lon, place.lat], zoom, duration: 900, essential: true });
      // If the map is already there, flyTo ends without moving: select directly.
      const c = map.getCenter();
      if (Math.abs(c.lat - place.lat) < 0.0005 && Math.abs(c.lng - place.lon) < 0.0005) {
        select({ lat: place.lat, lon: place.lon }, { label: pendingLabel });
        pendingLabel = null;
      }
    },
  );

  /* ---------- refresh ---------- */

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

  /* ---------- layers popover + settings ---------- */

  const openSettings = () => sheet.open('settings', 'Settings', settingsPanel(store), $('#layers-btn'));
  new LayersMenu(store, openSettings, (layer, on) => {
    // Turning Lightning on is the user gesture that unlocks audio.
    if (layer === 'thunder' && on) {
      primeAudio();
      if (!grids.current) showNote('Storm data loading');
      else if (!animator.stormsInView()) showNote('No thunderstorms in view');
    }
  });

  store.subscribe((s, prev) => {
    for (const layer of LAYERS) {
      const on = s.layers[layer];
      if (on === prev.layers[layer]) continue;
      if (layer === 'rain') {
        frames.setRadarOn(on);
        frames.show(bar.offset);
      } else if (layer === 'clouds') setImageryVisible(map, 'clouds', on);
      else animator.layerChanged(layer, on);
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
    if (s.theme !== prev.theme) {
      applyTheme(s);
      // Canvas and map colors don't read CSS; hand them the new tokens.
      palette.wind = palette.lightning = token('--fg');
      palette.rain = token('--muted');
      alertAreas.setColor(token('--c-alert'));
    }
    if (s.tempUnit !== prev.tempUnit || s.windUnit !== prev.windUnit || s.theme !== prev.theme) renderAll();
  });

  /* ---------- readout → weather page ---------- */

  const capsule = $('#capsule');
  capsule.addEventListener('click', () => {
    page.toggle(capsule);
    if (page.open) page.render(conditions, store.get());
  });
  $('#alert-pill').addEventListener('click', () => {
    if (!page.open) page.setOpen(true, $('#alert-pill'));
    page.render(conditions, store.get());
    requestAnimationFrame(() => page.scrollToAlerts());
  });
  if (page.open) page.render(conditions, store.get());

  /* ---------- keyboard (desktop) ---------- */

  document.addEventListener('keydown', (e) => {
    if (sheet.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const typing = !!t.closest('input:not([type=range]), textarea, select');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      search.focus();
      return;
    }
    if (typing || (t.closest('button, a') && t.id !== 'tl-range')) return;
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
}

/** Credits for optional imagery appear only while that imagery is on screen. */
function renderCredits(s: AppState): void {
  $('[data-credit="esri"]').hidden = s.basemap !== 'satellite';
  $('[data-credit="goes"]').hidden = !s.layers.clouds;
}

void main();
