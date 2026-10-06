import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './styles.css';

import { CONDITIONS_REFRESH_MS, DEFAULT_LOCATION, DEFAULT_PLACE_LABEL, GRID_MAX_AGE_MS, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { geoPermission, getPosition } from './data/geolocate';
import { GridController } from './data/gridController';
import { getHrrrInit, getLatestComposite } from './data/iem';
import { makeTimeline, offsetTime } from './data/timeline';
import type { Place } from './data/photon';
import { Animator, type LayerFlags } from './layers/animator';
import { createMap } from './map/map';
import { addImagery, refreshClouds, setBasemap, setCloudsVisible, setColorMode } from './map/imagery';
import { AlertAreas } from './map/alertAreas';
import { LocationDot } from './map/location';
import { RadarLayer } from './map/radarLayer';
import { TripLayer } from './map/tripLayer';
import { TropicalLayer } from './map/tropicalLayer';
import { getOutlook, getStormGIS, getStorms, type ModelGroup, type Outlook, type Storm, type StormGIS } from './data/tropical';
import { DEFAULT_GROUPS, stormPanel, stormShort, stormTitle } from './ui/storm';
import { createStore, type AppState } from './state';
import { primeAudio, playCrackle } from './audio/crackle';
import { wrapLon } from './util/geo';
import { $, svg } from './ui/dom';
import { renderAlertPill, renderCapsule } from './ui/capsule';
import { hurricaneMark, locateIcon, routeIcon, warningIcon } from './ui/icons';
import { LayersMenu } from './ui/layersMenu';
import { showNote } from './ui/note';
import { WeatherPage } from './ui/page';
import { SearchBox } from './ui/search';
import { settingsPanel } from './ui/settings';
import { Sheet } from './ui/sheet';
import { TimelineBar } from './ui/timelineBar';
import { TripPanel } from './ui/trip';

type Layer = keyof AppState['layers'];
/** Layers with their own handling below (hurricanes have theirs). */
const LAYERS = ['wind', 'rain', 'thunder', 'clouds'] as const satisfies readonly Layer[];
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
  $('#trip-btn').append(svg(routeIcon));
  renderCapsule(null, store.get());
  renderCredits(store.get());

  const map = await createMap($('#map'), start);
  const alertAreas = new AlertAreas(map, token('--c-alert') || '#ff9f0a', store.get().alertAreas);

  // Radar: 24 h of history, now, and the HRRR forecast, smoothed (radarLayer.ts).
  let hrrrInit: number | null = null;
  let liveAt: number | null = null;
  let timeline = makeTimeline(Date.now(), hrrrInit, liveAt);
  const radar = new RadarLayer(map, timeline, store.get().colorMode, store.get().layers.rain);

  map.once('load', () => {
    const s = store.get();
    // Bottom to top: imagery, radar, alert areas, labels.
    addImagery(map, { clouds: s.layers.clouds, basemap: s.basemap, colorMode: s.colorMode });
    radar.install();
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

  // The bar drives the radar crossfade; wind/rain particles follow the nearest hour.
  const bar = new TimelineBar(timeline, radar, (offset) => {
    grids.setTime(offset === 0 ? null : offsetTime(timeline, offset));
  });
  const renderBar = () => bar.render({ colorMode: store.get().colorMode, radarOn: store.get().layers.rain });
  renderBar();
  // Open on motion: loop the last hour into the next until the timeline is touched.
  // Not for people who've asked their device to reduce motion.
  map.once('load', () => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) bar.autoplay(-1, 1);
  });

  const refreshTimeline = () => {
    const next = makeTimeline(Date.now(), hrrrInit, liveAt);
    if (
      next.base === timeline.base &&
      next.maxOffset === timeline.maxOffset &&
      next.init === timeline.init &&
      next.live === timeline.live
    ) {
      return;
    }
    timeline = next;
    radar.setTimeline(next);
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
  // "Now" is the newest composite, published every 5 minutes.
  const refreshLive = async () => {
    try {
      liveAt = await getLatestComposite();
      refreshTimeline();
    } catch {
      // Keep the last known composite (or IEM's always-latest tiles).
    }
  };
  void refreshLive();

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

  // mode: what the readout describes, you (gps) or a point on the map (center).
  // following: whether the camera tracks the blue dot; any gesture stops it.
  // With "Weather follows the map" off, moving the map changes neither the
  // readout nor the mode: only the locate button and search do.
  type Mode = 'gps' | 'center';
  let mode: Mode = located ? 'gps' : 'center';
  let following = located;
  /** While planning a trip the camera moves on its own (framing the route, stops); the readout stays put. */
  let tripOpen = false;
  const followsMap = () => store.get().followMap && !tripOpen;
  const reticle = $('#reticle');
  const locateBtn = $('#locate-btn');
  const renderLocate = () => {
    // The cross marks the readout's point, so it shows only while the readout follows the map.
    reticle.hidden = mode === 'gps' || !followsMap();
    const tracking = mode === 'gps' && following;
    locateBtn.setAttribute('aria-pressed', String(tracking));
    locateBtn.setAttribute('aria-label', tracking ? 'Showing your location' : 'Show my location');
  };
  const setMode = (m: Mode) => {
    mode = m;
    renderLocate();
  };
  renderLocate();

  const dot = new LocationDot(map, (p) => {
    // The readout stays on you as you move; the camera only while it's following.
    if (mode !== 'gps') return;
    if (following) map.easeTo({ center: [p.lon, p.lat], duration: 600 });
    const s = store.get().selected;
    if (Math.hypot(p.lat - s.lat, p.lon - s.lon) > 0.01) select(p, { gps: true });
  });
  if (located) dot.set(start);

  // A gesture stops the camera following you and, if the weather follows the map, hands the readout to the cross.
  // Only your moves pick a new point: a gesture, or a tap's glide. Camera moves the app makes
  // (framing a storm, a trip stop, a route) leave the readout alone.
  let pickOnSettle = false;
  map.on('movestart', (e) => {
    if (!(e as { originalEvent?: Event }).originalEvent) return;
    pickOnSettle = true;
    following = false;
    if (mode === 'gps' && followsMap()) setMode('center');
    else renderLocate();
  });
  let settleTimer = 0;
  map.on('moveend', () => {
    if (!pickOnSettle || mode !== 'center' || !followsMap()) return;
    pickOnSettle = false;
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      const c = map.getCenter();
      const s = store.get().selected;
      // Ignore sub-pixel settles (and the moveend that follows a programmatic select).
      if (Math.abs(c.lat - s.lat) < 0.0005 && Math.abs(wrapLon(c.lng) - s.lon) < 0.0005) return;
      select({ lat: c.lat, lon: c.lng });
    }, SETTLE_MS);
  });

  // Tap: bring that spot under the cross. (With the weather pinned, a tap changes nothing.)
  map.on('click', (e) => {
    // A storm's own click handler opens it; the map stays put.
    if (tropical.hit(e.point)) return;
    if (!followsMap()) return;
    following = false;
    setMode('center');
    pickOnSettle = true;
    map.easeTo({ center: e.lngLat, duration: 450 });
  });

  const goToMe = async () => {
    locateBtn.classList.add('busy');
    const p = dot.position && !(mode === 'gps' && following) ? dot.position : await dot.locate(true);
    locateBtn.classList.remove('busy');
    if (!p) {
      showNote('Location is unavailable. Check location permission for this site.');
      return;
    }
    following = true;
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
        following = true;
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

  // A search is a deliberate choice: the readout goes there whether or not it follows the map.
  const search = new SearchBox(
    () => store.get().selected,
    (place: Place) => {
      following = false;
      setMode('center');
      select({ lat: place.lat, lon: place.lon }, { label: place.subtitle ? `${place.title}, ${place.subtitle}` : place.title });
      const zoom = place.kind === 'area' ? Math.max(map.getZoom(), 8) : Math.max(map.getZoom(), 11);
      map.flyTo({ center: [place.lon, place.lat], zoom, duration: 900, essential: true });
    },
  );

  /* ---------- trip weather ---------- */

  const tripColors = () => ({
    route: token('--accent') || '#0a84ff',
    severe: token('--c-alert') || '#ff9f0a',
    caution: token('--c-sun') || '#ffd60a',
    stop: '#ffffff',
  });
  const tripLayer = new TripLayer(map, tripColors());
  // Frame the route in the part of the map the panel doesn't cover.
  const tripPadding = () => {
    const r = $('#trip').getBoundingClientRect();
    return window.innerWidth < 700
      ? { top: 80, right: 70, left: 30, bottom: Math.max(120, window.innerHeight - r.top + 24) }
      : { top: 80, right: 80, bottom: 150, left: r.right + 30 };
  };
  const trip = new TripPanel({
    myLocation: () => dot.position,
    near: () => store.get().selected,
    state: () => store.get(),
    show: (plan) => {
      tripLayer.set(plan, tripPadding());
      $('[data-credit="osrm"]').hidden = !plan;
    },
    focus: (pt) => {
      map.flyTo({ center: [pt.lon, pt.lat], zoom: Math.max(map.getZoom(), 8), duration: 900, essential: true });
      // Radar at the hour you'll be there, when the timeline reaches it.
      const offset = (pt.at - timeline.base) / 3_600_000;
      if (offset <= timeline.maxOffset + 0.125) bar.show(Math.max(0, offset));
      else showNote('Forecast radar doesn’t reach that far ahead yet.');
    },
    layout: (open, folded) => {
      tripOpen = open;
      renderLocate();
      document.body.classList.toggle('trip-open', open);
      document.body.classList.toggle('trip-folded', open && folded);
      $('#trip-btn').setAttribute('aria-expanded', String(open));
    },
  });
  $('#trip-btn').addEventListener('click', () => trip.toggle());

  /* ---------- hurricanes ---------- */

  const GROUPS_KEY = 'weather-map:models:v1';
  const readGroups = (): Set<ModelGroup> => {
    try {
      const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null') as ModelGroup[] | null;
      if (Array.isArray(v)) return new Set(v);
    } catch {
      // Storage blocked: defaults.
    }
    return new Set(DEFAULT_GROUPS);
  };
  let modelGroups = readGroups();
  let storms: Storm[] = [];
  let stormGIS = new Map<string, StormGIS>();
  let outlook: Outlook | null = null;
  let tropicsGenerated: string | null = null;
  let selectedStorm: string | null = null;
  let tropicsAt = 0;
  const tropical = new TropicalLayer(map, (id) => openStorm(id));
  const drawTropics = () => tropical.set(storms, stormGIS, outlook, modelGroups);
  const strongest = () => [...storms].sort((a, b) => b.intensityKt - a.intensityKt)[0];

  const stormPill = $<HTMLButtonElement>('#storm-pill');
  $('#storm-pill-icon').append(svg(hurricaneMark));
  const renderStormPill = () => {
    const on = store.get().layers.tropics && storms.length > 0;
    stormPill.hidden = !on;
    if (!on) return;
    const top = strongest();
    $('#storm-pill-text').textContent = storms.length > 1 ? `${storms.length} tropical systems` : stormShort(top);
    stormPill.setAttribute('aria-label', `${storms.length > 1 ? `${storms.length} active tropical systems` : stormTitle(top)}. Open storm details.`);
  };

  const stormContent = () =>
    stormPanel(storms, stormGIS, tropicsGenerated, selectedStorm ?? storms[0].id, {
      state: () => store.get(),
      groups: () => modelGroups,
      setGroup: (group, on) => {
        modelGroups = new Set(modelGroups);
        if (on) modelGroups.add(group);
        else modelGroups.delete(group);
        try {
          localStorage.setItem(GROUPS_KEY, JSON.stringify([...modelGroups]));
        } catch {
          // The choice lasts for this visit.
        }
        drawTropics();
        rerenderStorm();
      },
      select: (id) => {
        selectedStorm = id;
        rerenderStorm();
      },
      showOnMap: (id) => {
        sheet.close();
        const s = storms.find((x) => x.id === id);
        if (s) tropical.fit(s, stormGIS.get(id), modelGroups, { top: 90, bottom: 170, left: 40, right: 70 });
      },
    });
  const rerenderStorm = () => {
    if (sheet.current !== 'storm' || !storms.length) return;
    const s = storms.find((x) => x.id === selectedStorm) ?? storms[0];
    sheet.update(stormTitle(s), stormContent());
  };
  const openStorm = (id: string) => {
    if (!storms.length) return;
    selectedStorm = id;
    const s = storms.find((x) => x.id === id) ?? storms[0];
    sheet.open('storm', stormTitle(s), stormContent(), stormPill);
  };
  stormPill.addEventListener('click', () => openStorm(selectedStorm ?? strongest().id));

  // Storms, their NHC forecasts, and the outlook: every 10 minutes while the layer is on.
  const refreshTropics = async () => {
    if (!store.get().layers.tropics) return;
    tropicsAt = Date.now();
    try {
      const r = await getStorms();
      storms = r.storms;
      tropicsGenerated = r.generated;
      stormGIS = new Map(await Promise.all(storms.map(async (s) => [s.id, await getStormGIS(s.bin)] as const)));
    } catch {
      // Keep what's on the map.
    }
    outlook = await getOutlook().catch(() => outlook);
    drawTropics();
    renderStormPill();
    rerenderStorm();
  };
  map.once('load', () => void refreshTropics());

  /* ---------- refresh ---------- */

  // Refresh only while visible: a locked phone or background tab costs no
  // battery and no API calls, and catches up as soon as it comes back.
  const refreshIfStale = () => {
    if (document.hidden) return;
    if (Date.now() - lastLoaded >= CONDITIONS_REFRESH_MS) loadSelected(false);
    grids.refreshIfOlderThan(GRID_MAX_AGE_MS);
    const s = store.get();
    refreshClouds(map, s.layers.clouds);
    alertAreas.refreshIfStale();
    void refreshLive();
    refreshTimeline();
    if (Date.now() - hrrrCheckedAt > 15 * 60_000) void refreshHrrr();
    if (Date.now() - tropicsAt > 10 * 60_000) void refreshTropics();
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
      if (layer === 'rain') radar.setRadarOn(on);
      else if (layer === 'clouds') setCloudsVisible(map, on);
      else animator.layerChanged(layer, on);
    }
    if (streaksOn(s) !== streaksOn(prev)) animator.layerChanged('rain', streaksOn(s));
    if (s.layers.clouds !== prev.layers.clouds) refreshClouds(map, s.layers.clouds);
    if (s.colorMode !== prev.colorMode) {
      setColorMode(map, s.colorMode);
      radar.setColorMode(s.colorMode);
    }
    if (s.layers.rain !== prev.layers.rain || s.colorMode !== prev.colorMode) renderBar();
    if (s.alertAreas !== prev.alertAreas) alertAreas.setVisible(s.alertAreas);
    if (s.layers.tropics !== prev.layers.tropics) {
      tropical.setVisible(s.layers.tropics);
      renderStormPill();
      if (s.layers.tropics && Date.now() - tropicsAt > 60_000) void refreshTropics();
    }
    if (s.followMap !== prev.followMap) {
      // Pinning the weather while looking around: back to your location's weather (the map stays put).
      if (!s.followMap && mode === 'center' && dot.position) {
        setMode('gps');
        select(dot.position, { gps: true });
      }
      renderLocate();
    }
    if (s.basemap !== prev.basemap) setBasemap(map, s.basemap);
    if (s.basemap !== prev.basemap || s.layers.clouds !== prev.layers.clouds || s.layers.rain !== prev.layers.rain) {
      renderCredits(s);
    }
    if (s.theme !== prev.theme) {
      applyTheme(s);
      // Canvas and map colors don't read CSS; hand them the new tokens.
      palette.wind = palette.lightning = token('--fg');
      palette.rain = token('--muted');
      alertAreas.setColor(token('--c-alert'));
      tripLayer.setColors(tripColors());
    }
    if (s.tempUnit !== prev.tempUnit || s.windUnit !== prev.windUnit || s.theme !== prev.theme) {
      renderAll();
      trip.refresh();
      rerenderStorm();
    }
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
  $('[data-credit="iem"]').hidden = !s.layers.rain;
  $('[data-credit="esri"]').hidden = s.basemap !== 'satellite';
  $('[data-credit="goes"]').hidden = !s.layers.clouds;
}

void main();
