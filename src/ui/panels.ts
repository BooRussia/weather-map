import type { Conditions } from '../data/conditions';
import type { Alert } from '../data/nws';
import { geocode, type GeocodeResult } from '../data/openmeteo';
import type { AppState, Store } from '../state';
import { formatTemp, formatWind, compass8 } from '../util/units';
import { sentenceCase } from '../util/text';
import { h } from './dom';

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
        'Wind and rain fields: Open-Meteo (CC BY 4.0), model data. Place, observations, forecast, alerts, and radar: NWS. Map © CARTO © OpenStreetMap contributors.',
      ),
    ),
  );
}

/* ---------- forecast ---------- */

/** "Wednesday Night" -> "Wed night"; "This Afternoon" -> "This afternoon". */
export function shortPeriodName(name: string): string {
  const m = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)( Night)?$/.exec(name);
  if (m) return m[1].slice(0, 3) + (m[2] ? ' night' : '');
  return sentenceCase(name);
}

function hourLabel(isoLocal: string): string {
  const hr = Number(isoLocal.slice(11, 13));
  const suffix = hr < 12 ? 'AM' : 'PM';
  return `${hr % 12 || 12} ${suffix}`;
}

export function forecastPanel(c: Conditions, s: AppState): HTMLElement {
  const list = h('ul', { class: 'rows' });
  if (c.periods.length) {
    for (const p of c.periods.slice(0, 7)) {
      list.append(
        h(
          'li',
          { class: 'data-row' },
          h('span', { class: 'data-when' }, shortPeriodName(p.name)),
          h('span', { class: 'data-temp' }, formatTemp(p.tempF, s.tempUnit)),
          h('span', { class: 'data-what' }, sentenceCase(p.shortForecast) + (p.precipChance ? `, ${p.precipChance}%` : '')),
        ),
      );
    }
  } else if (c.hourly.length) {
    for (const hr of c.hourly.slice(0, 12)) {
      list.append(
        h(
          'li',
          { class: 'data-row' },
          h('span', { class: 'data-when' }, hourLabel(hr.time)),
          h('span', { class: 'data-temp' }, formatTemp(hr.tempF, s.tempUnit)),
          h(
            'span',
            { class: 'data-what' },
            `${hr.precipProbability}% rain · ${compass8(hr.windFromDeg)} ${formatWind(hr.windMph, s.windUnit)}`,
          ),
        ),
      );
    }
  } else {
    list.append(h('li', { class: 'meta-text' }, 'Forecast loading'));
  }

  const obs = c.observation;
  const source = c.periods.length ? 'Forecast: NWS.' : 'Hourly: Open-Meteo.';
  const obsText = obs ? ` Observed at ${obs.stationName}, ${timeShort(obs.timestamp)}.` : '';
  return h('div', {}, list, h('p', { class: 'meta-text sheet-foot' }, source + obsText));
}

/* ---------- alerts ---------- */

function timeShort(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
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
