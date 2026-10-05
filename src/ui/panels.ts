import type { Conditions } from '../data/conditions';
import type { Alert } from '../data/nws';
import { geocode, type GeocodeResult, type PointForecast } from '../data/openmeteo';
import { clockLabel, hourlyCells, nextRain, uvWord, weekRows } from '../data/outlook';
import type { AppState, Store } from '../state';
import { formatTemp, formatWind, compass8 } from '../util/units';
import { sentenceCase } from '../util/text';
import { h, svg } from './dom';
import { chevronIcon, GLYPHS, warningIcon } from './icons';

/* ---------- shared bits ---------- */

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'sheet-section' }, h('h3', { class: 'label' }, title), ...children);
}

interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** Sharp segmented control; the chosen segment is filled with `foreground`. */
function segmented<T extends string>(
  name: string,
  options: SegOption<T>[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': name });
  for (const o of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === current) }, o.label);
    b.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(o.value);
    });
    group.append(b);
  }
  return h('div', { class: 'row' }, h('span', {}, name), group);
}

/* ---------- settings ---------- */

export interface SettingsActions {
  place: () => string;
  pickPlace: (lat: number, lon: number) => void;
  useMyLocation: () => Promise<boolean>;
}

export function settingsPanel(store: Store, actions: SettingsActions): HTMLElement {
  const s = store.get();

  // Location: search (debounced) + current position.
  const input = h('input', {
    type: 'search',
    class: 'input',
    placeholder: 'Search a city or town',
    'aria-label': 'Search a city or town',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  const results = h('ul', { class: 'results', 'aria-live': 'polite' });
  const status = h('p', { class: 'muted-text' }, `Showing ${actions.place()}`);
  let timer = 0;
  let ctrl: AbortController | null = null;

  const runSearch = async () => {
    const q = input.value.trim();
    ctrl?.abort();
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }
    ctrl = new AbortController();
    try {
      const found = await geocode(q, ctrl.signal);
      results.replaceChildren(
        ...(found.length ? found.slice(0, 6).map(resultRow) : [h('li', { class: 'meta-text' }, 'No matches')]),
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') results.replaceChildren(h('li', { class: 'meta-text' }, 'Search unavailable'));
    }
  };

  const resultRow = (r: GeocodeResult) => {
    const label = [r.name, r.region, r.country === 'US' ? '' : r.country].filter(Boolean).join(', ');
    const b = h('button', { type: 'button', class: 'result' }, label);
    b.addEventListener('click', () => actions.pickPlace(r.lat, r.lon));
    return h('li', {}, b);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(runSearch, 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      void runSearch();
    }
  });

  const locate = h('button', { type: 'button', class: 'btn' }, 'Use my location');
  locate.addEventListener('click', async () => {
    locate.textContent = 'Locating';
    const ok = await actions.useMyLocation();
    locate.textContent = ok ? 'Use my location' : 'Location unavailable';
  });

  return h(
    'div',
    {},
    section('Location', status, input, results, locate),
    section(
      'Units',
      segmented('Temperature', [{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }], s.tempUnit, (v) =>
        store.set({ tempUnit: v }),
      ),
      segmented('Wind', [{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }], s.windUnit, (v) =>
        store.set({ windUnit: v }),
      ),
    ),
    section(
      'Map',
      segmented('Style', [{ value: 'dark', label: 'Dark' }, { value: 'satellite', label: 'Satellite' }], s.basemap, (v) =>
        store.set({ basemap: v }),
      ),
      segmented('Colors', [{ value: 'mono', label: 'Mono' }, { value: 'color', label: 'Color' }], s.colorMode, (v) =>
        store.set({ colorMode: v }),
      ),
      segmented('Alert areas', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.alertAreas ? 'on' : 'off', (v) =>
        store.set({ alertAreas: v === 'on' }),
      ),
      h(
        'p',
        { class: 'muted-text' },
        'Color shows real ground on Satellite and radar intensity: blue and green are light, yellow and orange moderate, red heavy. Alert areas outline NWS warnings and tint watches.',
      ),
    ),
    section(
      'Rain',
      segmented('Falling rain', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.rainStreaks ? 'on' : 'off', (v) =>
        store.set({ rainStreaks: v === 'on' }),
      ),
      h('p', { class: 'muted-text' }, 'Turn falling rain off to see only the radar.'),
    ),
    section(
      'Thunder',
      segmented('Sound', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.sound ? 'on' : 'off', (v) =>
        store.set({ sound: v === 'on' }),
      ),
      h(
        'p',
        { class: 'muted-text' },
        'Lightning is approximate. Strikes are placed inside forecast thunderstorm cells at random times; this is not a live strike feed.',
      ),
    ),
    section(
      'Data',
      h(
        'p',
        { class: 'meta-text' },
        'Wind and rain fields: Open-Meteo (CC BY 4.0), model data. Place, observations, forecast, alerts, and radar: NWS. Clouds: NOAA GOES infrared via nowCOAST, minutes old. Satellite imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Map © CARTO © OpenStreetMap contributors.',
      ),
    ),
  );
}

/* ---------- detail sheet ---------- */

/** "Wednesday Night" -> "Wed night"; "This Afternoon" -> "This afternoon". */
export function shortPeriodName(name: string): string {
  const m = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)( Night)?$/.exec(name);
  if (m) return m[1].slice(0, 3) + (m[2] ? ' night' : '');
  return sentenceCase(name);
}

export interface DetailActions {
  openAlerts: () => void;
}

/** Sheet section: hairline above, optional meta label. */
function block(title: string | null, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'sheet-section' }, title ? h('h3', { class: 'label' }, title) : null, ...children);
}

/**
 * Everything behind the HUD, top to bottom: alerts, next 2 hours, hourly,
 * 7 days, details, sources. Patterns from Apple Weather and (Not Boring),
 * drawn in our tokens. See docs/inspiration.md.
 */
export function detailPanel(c: Conditions, s: AppState, actions: DetailActions): HTMLElement {
  const om = c.om;
  return h(
    'div',
    { class: 'detail' },
    c.alerts.length ? alertRows(c.alerts, actions) : null,
    om?.minutely.length ? nextRainBlock(om, s) : null,
    om?.hourly.length ? hourlyBlock(om, s) : null,
    om?.daily.length ? weekBlock(c, om, s) : null,
    om ? detailsBlock(om, s) : null,
    !om && !c.periods.length ? h('p', { class: 'muted-text' }, 'Forecast loading') : null,
    sourcesNote(c),
  );
}

function alertRows(alerts: Alert[], actions: DetailActions): HTMLElement {
  return block(
    null,
    ...alerts.slice(0, 3).map((a) => {
      const row = h(
        'button',
        { type: 'button', class: 'alert-row' },
        svg(warningIcon),
        h('span', { class: 'alert-row-event' }, a.event),
        h('span', { class: 'alert-row-until' }, a.ends ? `until ${timeShort(a.ends)}` : ''),
        svg(chevronIcon),
      );
      row.addEventListener('click', actions.openAlerts);
      return row;
    }),
  );
}

function rateText(mmH: number, s: AppState): string {
  return s.tempUnit === 'F' ? `${(mmH / 25.4).toFixed(2)} in/h` : `${mmH.toFixed(1)} mm/h`;
}

function nextRainBlock(om: PointForecast, s: AppState): HTMLElement {
  const r = nextRain(om.minutely);
  const sentence = h('p', { class: 'body-text' }, r.sentence);
  if (!r.levels.some((l) => l > 0)) return block('Next 2 hours', sentence);

  const bars = h('div', { class: 'rain-bars', 'aria-hidden': 'true' });
  r.levels.forEach((lv, i) => {
    const bar = h('span', { class: 'rain-bar', title: `${clockLabel(om.minutely[i].time)}: ${rateText(r.rates[i], s)}` });
    // A trace still gets a visible sliver.
    bar.style.height = lv > 0 ? `${Math.max(6, Math.round(lv * 100))}%` : '0';
    bars.append(bar);
  });
  const axis = h(
    'div',
    { class: 'rain-axis', 'aria-hidden': 'true' },
    ...['Now', '30m', '1h', '1h 30m', '2h'].map((t) => h('span', {}, t)),
  );
  // The values for screen readers; the bars are a picture of this table.
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Rain rate, next 2 hours'),
    ...om.minutely.map((m, i) => h('tr', {}, h('th', {}, clockLabel(m.time)), h('td', {}, rateText(r.rates[i], s)))),
  );
  return block('Next 2 hours', sentence, h('div', { class: 'rain-chart' }, bars, axis), table);
}

function hourlyBlock(om: PointForecast, s: AppState): HTMLElement {
  const strip = h('ol', { class: 'hour-strip' });
  for (const cell of hourlyCells(om.hourly, om.daily)) {
    strip.append(
      cell.kind === 'hour'
        ? h(
            'li',
            { class: 'hour-cell' },
            h('span', { class: 'hour-time' }, cell.label),
            svg(GLYPHS[cell.glyph]),
            h('span', { class: 'hour-temp' }, formatTemp(cell.tempF, s.tempUnit)),
            h('span', { class: 'hour-pop' }, cell.pop >= 20 ? `${cell.pop}%` : ''),
          )
        : h(
            'li',
            { class: 'hour-cell is-sun' },
            h('span', { class: 'hour-time' }, cell.label),
            svg(GLYPHS[cell.event]),
            h('span', { class: 'hour-temp' }, cell.event),
            h('span', { class: 'hour-pop' }, ''),
          ),
    );
  }
  return block('Next 24 hours', strip);
}

function weekBlock(c: Conditions, om: PointForecast, s: AppState): HTMLElement {
  const first = c.periods[0];
  const nws = first
    ? h('p', { class: 'muted-text week-nws' }, `NWS · ${shortPeriodName(first.name)}: ${sentenceCase(first.shortForecast)}`)
    : null;
  const list = h('ol', { class: 'week' });
  for (const d of weekRows(om.daily, c.tempF)) {
    const range = h('span', { class: 'range', 'aria-hidden': 'true' });
    const seg = h('span', { class: 'range-seg' });
    seg.style.left = `${(d.left * 100).toFixed(1)}%`;
    seg.style.width = `${Math.max(2, d.width * 100).toFixed(1)}%`;
    range.append(seg);
    if (d.now != null) {
      const tick = h('span', { class: 'range-now' });
      tick.style.left = `${(d.now * 100).toFixed(1)}%`;
      range.append(tick);
    }
    list.append(
      h(
        'li',
        {
          class: 'week-row',
          'aria-label': `${d.label}: low ${formatTemp(d.loF, s.tempUnit)}, high ${formatTemp(d.hiF, s.tempUnit)}, ${d.pop}% chance of rain`,
        },
        h('span', { class: 'week-day' }, d.label),
        svg(GLYPHS[d.glyph]),
        h('span', { class: 'week-pop' }, d.pop >= 20 ? `${d.pop}%` : ''),
        h('span', { class: 'week-lo' }, formatTemp(d.loF, s.tempUnit)),
        range,
        h('span', { class: 'week-hi' }, formatTemp(d.hiF, s.tempUnit)),
      ),
    );
  }
  return block('7 days', nws, list);
}

function visibilityText(m: number, s: AppState): string {
  if (s.tempUnit === 'C') return m >= 10_000 ? '10+ km' : `${(m / 1000).toFixed(m < 3000 ? 1 : 0)} km`;
  const mi = m / 1609.344;
  return mi >= 10 ? '10+ mi' : `${mi.toFixed(mi < 3 ? 1 : 0)} mi`;
}

/** Spec-sheet rows: LABEL ———— value. The (Not Boring) detail layout with Apple's facts. */
function detailsBlock(om: PointForecast, s: AppState): HTMLElement {
  const cur = om.current;
  const today = om.daily[0];
  const pressure =
    s.tempUnit === 'F' ? `${(cur.pressureHpa * 0.02953).toFixed(2)} inHg` : `${Math.round(cur.pressureHpa)} hPa`;
  const rows: [string, string][] = [
    ['Feels like', formatTemp(cur.feelsF, s.tempUnit)],
    ['Humidity', `${Math.round(cur.humidity)}%`],
    ['Dew point', formatTemp(cur.dewF, s.tempUnit)],
    ['Wind', cur.windMph < 1 ? 'Calm' : `${compass8(cur.windFromDeg)} ${formatWind(cur.windMph, s.windUnit)}`],
    ['Gusts', formatWind(cur.gustMph, s.windUnit)],
    ['Pressure', pressure],
    ['Visibility', visibilityText(cur.visibilityM, s)],
    ['UV index', `${Math.round(cur.uv)} ${uvWord(cur.uv)}`],
  ];
  if (today) rows.push(['Sunrise', clockLabel(today.sunrise)], ['Sunset', clockLabel(today.sunset)]);
  return block(
    'Details',
    h('dl', { class: 'spec' }, ...rows.map(([k, v]) => h('div', { class: 'spec-row' }, h('dt', {}, k), h('dd', {}, v)))),
  );
}

function sourcesNote(c: Conditions): HTMLElement {
  const obs = c.observation;
  const parts = [
    'Hourly, 7 days, next 2 hours, and details: Open-Meteo.',
    c.periods.length ? 'Forecast text: NWS.' : null,
    obs ? `Observed at ${obs.stationName}, ${timeShort(obs.timestamp)}.` : null,
  ];
  return h('p', { class: 'meta-text sheet-foot' }, parts.filter(Boolean).join(' '));
}

/* ---------- alerts ---------- */

/** "8:00 PM" today, "Tue 8:00 PM" otherwise. */
function timeShort(d: Date): string {
  const today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, today ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** NWS text is hard-wrapped near 70 columns; keep paragraph breaks, drop the rest. */
export function reflow(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function alertsPanel(alerts: Alert[]): HTMLElement {
  if (!alerts.length) return h('p', { class: 'meta-text' }, 'No active alerts for this point.');
  return h(
    'div',
    {},
    ...alerts.map((a) =>
      h(
        'article',
        { class: 'sheet-section alert' },
        h('h3', { class: 'alert-event' }, a.event),
        h(
          'p',
          { class: 'meta-text' },
          [a.ends ? `Until ${timeShort(a.ends)}` : null, a.severity !== 'Unknown' ? a.severity : null, a.sender]
            .filter(Boolean)
            .join(' · '),
        ),
        a.description ? h('p', { class: 'prose' }, reflow(a.description)) : null,
        a.instruction ? h('p', { class: 'prose' }, reflow(a.instruction)) : null,
        a.areaDesc ? h('p', { class: 'meta-text' }, a.areaDesc) : null,
      ),
    ),
  );
}
