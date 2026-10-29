import './styles.css';
import '@fontsource-variable/manrope';
import { DEFAULT_LOCATION, type LatLon } from './config';
import { loadConditions, type Conditions } from './data/conditions';
import { createStore } from './state';
import { renderAlertPill, renderCapsule, renderRainSoon } from './ui/capsule';
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

/** Fill the width the TV gives the page, and tell the launcher how tall that makes it (if it asks). */
function fit(): void {
  head.style.zoom = String(Math.max(0.2, innerWidth / DESIGN_WIDTH));
  const r = head.getBoundingClientRect();
  (window as { GlassHome?: { bannerSize?: (w: number, h: number) => void } }).GlassHome?.bannerSize?.(Math.ceil(r.width), Math.ceil(r.height));
}

let conditions: Conditions | null = null;
let point: LatLon | null = null;
let pointAt = 0;
let ctrl: AbortController | null = null;

const draw = () => {
  renderCapsule(conditions, store.get(), { fullGraphs: 'today' });
  renderAlertPill(conditions?.alerts ?? []);
  fit();
};

async function refresh(): Promise<void> {
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

draw();
void refresh();
setInterval(() => void refresh(), REFRESH_MS);
// Rain starting or stopping counts down by the minute.
setInterval(() => {
  renderRainSoon(conditions);
  fit();
}, 60_000);
addEventListener('resize', fit);
