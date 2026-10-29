import './styles.css';
import '@fontsource-variable/manrope';
import { DEFAULT_LOCATION, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { createStore } from './state';
import { briefing } from './data/briefing';
import { rainSoon } from './data/outlook';
import { renderAlertPill, renderCapsule, renderRainSoon } from './ui/capsule';
import { formatTemp } from './util/units';
import { $, svg } from './ui/dom';
import { locateIcon } from './ui/icons';
import { fetchJson } from './util/http';
import { currentFix } from './util/position';

/**
 * The weather banner alone, for a TV home screen (owner, 2026-10-29: the Fire TV launcher shows it
 * centered at the top). Nothing to drag or press: the full banner, the days across with today's graphs
 * under them, so the day's peaks and the week are one glance, and where you are on the left.
 *
 * The page is transparent and lays the banner out at DESIGN_WIDTH, then scales it to fill the width
 * it's given. Query: `lat` & `lon` set the place; otherwise the device's location, else the internet
 * connection's (GeoJS), else the default. `units=metric` for °C and km/h. `embed=glasshome`: inside
 * Glass Home's glass top bar (Fire TV session, 2026-10-29), no panel of its own, Manrope, and the
 * launcher's type hierarchy and accent colors (styles.css, html.embed-glasshome).
 *
 * For the launcher: `GlassHome.bannerSize(w, h)` and `GlassHome.briefing(text)` (the day in a
 * sentence) are called when they change; `window.glassHomeRefresh()` fetches the weather again in
 * place, touching the page only where something changed.
 */
const DESIGN_WIDTH = 1040;
/** New weather this often; where you are, less often. */
const REFRESH_MS = 10 * 60_000;
const RELOCATE_MS = 3 * 60 * 60_000;
/** GeoJS: the approximate place of an internet connection, free, no key, open to browsers. */
const IP_PLACE = 'https://get.geojs.io/v1/ip/geo.json';

const q = new URLSearchParams(location.search);
if (q.get('embed') === 'glasshome') document.documentElement.classList.add('embed-glasshome');

async function whereAreYou(): Promise<LatLon> {
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (q.has('lat') && q.has('lon') && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  // TVs rarely know where they are; their internet connection does, roughly (city level).
  const fix = await currentFix({ enableHighAccuracy: false, timeout: 4000, maximumAge: RELOCATE_MS }).catch(() => null);
  if (fix) return fix;
  try {
    const r = await fetchJson<{ latitude: string; longitude: string }>(IP_PLACE, { timeoutMs: 8000 });
    const at = { lat: Number(r.latitude), lon: Number(r.longitude) };
    if (Number.isFinite(at.lat) && Number.isFinite(at.lon)) return at;
  } catch {
    // The default, below.
  }
  return DEFAULT_LOCATION;
}

const metric = q.get('units') === 'metric';
const store = createStore(DEFAULT_LOCATION, true);
store.set({ bannerForecast: 'daily', tempUnit: metric ? 'C' : 'F', windUnit: metric ? 'kmh' : 'mph', theme: 'liquid' });

$('#cap-gps').append(svg(locateIcon));
const head = $('.phone-head');

/** The launcher's bridge (Glass Home, on the Fire TV), when there is one. */
const bridge = () =>
  (window as { GlassHome?: { bannerSize?: (w: number, h: number) => void; briefing?: (text: string) => void } }).GlassHome;

/**
 * Fill the width the TV gives the page, and tell the launcher how tall that makes it: only when either
 * changed, since every repaint costs the TV's GPU.
 */
let zoomed = '';
let sized = '';
function fit(): void {
  const z = String(Math.max(0.2, innerWidth / DESIGN_WIDTH));
  if (z !== zoomed) head.style.zoom = zoomed = z;
  const r = head.getBoundingClientRect();
  const size = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`;
  if (size === sized) return;
  sized = size;
  bridge()?.bannerSize?.(Math.ceil(r.width), Math.ceil(r.height));
}

let conditions: Conditions | null = null;
let point: LatLon | null = null;
let pointAt = 0;
let ctrl: AbortController | null = null;
let loading: Promise<void> | null = null;

const temp = (f: number) => formatTemp(f, store.get().tempUnit);

/**
 * Everything the banner shows, in the units it shows it: when this hasn't changed, a refresh leaves
 * the page alone (Fire TV session, 2026-10-29: a refresh that changes nothing should repaint nothing).
 */
function shown(c: Conditions | null): string {
  const om = c?.om;
  const today = om?.daily[0]?.date;
  return JSON.stringify([
    c?.place,
    c?.tempF != null ? temp(c.tempF) : null,
    c?.condition,
    om?.daily.map((d) => [d.date, temp(d.hiF), temp(d.loF), Math.round(d.precipProbability), d.weatherCode]),
    // Today's graphs: the hours, rounded as drawn, and where now is.
    om?.week.filter((x) => x.time.startsWith(today ?? '-')).map((x) => [Math.round(x.tempF), Math.round(x.windMph), Math.round(x.precipProbability), Math.round(x.humidity)]),
    om?.current.time.slice(0, 13),
    c?.alerts.map((a) => a.id),
    c?.failed,
  ]);
}

let drawn = '';
let soon = '';
let told = '';
const draw = () => {
  const now = shown(conditions);
  if (now !== drawn) {
    drawn = now;
    renderCapsule(conditions, store.get(), { fullGraphs: 'today' });
    renderAlertPill(conditions?.alerts ?? []);
    soon = $('#cap-soon').textContent ?? '';
  }
  rainLine();
  fit();
  // The day in a sentence, for the launcher to show by its clock (only when it reads differently).
  const om = conditions?.om;
  const text = om?.daily.length ? briefing(om, temp) : '';
  if (text && text !== told) {
    told = text;
    bridge()?.briefing?.(text);
  }
};

/** Rain starting or stopping counts down by the minute: redrawn only when its words change. */
function rainLine(): void {
  const om = conditions?.om;
  const nowLocal = om ? new Date(Date.now() + om.utcOffsetSeconds * 1000).toISOString().slice(0, 16) : '';
  const text = om ? (rainSoon(om.minutely, nowLocal)?.text ?? '') : '';
  if (text === soon) return;
  renderRainSoon(conditions);
  soon = $('#cap-soon').textContent ?? '';
}

async function load(): Promise<void> {
  if (!point || Date.now() - pointAt > RELOCATE_MS) {
    const at = await whereAreYou();
    // A new place starts fresh; the same one keeps what's shown while it reloads.
    if (!point || Math.hypot(at.lat - point.lat, at.lon - point.lon) > 0.05) conditions = null;
    point = at;
    pointAt = Date.now();
  }
  ctrl?.abort();
  ctrl = new AbortController();
  await loadConditions(point, ctrl.signal, conditions, (c) => {
    conditions = c;
    draw();
  }).catch(() => {});
}

/** Fetch the weather again; a call while one is under way waits for that one. */
function refresh(): Promise<void> {
  loading ??= load().finally(() => (loading = null));
  return loading;
}

// Glass Home calls this each time the home screen comes back to the front.
(window as { glassHomeRefresh?: () => Promise<void> }).glassHomeRefresh = refresh;

draw();
void refresh();
setInterval(() => void refresh(), REFRESH_MS);
setInterval(() => {
  rainLine();
  fit();
}, 60_000);
addEventListener('resize', fit);
