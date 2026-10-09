import { Marker } from 'maplibre-gl';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './styles.css';

import { CONDITIONS_REFRESH_MS, DEFAULT_LOCATION, DEFAULT_PLACE_LABEL, GRID_MAX_AGE_MS, INITIAL_ZOOM, SAT_RAIN_PRODUCT, TIMELINE_PAST_HOURS, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { geoPermission } from './data/geolocate';
import { GridController } from './data/gridController';
import { WindController } from './data/windController';
import { getHrrrInit, getLatestComposite } from './data/iem';
import { getMrmsTimes } from './data/mrms';
import { getRealEarthTimes } from './data/realearth';
import { makeTimeline, offsetTime } from './data/timeline';
import type { Place } from './data/photon';
import { Animator, type LayerFlags } from './layers/animator';
import { createMap, loadStyle } from './map/map';
import { formatHashView, parseHashView, readLastFix, readLastView, saveLastFix, saveLastView } from './data/view';
import { CloudCutout } from './map/cloudCutout';
import { addImagery, setBasemap, setColorMode } from './map/imagery';
import { AlertAreas } from './map/alertAreas';
import { OutlookLayer } from './map/outlookLayer';
import { StormLayer, type StormHit } from './map/stormLayer';
import { LightningLayer } from './map/lightningLayer';
import { RadarSitesLayer } from './map/radarSitesLayer';
import { getRadarSites, getSiteScans, siteCall, type RadarSite, type SiteFrames, type SiteProduct } from './data/radarSites';
import { renderSiteBar } from './ui/siteBar';
import { getLightning } from './data/lightning';
import type { Bounds } from './field/grid';
import { cellPanel, cellTitle, reportPanel, reportTitle } from './ui/cellPanel';
import { LocationDot } from './map/location';
import { RadarLayer } from './map/radarLayer';
import { FieldLayer } from './map/fieldLayer';
import { plainLabel, weatherMap } from './maps/catalog';
import { FieldController } from './maps/fieldController';
import { OpenMeteoSource } from './maps/openMeteoSource';
import { GEOMET_MAPS, GeoMetSource, RoutedSource } from './maps/geometSource';
import { GibsInfraredSource } from './maps/gibsSource';
import { renderMapLegend } from './ui/mapLegend';
import type { TripLayer } from './map/tripLayer';
import type { StopTip } from './ui/stopTip';
import { TropicalLayer } from './map/tropicalLayer';
import type { FeatureCollection } from 'geojson';
import { getOutlook, getStormGIS, getStorms, getWindProbs, type ModelGroup, type Outlook, type Storm, type StormGIS } from './data/tropical';
import { stormPanel, stormShort, stormTitle } from './ui/storm';
import { createStore, type AppState } from './state';
import { primeAudio, playCrackle } from './audio/crackle';
import { wrapLon } from './util/geo';
import { $, h, svg } from './ui/dom';
import { renderAlertPill, renderCapsule } from './ui/capsule';
import { alertMark, boltMark, hurricaneMark, locateIcon, routeIcon, warningIcon } from './ui/icons';
import { LayersMenu } from './ui/layersMenu';
import { alertDetail, alertsList, alertsOfType, type AlertsHooks } from './ui/alertsPanel';
import { getAlert, type Alert } from './data/nws';
import type { AlertItem } from './map/alertAreas';
import { MapOnly } from './ui/mapOnly';
import { showNote } from './ui/note';
import { WeatherPage } from './ui/page';
import { PIN, SearchBox } from './ui/search';
import { Sheet } from './ui/sheet';
import { TimelineBar } from './ui/timelineBar';
import type { TripPanel } from './ui/trip';

type Layer = keyof AppState['layers'];
/** Layers with their own handling below (hurricanes have theirs). */
const LAYERS = ['wind', 'rain', 'thunder', 'clouds'] as const satisfies readonly Layer[];
/** Wait this long after the map settles before loading weather for its center. */
const SETTLE_MS = 350;

async function main(): Promise<void> {
  // The basemap style is on the path to the first frame: fetch it while everything else starts.
  const style = loadStyle();
  // Where to open, without waiting on a GPS fix: a shared link's view (#map=zoom/lat/lon),
  // else your last known location if location is allowed (a fresh fix follows),
  // else where you left the map, else the default.
  const hashView = parseHashView(location.hash);
  const permission = await geoPermission();
  const lastFix = permission === 'granted' ? readLastFix() : null;
  const lastView = readLastView();
  let start: LatLon = DEFAULT_LOCATION;
  let startZoom = INITIAL_ZOOM;
  let located = false;
  if (hashView) {
    start = hashView;
    startZoom = hashView.zoom;
  } else if (lastFix) {
    start = lastFix;
    located = true;
  } else if (lastView && permission !== 'granted') {
    start = lastView;
    startZoom = lastView.zoom;
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

  const map = await createMap($('#map'), start, startZoom, style);
  // The view lives in the address bar (#map=zoom/lat/lon): reloads and shared links open here.
  map.on('moveend', () => {
    const c = map.getCenter();
    const v = { zoom: map.getZoom(), lat: c.lat, lon: wrapLon(c.lng) };
    history.replaceState(history.state, '', formatHashView(v));
    saveLastView(v);
  });
  const alertAreas = new AlertAreas(map, store.get().alertAreas);
  const stormOutlook = new OutlookLayer(map);
  const cloudCutout = new CloudCutout(map);
  const stormCells = new StormLayer(map);
  const lightning = new LightningLayer(map);

  // Radar: 24 h of history, now, and the HRRR forecast, smoothed (radarLayer.ts).
  let hrrrInit: number | null = null;
  let liveAt: number | null = null;
  /** MRMS frames (NOAA's cleaned-up mosaic): now and the last 2 hours. Empty: the IEM composite throughout. */
  let radarTimes: readonly number[] = [];
  /** Satellite rain-estimate frames, for rain beyond radar range. */
  let satTimes: readonly number[] = [];
  /** One radar chosen (tap a tower): its own scans replace the composite for the past and now. */
  let chosenSite: RadarSite | null = null;
  let siteFrames: SiteFrames | null = null;
  let siteScansAt = 0;
  let timeline = makeTimeline(Date.now(), hrrrInit, liveAt);
  const radar = new RadarLayer(map, timeline, store.get().colorMode, store.get().layers.rain);
  radar.setPrecipType(store.get().precipType);

  // Weather maps (Windy's layers): one colored variable under borders, radar, and labels.
  const field = new FieldLayer(map);
  const mapSource = new RoutedSource([new GeoMetSource(), new GibsInfraredSource(), new OpenMeteoSource()]);
  let legendKey = '';
  const renderLegend = () => {
    const s = store.get();
    const m = weatherMap(s.weatherMap);
    const here = m ? fields.valueAt(s.selected.lon, s.selected.lat) : null;
    const key = `${s.weatherMap}|${s.tempUnit}|${s.windUnit}|${here == null ? '' : here.toPrecision(3)}`;
    if (key === legendKey) return;
    legendKey = key;
    renderMapLegend($('#map-legend'), m, { temp: s.tempUnit, wind: s.windUnit }, here);
  };
  const fields = new FieldController(map, field, mapSource, renderLegend, () => showNote('Weather map data unavailable. Retrying.'));
  const showWeatherMap = (s: AppState) => {
    const m = weatherMap(s.weatherMap);
    field.setRamp(m?.ramp ?? null, m?.opacity);
    fields.setMap(m ? s.weatherMap : 'none');
  };

  map.once('load', () => {
    const s = store.get();
    // Bottom to top: imagery, weather map, borders, radar, alert areas, labels.
    addImagery(map, { basemap: s.basemap, colorMode: s.colorMode });
    // Satellite clouds sit on the imagery, under the weather map, radar, and labels.
    cloudCutout.install(map.getStyle().layers.find((l) => l.type === 'symbol')?.id, s.layers.clouds);
    field.install();
    radar.install();
    stormOutlook.install();
    alertAreas.install();
    stormOutlook.set(s.layers.outlook, s.outlookKind, s.outlookDay);
    showWeatherMap(s);
    // Storm cells over the radar; their data loads just after the first frame.
    sitesLayer.install();
    sitesLayer.setVisible(s.layers.rain);
    void getRadarSites()
      .then((sites) => {
        sitesLayer.setSites(sites);
        // The towers' reach: past it, satellite rain fills in.
        radar.setSites(sites);
      })
      .catch(() => {});
    lightning.install();
    lightning.setVisible(s.layers.thunder);
    stormCells.install();
    window.setTimeout(() => stormCells.set(s.layers.cells, s.stormReports), 600);
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

  // Wind for the particles: GeoMet's model (15 km). Open-Meteo's lattice brings falling rain
  // and storm cells, so it fetches only while those are on, or for wind if GeoMet is down.
  let windDown = false;
  const grids = new GridController(
    map,
    (g) => animator.setGrid(g),
    () => showNote('Wind and rain data unavailable. Retrying.'),
  );
  // Lightning is live from GOES; forecast storm cells stand in only if that feed is down.
  let lightningDown = false;
  const syncGrids = () => {
    const s = store.get();
    grids.setEnabled(streaksOn(s) || (s.layers.thunder && lightningDown) || (s.layers.wind && windDown));
  };
  const wind = new WindController(
    map,
    (g) => {
      animator.setWind(g);
      if (g && windDown) {
        windDown = false;
        syncGrids();
      }
    },
    () => {
      if (windDown) return;
      windDown = true;
      syncGrids();
    },
  );
  syncGrids();
  wind.setActive(store.get().layers.wind);
  void grids.update(true);

  /* ---------- live lightning (GOES lightning mapper) ---------- */

  let lightningCtrl: AbortController | null = null;
  let lightningArea: { covers: Bounds; zoom: number } | null = null;
  /** The latest minute of flashes over the view: the glow and the bolts. `announce`: say so if there's none in view. */
  const loadLightning = async (announce = false): Promise<void> => {
    if (!store.get().layers.thunder || document.hidden) return;
    lightningCtrl?.abort();
    const ctrl = new AbortController();
    lightningCtrl = ctrl;
    const b = map.getBounds();
    try {
      const d = await getLightning({ west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() }, map.getZoom(), ctrl.signal);
      if (ctrl.signal.aborted || !store.get().layers.thunder) return;
      lightningArea = { covers: d.covers, zoom: map.getZoom() };
      lightning.setFlashes(d.cells);
      animator.setLightning(d.cells, d.cellDeg);
      if (announce && !animator.stormsInView()) showNote('No lightning in view right now');
      if (lightningDown) {
        lightningDown = false;
        syncGrids();
      }
    } catch {
      if (ctrl.signal.aborted || lightningDown) return;
      lightningDown = true;
      lightning.setFlashes([]);
      animator.setLightning(null);
      syncGrids();
      showNote('Live lightning is unavailable. Showing approximate lightning from the forecast.');
    }
  };
  // Panned off the area (or zoomed far): fetch for the new view.
  map.on('moveend', () => {
    const a = lightningArea;
    if (!store.get().layers.thunder || !a) return;
    const b = map.getBounds();
    const outside = b.getWest() < a.covers.west || b.getEast() > a.covers.east || b.getSouth() < a.covers.south || b.getNorth() > a.covers.north;
    if (outside || Math.abs(map.getZoom() - a.zoom) >= 1.5) void loadLightning();
  });

  /* ---------- timeline: 24 h of radar history into the HRRR forecast ---------- */

  // The bar drives the radar crossfade; wind/rain particles follow the nearest hour.
  const bar = new TimelineBar(timeline, radar, (offset) => {
    const t = offset === 0 ? null : offsetTime(timeline, offset);
    grids.setTime(t);
    wind.setTime(t);
  });
  // The weather map blends its frames itself: hand it the playhead continuously.
  bar.onPlayhead = (offset) => fields.setTime(offset === 0 ? null : offsetTime(timeline, offset));
  const renderBar = () => {
    const s = store.get();
    const m = weatherMap(s.weatherMap);
    bar.render({
      colorMode: s.colorMode,
      radarOn: s.layers.rain,
      mapLabel: m && plainLabel(m),
      site: chosenSite && siteCall(chosenSite),
      velocity: siteFrames?.product === 'N0S',
      precipType: s.precipType,
    });
  };
  renderBar();
  // Open on motion: loop the last hour into the next until the timeline is touched.
  // Not for people who've asked their device to reduce motion.
  map.once('load', () => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) bar.autoplay(-1, 1);
  });

  const refreshTimeline = () => {
    const next = makeTimeline(Date.now(), hrrrInit, liveAt, siteFrames, radarTimes, satTimes);
    if (
      next.base === timeline.base &&
      next.maxOffset === timeline.maxOffset &&
      next.init === timeline.init &&
      next.live === timeline.live &&
      next.site === timeline.site &&
      next.radar === timeline.radar &&
      next.sat === timeline.sat
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
  // "Now" is the newest MRMS frame (every 2 minutes); IEM's newest composite stands in if MRMS is down.
  // An unchanged list keeps its identity, so the timeline isn't rebuilt for nothing.
  const sameFrames = (a: readonly number[], b: readonly number[]) => a.length === b.length && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
  const refreshLive = async () => {
    const [live, radarList, satList] = await Promise.allSettled([
      getLatestComposite(),
      getMrmsTimes(),
      getRealEarthTimes(SAT_RAIN_PRODUCT),
    ]);
    // On failure, keep what we had.
    if (live.status === 'fulfilled') liveAt = live.value;
    if (radarList.status === 'fulfilled' && !sameFrames(radarList.value, radarTimes)) radarTimes = radarList.value;
    if (satList.status === 'fulfilled' && !sameFrames(satList.value, satTimes)) satTimes = satList.value;
    // A stalled feed gives way: MRMS to the composite, the satellite to nothing.
    if (radarTimes.length && Date.now() - radarTimes[radarTimes.length - 1] > 20 * 60_000) radarTimes = [];
    if (satTimes.length && Date.now() - satTimes[satTimes.length - 1] > 3 * 3_600_000) satTimes = [];
    refreshTimeline();
  };
  void refreshLive();

  /* ---------- one radar (tap a tower) ---------- */

  const sitesLayer = new RadarSitesLayer(map, token('--accent') || '#0a84ff');
  const renderSite = () =>
    renderSiteBar(chosenSite, siteFrames?.product ?? 'N0B', {
      product: (p) => void chooseSite(chosenSite, p),
      close: () => void chooseSite(null),
    });
  /** Show one tower's own scans (its past 24 hours and now), or go back to the composite (null). */
  const chooseSite = async (site: RadarSite | null, product: SiteProduct = 'N0B'): Promise<void> => {
    if (!site) {
      chosenSite = null;
      siteFrames = null;
    } else {
      try {
        const scans = await getSiteScans(site.id, product, TIMELINE_PAST_HOURS + 0.5);
        if (!scans.length) {
          showNote(`${siteCall(site)} has no recent scans.`);
          return;
        }
        chosenSite = site;
        siteFrames = { id: site.id, product, scans };
        siteScansAt = Date.now();
      } catch {
        showNote(`${siteCall(site)}’s scans couldn’t load. Try again in a moment.`);
        return;
      }
    }
    sitesLayer.select(chosenSite, siteFrames?.product);
    refreshTimeline();
    renderSite();
    renderBar();
  };
  /** New scans every few minutes: pick them up (they become "now"). */
  const refreshSiteScans = async () => {
    const f = siteFrames;
    if (!f || Date.now() - siteScansAt < 2 * 60_000) return;
    siteScansAt = Date.now();
    try {
      const recent = await getSiteScans(f.id, f.product, 1);
      if (siteFrames !== f) return;
      const scans = [...new Set([...f.scans.filter((t) => t > Date.now() - (TIMELINE_PAST_HOURS + 0.5) * 3_600_000), ...recent])].sort((a, b) => a - b);
      if (scans[scans.length - 1] === f.scans[f.scans.length - 1]) return;
      siteFrames = { ...f, scans };
      refreshTimeline();
    } catch {
      // Keep the scans we have; the next tick tries again.
    }
  };

  /* ---------- weather page (live sky + cards) ---------- */

  let padRight = -1;
  // The page reports layout changes (docked on desktop or not), including during its constructor.
  const onPageLayout = (docked: boolean) => {
    // Docked on desktop: keep the map's center in the uncovered area.
    const pad = docked ? parseInt(token('--page-w'), 10) || 400 : 0;
    if (pad !== padRight) {
      padRight = pad;
      // Map only hides the page, so no padding until it ends (it restores this).
      if (!document.body.classList.contains('map-only')) map.setPadding({ top: 0, bottom: 0, left: 0, right: pad });
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
    renderPin();
  };

  // The pin on the weather card: one tap keeps the weather on this place while you look around
  // (the cross gives way to a pin on the map); another tap and it follows the map again.
  const pinBtn = $<HTMLButtonElement>('#cap-pin');
  pinBtn.append(svg(PIN));
  const pinEl = h('span', { class: 'pin-marker' });
  pinEl.append(svg(PIN));
  const pinMarker = new Marker({ element: pinEl, anchor: 'bottom' });
  let pinShown = false;
  function renderPin(): void {
    const pinned = !store.get().followMap;
    pinBtn.setAttribute('aria-pressed', String(pinned));
    const label = pinned ? 'Weather pinned here. Tap to follow the map again' : 'Pin the weather here';
    pinBtn.setAttribute('aria-label', label);
    pinBtn.title = label;
    // The pin marks a place on the map; your own location already has its blue dot.
    const show = pinned && mode === 'center' && !tripOpen;
    const s = store.get().selected;
    if (show) pinMarker.setLngLat([s.lon, s.lat]);
    if (show && !pinShown) pinMarker.addTo(map);
    if (!show && pinShown) pinMarker.remove();
    pinShown = show;
  }
  pinBtn.addEventListener('click', () => {
    const pinned = store.get().followMap;
    store.set({ followMap: !pinned });
    showNote(pinned ? 'Weather pinned here. Move the map freely.' : 'Weather follows the map again.');
  });
  renderLocate();

  const dot = new LocationDot(map, (p) => {
    saveLastFix(p);
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
    // A trip stop's dot opens its card; with a card open from a tap, a tap elsewhere just closes it.
    const stop = tripLayer?.hit(e.point, 14) ?? null;
    if (stop != null) {
      openStopTip(stop, true);
      return;
    }
    if (stopTip?.pinned) {
      closeStopTip();
      return;
    }
    // A storm's own click handler opens it; the map stays put.
    // A radar tower shows that radar's own scans.
    const tower = sitesLayer.hit(e.point);
    if (tower) {
      if (tower.id !== chosenSite?.id) void chooseSite(tower, siteFrames?.product ?? 'N0B');
      return;
    }
    // A storm cell or report opens its details; the map stays put.
    const cell = stormCells.hit(e.point);
    if (cell) {
      openStormHit(cell);
      return;
    }
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
      else if (mode === 'center' && store.get().selected === start && !hashView) {
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
  // The trip planner loads on first use: most visits never open it.
  let tripLayer: TripLayer | null = null;
  let trip: TripPanel | null = null;
  // Frame the route in the part of the map the panel doesn't cover.
  const tripPadding = () => {
    const r = $('#trip').getBoundingClientRect();
    return window.innerWidth < 700
      ? { top: 80, right: 70, left: 30, bottom: Math.max(120, window.innerHeight - r.top + 24) }
      : { top: 80, right: 80, bottom: 150, left: r.right + 30 };
  };
  const createTrip = async (): Promise<TripPanel> => {
    const [{ TripPanel }, { TripLayer }, { StopTip }] = await Promise.all([import('./ui/trip'), import('./map/tripLayer'), import('./ui/stopTip')]);
    const layer = new TripLayer(map, tripColors());
    tripLayer = layer;
    stopTip = new StopTip(() => [document.querySelector('.controls')]);
    trip = new TripPanel({
      myLocation: () => dot.position,
      near: () => store.get().selected,
      state: () => store.get(),
      show: (plan) => {
        closeStopTip();
        layer.set(plan, tripPadding());
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
    return trip;
  };
  // A stop's dot: hover it (tap on phones) for when you'll be there, the weather then, and any alerts.
  let stopTip: StopTip | null = null;
  let tipLeave = 0;
  let hoverStop: number | null = null;
  const stopScreenPoint = (i: number) => {
    const pt = trip?.stopPoint(i);
    if (!pt) return null;
    const p = map.project([pt.lon, pt.lat]);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  };
  const openStopTip = (i: number, pinned: boolean) => {
    if (!stopTip) return;
    window.clearTimeout(tipLeave);
    if (stopTip.shown === i && stopTip.pinned === pinned) return;
    const card = trip?.stopCard(i);
    const at = stopScreenPoint(i);
    if (!card || !at) return;
    stopTip.show(i, card, at.x, at.y, pinned);
    tripLayer?.highlight(i);
  };
  const closeStopTip = () => {
    window.clearTimeout(tipLeave);
    stopTip?.hide();
    tripLayer?.highlight(null);
  };
  if (matchMedia('(hover: hover)').matches) {
    map.on('mousemove', (e) => {
      if (!stopTip || !tripLayer) return;
      const i = tripLayer.hit(e.point, 8);
      if (i !== hoverStop) {
        hoverStop = i;
        map.getCanvas().style.cursor = i != null ? 'pointer' : '';
      }
      if (i != null) openStopTip(i, false);
      else if (stopTip.shown != null && !stopTip.pinned) {
        // A beat's grace, so sliding to the next dot glides the card instead of closing it.
        window.clearTimeout(tipLeave);
        tipLeave = window.setTimeout(closeStopTip, 140);
      }
    });
    map.getCanvas().addEventListener('mouseleave', () => {
      if (stopTip?.shown != null && !stopTip.pinned) closeStopTip();
    });
  }
  // The card stays with its dot as the map moves.
  map.on('move', () => {
    const i = stopTip?.shown;
    if (i == null) return;
    const at = stopScreenPoint(i);
    if (at) stopTip!.follow(at.x, at.y);
  });
  let tripLoading: Promise<TripPanel> | null = null;
  const loadTrip = () => (tripLoading ??= createTrip());
  $('#trip-btn').addEventListener('click', () => {
    void loadTrip()
      .then((t) => t.toggle())
      .catch(() => {
        tripLoading = null;
        showNote('Trip weather couldn’t load. Check your connection.');
      });
  });

  /* ---------- hurricanes ---------- */

  // What's shown (Layers → Hurricanes) and which model groups live in the store, remembered.
  const modelGroups = () => new Set<ModelGroup>(store.get().modelGroups);
  let storms: Storm[] = [];
  let stormGIS = new Map<string, StormGIS>();
  let outlook: Outlook | null = null;
  let windProbs: FeatureCollection | null = null;
  let windProbsKt = 0;
  let tropicsGenerated: string | null = null;
  let selectedStorm: string | null = null;
  let tropicsAt = 0;
  const tropical = new TropicalLayer(map, (id) => openStorm(id));
  tropical.setOptions(store.get().tropics);
  const drawTropics = () => tropical.set(storms, stormGIS, outlook, modelGroups(), windProbs);
  /** Wind-speed odds for the chosen threshold (fetched only when shown). */
  const loadWindProbs = async () => {
    const kt = store.get().tropics.windProb;
    windProbsKt = kt;
    windProbs = kt ? await getWindProbs(kt).catch(() => null) : null;
    if (kt === store.get().tropics.windProb) drawTropics();
  };
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
      groups: modelGroups,
      // The store redraws the map and the panel (see the subscription below).
      setGroup: (group, on) => {
        const groups = store.get().modelGroups.filter((g) => g !== group);
        store.set({ modelGroups: on ? [...groups, group] : groups });
      },
      select: (id) => {
        selectedStorm = id;
        rerenderStorm();
      },
      showOnMap: (id) => {
        sheet.close();
        const s = storms.find((x) => x.id === id);
        if (s) tropical.fit(s, stormGIS.get(id), modelGroups(), { top: 90, bottom: 170, left: 40, right: 70 });
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
  // One load at a time: callers that arrive mid-load share it.
  let tropicsLoading: Promise<void> | null = null;
  const refreshTropics = (): Promise<void> => (tropicsLoading ??= loadTropics().finally(() => (tropicsLoading = null)));
  const loadTropics = async () => {
    if (!store.get().layers.tropics) return;
    tropicsAt = Date.now();
    try {
      const r = await getStorms();
      storms = r.storms;
      tropicsGenerated = r.generated;
      // The pill can show now; the map layers follow (only the parts that are switched on).
      renderStormPill();
      const t = store.get().tropics;
      const want = { past: t.past, warnings: t.warnings, windField: t.windField, arrival: t.arrival, surge: t.surge };
      stormGIS = new Map(await Promise.all(storms.map(async (s) => [s.id, await getStormGIS(s.bin, undefined, want)] as const)));
    } catch {
      // Keep what's on the map.
    }
    outlook = await getOutlook().catch(() => outlook);
    const kt = store.get().tropics.windProb;
    if (kt) windProbs = await getWindProbs(kt).catch(() => windProbs);
    drawTropics();
    renderStormPill();
    rerenderStorm();
  };
  // After the first frame: the radar and basemap get the network first.
  map.once('load', () => window.setTimeout(() => void refreshTropics(), 800));

  // The hurricane tracker button (top right): on shows storms and opens the tracker; off hides them.
  const tropicsBtn = $<HTMLButtonElement>('#tropics-btn');
  tropicsBtn.append(svg(hurricaneMark));
  const renderTropicsBtn = () => {
    const on = store.get().layers.tropics;
    tropicsBtn.setAttribute('aria-pressed', String(on));
    tropicsBtn.setAttribute('aria-label', on ? 'Hide hurricanes' : 'Hurricane tracker');
  };
  renderTropicsBtn();
  tropicsBtn.addEventListener('click', async () => {
    const on = !store.get().layers.tropics;
    store.set({ layers: { ...store.get().layers, tropics: on } });
    if (!on) return;
    if (!storms.length || Date.now() - tropicsAt > 60_000) await refreshTropics();
    if (!store.get().layers.tropics) return;
    if (storms.length) openStorm(selectedStorm ?? strongest().id);
    else showNote('No active tropical systems');
  });

  /* ---------- lightning only ---------- */

  // One tap: radar and live lightning, nothing else (hurricanes, storm tracks, outlooks, alert areas,
  // clouds, wind, the weather map all off). Tap again for what was on before; changing any layer ends it.
  const boltBtn = $<HTMLButtonElement>('#bolt-btn');
  boltBtn.append(svg(boltMark));
  let beforeBolt: Pick<AppState, 'layers' | 'alertAreas' | 'weatherMap'> | null = null;
  const boltOnly = (s: AppState) =>
    s.layers.rain &&
    s.layers.thunder &&
    !s.layers.wind &&
    !s.layers.clouds &&
    !s.layers.tropics &&
    !s.layers.outlook &&
    !s.layers.cells &&
    !s.alertAreas &&
    s.weatherMap === 'none';
  const renderBoltBtn = () => {
    const on = beforeBolt != null;
    boltBtn.setAttribute('aria-pressed', String(on));
    boltBtn.setAttribute('aria-label', on ? 'Show the other layers again' : 'Lightning only');
  };
  boltBtn.addEventListener('click', () => {
    const s = store.get();
    if (beforeBolt) {
      const back = beforeBolt;
      beforeBolt = null;
      store.set({ layers: back.layers, alertAreas: back.alertAreas, weatherMap: back.weatherMap });
      renderBoltBtn();
      return;
    }
    beforeBolt = { layers: s.layers, alertAreas: s.alertAreas, weatherMap: s.weatherMap };
    if (sheet.current === 'storm') sheet.close();
    store.set({
      layers: { ...s.layers, rain: true, thunder: true, wind: false, clouds: false, tropics: false, outlook: false, cells: false },
      alertAreas: false,
      weatherMap: 'none',
    });
    renderBoltBtn();
    // The tap is the gesture that unlocks the crackle; say so if there's none in view.
    primeAudio();
    void loadLightning(true);
  });
  // Any other change to the layers ends lightning-only (the button lets go; nothing is put back).
  store.subscribe((s) => {
    if (beforeBolt && !boltOnly(s)) {
      beforeBolt = null;
      renderBoltBtn();
    }
  });

  /* ---------- refresh ---------- */

  // Refresh only while visible: a locked phone or background tab costs no
  // battery and no API calls, and catches up as soon as it comes back.
  const refreshIfStale = () => {
    if (document.hidden) return;
    if (Date.now() - lastLoaded >= CONDITIONS_REFRESH_MS) loadSelected(false);
    grids.refreshIfOlderThan(GRID_MAX_AGE_MS);
    const s = store.get();
    if (s.layers.clouds) cloudCutout.refresh();
    alertAreas.refreshIfStale();
    stormOutlook.refreshIfStale();
    void stormCells.refresh();
    // A new lightning frame every minute.
    void loadLightning();
    void refreshSiteScans();
    void refreshLive();
    refreshTimeline();
    if (Date.now() - hrrrCheckedAt > 15 * 60_000) void refreshHrrr();
    if (Date.now() - tropicsAt > 10 * 60_000) void refreshTropics();
  };
  setInterval(refreshIfStale, 60_000);
  document.addEventListener('visibilitychange', refreshIfStale);

  /* ---------- layers popover + settings ---------- */


  /* ---------- storm cells and reports ---------- */

  function openStormHit(hit: StormHit): void {
    if (hit.kind === 'cell') sheet.open('cell', cellTitle(hit.cell), cellPanel(hit.cell, store.get()), null);
    else sheet.open('report', reportTitle(hit.report), reportPanel(hit.report, store.get()), null);
  }

  /* ---------- alerts in view ---------- */

  // The alerts button counts the warnings and watches in view; its sheet lists them by type.
  const alertsBtn = $<HTMLButtonElement>('#alerts-btn');
  alertsBtn.prepend(svg(alertMark));
  const renderAlertsBadge = () => {
    const n = store.get().alertAreas ? alertAreas.inView().length : 0;
    const badge = $('#alerts-badge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    alertsBtn.setAttribute('aria-label', n ? `${n} alerts in view` : 'Alerts in view');
  };
  alertAreas.onChange = renderAlertsBadge;
  let alertShown: AlertItem | null = null;
  // Full alert records by link: the type list fetches them for area names, the detail view reuses them.
  const alertCache = new Map<string, Promise<Alert>>();
  const describeAlert = (item: AlertItem): Promise<Alert> => {
    let p = alertCache.get(item.props.url);
    if (!p) {
      p = getAlert(item.props.url);
      alertCache.set(item.props.url, p);
      p.catch(() => alertCache.delete(item.props.url));
      if (alertCache.size > 120) alertCache.delete(alertCache.keys().next().value!);
    }
    return p;
  };
  const alertsHooks: AlertsHooks = {
    frame: (items) => {
      const box = items.reduce(
        (b, a) => ({ west: Math.min(b.west, a.box.west), east: Math.max(b.east, a.box.east), south: Math.min(b.south, a.box.south), north: Math.max(b.north, a.box.north) }),
        { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
      );
      // Keep it clear of the sheet: the bottom half on phones, the right column on wide screens.
      const phone = window.innerWidth < 700;
      const padding = phone ? { top: 90, right: 70, left: 30, bottom: Math.round(window.innerHeight * 0.55) } : { top: 90, right: 460, left: 60, bottom: 160 };
      map.fitBounds([[box.west, box.south], [box.east, box.north]], { padding, maxZoom: 9, duration: 700 });
    },
    openType: (type) => {
      alertShown = null;
      sheet.update(`${type}s`, alertsOfType(type, alertAreas.inView(), alertsHooks));
    },
    openAlert: (item) => {
      alertShown = item;
      sheet.update(item.props.prod_type, alertDetail(item, null, false, alertsHooks));
      describeAlert(item)
        .then((a) => alertShown === item && sheet.update(item.props.prod_type, alertDetail(item, a, false, alertsHooks)))
        .catch(() => alertShown === item && sheet.update(item.props.prod_type, alertDetail(item, null, true, alertsHooks)));
    },
    back: () => {
      alertShown = null;
      sheet.update('Alerts in view', alertsList(alertAreas.inView(), alertsHooks));
    },
    describe: describeAlert,
  };
  alertsBtn.addEventListener('click', async () => {
    await alertAreas.ensure();
    alertShown = null;
    sheet.open('alerts', 'Alerts in view', alertsList(alertAreas.inView(), alertsHooks), alertsBtn, () => (alertShown = null));
  });
  const layersMenu = new LayersMenu(
    store,
    (layer, on) => {
      // Turning Lightning on is the user gesture that unlocks audio.
      if (layer === 'thunder' && on) {
        primeAudio();
        void loadLightning(true);
      }
    },
    (id) => mapSource.supports(id),
  );

  // Map only (last button on the right): every control hides; the docked weather page's padding goes too.
  const mapOnly = new MapOnly((on) => {
    if (on) {
      layersMenu.toggle(false);
      sheet.close();
    }
    map.setPadding({ top: 0, bottom: 0, left: 0, right: on ? 0 : Math.max(0, padRight) });
  });

  store.subscribe((s, prev) => {
    for (const layer of LAYERS) {
      const on = s.layers[layer];
      if (on === prev.layers[layer]) continue;
      if (layer === 'rain') {
        radar.setRadarOn(on);
        sitesLayer.setVisible(on);
      }
      else if (layer === 'clouds') cloudCutout.setVisible(on);
      else animator.layerChanged(layer, on);
    }
    if (streaksOn(s) !== streaksOn(prev)) animator.layerChanged('rain', streaksOn(s));
    if (s.layers.wind !== prev.layers.wind) wind.setActive(s.layers.wind);
    if (streaksOn(s) !== streaksOn(prev) || s.layers.thunder !== prev.layers.thunder || s.layers.wind !== prev.layers.wind) syncGrids();
    if (s.colorMode !== prev.colorMode) {
      setColorMode(map, s.colorMode);
      radar.setColorMode(s.colorMode);
    }
    if (s.precipType !== prev.precipType) radar.setPrecipType(s.precipType);
    if (s.layers.rain !== prev.layers.rain || s.colorMode !== prev.colorMode || s.weatherMap !== prev.weatherMap || s.precipType !== prev.precipType) renderBar();
    if (s.layers.cells !== prev.layers.cells || s.stormReports !== prev.stormReports) stormCells.set(s.layers.cells, s.stormReports);
    if (s.layers.thunder !== prev.layers.thunder) {
      lightning.setVisible(s.layers.thunder);
      if (!s.layers.thunder) {
        lightningCtrl?.abort();
        lightningArea = null;
        lightningDown = false;
        animator.setLightning(null);
      }
    }
    if (s.layers.outlook !== prev.layers.outlook || s.outlookKind !== prev.outlookKind || s.outlookDay !== prev.outlookDay) {
      stormOutlook.set(s.layers.outlook, s.outlookKind, s.outlookDay);
    }
    if (s.alertAreas !== prev.alertAreas) {
      alertAreas.setVisible(s.alertAreas);
      renderAlertsBadge();
    }
    if (s.layers.tropics !== prev.layers.tropics) {
      tropical.setVisible(s.layers.tropics);
      renderStormPill();
      renderTropicsBtn();
      if (s.layers.tropics && Date.now() - tropicsAt > 60_000) void refreshTropics();
    }
    if (s.tropics !== prev.tropics) {
      tropical.setOptions(s.tropics);
      // A part switched on that was never fetched (to save requests): fetch it now.
      const t = s.tropics;
      const p = prev.tropics;
      if ((t.past && !p.past) || (t.warnings && !p.warnings) || (t.windField && !p.windField) || (t.arrival && !p.arrival) || (t.surge && !p.surge)) {
        void refreshTropics();
      }
      if (s.tropics.windProb !== windProbsKt) void loadWindProbs();
    }
    if (s.modelGroups !== prev.modelGroups) {
      drawTropics();
      rerenderStorm();
    }
    if (s.followMap !== prev.followMap) {
      // Following again: the weather jumps to the cross. Pinning keeps the place on the card.
      if (s.followMap && mode === 'center') {
        const c = map.getCenter();
        select({ lat: c.lat, lon: wrapLon(c.lng) });
      }
      renderLocate();
      renderPin();
    }
    if (s.selected !== prev.selected) renderPin();
    if (s.basemap !== prev.basemap) setBasemap(map, s.basemap);
    if (s.weatherMap !== prev.weatherMap) showWeatherMap(s);
    if (s.weatherMap !== prev.weatherMap || s.selected !== prev.selected || s.tempUnit !== prev.tempUnit || s.windUnit !== prev.windUnit) {
      renderLegend();
    }
    if (s.basemap !== prev.basemap || s.layers !== prev.layers || s.tropics !== prev.tropics || s.weatherMap !== prev.weatherMap) {
      renderCredits(s);
    }
    if (s.theme !== prev.theme) {
      applyTheme(s);
      // Canvas and map colors don't read CSS; hand them the new tokens.
      palette.wind = palette.lightning = token('--fg');
      palette.rain = token('--muted');
      tripLayer?.setColors(tripColors());
    }
    if (s.tempUnit !== prev.tempUnit || s.windUnit !== prev.windUnit || s.theme !== prev.theme) {
      renderAll();
      trip?.refresh();
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
    if ((e.key === 'f' || e.key === 'F') && !typing) {
      e.preventDefault();
      mapOnly.toggle();
      return;
    }
    if (e.key === '/' && !typing && !mapOnly.on) {
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
  $('[data-credit="mrms"]').hidden = !s.layers.rain;
  $('[data-credit="ghe"]').hidden = !s.layers.rain;
  $('[data-credit="esri"]').hidden = s.basemap !== 'satellite';
  $('[data-credit="goes"]').hidden = !s.layers.clouds;
  $('[data-credit="glm"]').hidden = !s.layers.thunder;
  $('[data-credit="gibs"]').hidden = !((s.layers.tropics && s.tropics.sst) || s.weatherMap === 'infrared');
  $('[data-credit="eccc"]').hidden = !(GEOMET_MAPS.has(s.weatherMap) || s.layers.wind);
}

void main();

// Faster repeat visits, and a page that opens offline (public/sw.js). Production only: in dev it would cache Vite's modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
