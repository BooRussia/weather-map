import { capeWord, cloudbaseFt, lapseRate, lapseWord, windsAloft, type Aloft, type AloftHour } from '../data/aloft';
import { clockLabel } from '../data/outlook';
import { BRIEFING_NOTE } from './airportPanel';
import { h, svg } from './dom';
import { chevronIcon, windIcon } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const ft = (v: number) => `${Math.round(v / 100) * 100 >= 1000 ? (Math.round(v / 100) * 100).toLocaleString() : Math.round(v / 100) * 100} ft`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The top of the chart, ft MSL: high enough for the standard altitudes most flights care about. */
const CHART_TOP_FT = 18000;

/**
 * The air over the place at one hour, drawn simply (a temperature–height chart, not a skew-T): the
 * temperature and dew point going up, where they meet is cloud; the mixed layer shaded (thermals),
 * cloudbase, the freezing line, and the wind at each standard altitude down the right.
 */
function sounding(hour: AloftHour, elevationFt: number, rows: ReturnType<typeof windsAloft>): SVGSVGElement {
  const W = 340;
  const H = 210;
  const pad = { l: 34, r: 66, t: 8, b: 20 };
  const pts = [{ ft: elevationFt, t: hour.surface.tempC, d: hour.surface.dewC }, ...hour.levels.map((l) => ({ ft: l.ft, t: l.tempC, d: l.dewC }))].filter(
    (p) => p.ft <= CHART_TOP_FT + 3000 && Number.isFinite(p.t),
  );
  const temps = pts.flatMap((p) => [p.t, p.d]).filter((v) => v >= -60);
  const lo = Math.floor(Math.min(...temps, -5) / 10) * 10;
  const hi = Math.ceil(Math.max(...temps, 5) / 10) * 10;
  const x = (c: number) => pad.l + ((c - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (f: number) => H - pad.b - (Math.min(f, CHART_TOP_FT) / CHART_TOP_FT) * (H - pad.t - pad.b);
  const s = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'aloft-chart', role: 'img', 'aria-label': 'Temperature and dew point going up' });
  // The mixed layer, where thermals go: shaded from the ground.
  if (hour.mixingFt) {
    const top = elevationFt + hour.mixingFt;
    s.append(el('rect', { x: pad.l, y: y(top), width: W - pad.l - pad.r, height: y(elevationFt) - y(top), class: 'aloft-mix' }));
    const t = el('text', { x: pad.l + 4, y: y(top) + 11, class: 'aloft-note' });
    t.textContent = 'Thermals';
    s.append(t);
  }
  // Altitude grid every 3,000 ft, labeled in thousands.
  for (let f = 0; f <= CHART_TOP_FT; f += 3000) {
    s.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(f), y2: y(f), class: 'aloft-grid' }));
    const t = el('text', { x: pad.l - 5, y: y(f) + 3, class: 'aloft-axis', 'text-anchor': 'end' });
    t.textContent = f ? `${f / 1000}k` : '0';
    s.append(t);
  }
  for (let c = lo; c <= hi; c += 10) {
    const t = el('text', { x: x(c), y: H - 6, class: 'aloft-axis', 'text-anchor': 'middle' });
    t.textContent = `${c}°`;
    s.append(t);
  }
  // Freezing: the 0 °C line, and the level where the air reaches it.
  if (lo < 0 && hi > 0) s.append(el('line', { x1: x(0), x2: x(0), y1: y(0), y2: y(CHART_TOP_FT), class: 'aloft-zero' }));
  if (hour.freezingFt != null && hour.freezingFt < CHART_TOP_FT) {
    s.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(hour.freezingFt), y2: y(hour.freezingFt), class: 'aloft-freeze' }));
    const t = el('text', { x: W - pad.r - 4, y: y(hour.freezingFt) - 4, class: 'aloft-note is-freeze', 'text-anchor': 'end' });
    t.textContent = 'Freezing';
    s.append(t);
  }
  // Cloudbase for rising air.
  const base = elevationFt + cloudbaseFt(hour.surface.tempC, hour.surface.dewC);
  if (base < CHART_TOP_FT) {
    s.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(base), y2: y(base), class: 'aloft-base' }));
    const t = el('text', { x: W - pad.r - 4, y: y(base) - 4, class: 'aloft-note', 'text-anchor': 'end' });
    t.textContent = 'Cloudbase';
    s.append(t);
  }
  const path = (key: 't' | 'd') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[key]).toFixed(1)} ${y(p.ft).toFixed(1)}`).join('');
  s.append(el('path', { d: path('d'), class: 'aloft-dew' }), el('path', { d: path('t'), class: 'aloft-temp' }));
  // The wind at each standard altitude: an arrow the way it blows, and its speed.
  for (const r of rows.filter((r) => r.ft <= CHART_TOP_FT)) {
    const g = el('g', { transform: `translate(${W - pad.r + 14} ${y(r.ft)})` });
    // Drawn pointing south (downwind of a north wind), turned by where the wind comes from.
    const a = el('path', { d: 'M0 -6 L0 6 M-3.5 2.5 L0 6 L3.5 2.5', class: 'aloft-arrow', transform: `rotate(${Math.round(r.dir)})` });
    const t = el('text', { x: 11, y: 4, class: 'aloft-axis' });
    t.textContent = `${Math.round(r.kt)} kt`;
    g.append(a, t);
    s.append(g);
  }
  return s;
}

/** "Now", "4 PM", "Fri 2 AM": the hour shown, by the place's clock. */
function hourName(hour: AloftHour, first: string, isNow: boolean): string {
  if (isNow) return 'Now';
  const day = hour.time.slice(0, 10) === first.slice(0, 10) ? '' : `${DOW[new Date(`${hour.time.slice(0, 10)}T12:00:00Z`).getUTCDay()]} `;
  return `${day}${clockLabel(hour.time, false)}`;
}

/**
 * Winds aloft (owner, 2026-10-29: pilot features), on the weather page when Layers → Aviation → Winds
 * aloft and sounding is on: an hour at a time (‹ › through the next two days), the chart, the winds and
 * temperatures at standard altitudes, and the numbers pilots plan by. `aloft`: undefined while loading.
 */
export function aloftCard(aloft: Aloft | null | undefined, index: number, nowIndex: number, step: (by: number) => void): HTMLElement | null {
  const head = h('h3', { class: 'card-head' }, svg(windIcon), 'Winds aloft');
  if (aloft === undefined) return h('section', { class: 'card glass' }, head, h('p', { class: 'card-text' }, 'Loading the air above'));
  if (!aloft || !aloft.hours.length) return null;
  const i = Math.max(0, Math.min(aloft.hours.length - 1, index));
  const hour = aloft.hours[i];
  const rows = windsAloft(hour, aloft.elevationFt);
  const prev = h('button', { type: 'button', class: 'aloft-step is-prev', 'aria-label': 'An hour earlier', disabled: i <= 0 }, svg(chevronIcon));
  const next = h('button', { type: 'button', class: 'aloft-step', 'aria-label': 'An hour later', disabled: i >= aloft.hours.length - 1 }, svg(chevronIcon));
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  const lapse = lapseRate(hour, aloft.elevationFt);
  const stats: [string, string][] = [
    ['Cloudbase', `≈ ${ft(cloudbaseFt(hour.surface.tempC, hour.surface.dewC))} above ground`],
    ['Thermals to', hour.mixingFt != null ? `≈ ${ft(hour.mixingFt)} above ground` : '–'],
    ['Lapse rate', lapse != null ? `${lapse.toFixed(1)} °C / 1,000 ft · ${lapseWord(lapse)}` : '–'],
    ['Freezing level', hour.freezingFt != null ? `${ft(hour.freezingFt)} MSL` : '–'],
    ['CAPE', hour.cape != null ? `${Math.round(hour.cape)} J/kg · ${capeWord(hour.cape)}` : '–'],
    ['Lifted index', hour.liftedIndex != null ? `${hour.liftedIndex.toFixed(1)}${hour.liftedIndex <= -3 ? ' · storms possible' : ''}` : '–'],
    ['CIN', hour.cin != null ? `${Math.round(hour.cin)} J/kg` : '–'],
  ];
  return h(
    'section',
    { class: 'card glass aloft' },
    head,
    h('div', { class: 'aloft-hour' }, prev, h('span', { class: 'aloft-when' }, hourName(hour, aloft.hours[0].time, i === nowIndex)), next),
    sounding(hour, aloft.elevationFt, rows),
    h('p', { class: 'aloft-key' }, h('i', { class: 'is-temp' }), 'Temperature', h('i', { class: 'is-dew' }), 'Dew point', h('i', { class: 'is-mix' }), 'Mixed layer'),
    h(
      'table',
      { class: 'mdl-table aloft-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Altitude MSL'), h('th', { scope: 'col' }, 'Wind'), h('th', { scope: 'col' }, 'Temp'))),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, r.ft.toLocaleString()),
            h('td', {}, r.kt < 3 ? 'Light' : `${String(Math.round(r.dir / 10) * 10 || 360).padStart(3, '0')}° ${Math.round(r.kt)} kt`),
            h('td', {}, `${r.tempC > 0 ? '+' : ''}${Math.round(r.tempC)}°C`),
          ),
        ),
      ),
    ),
    h('dl', { class: 'long-rows aloft-stats' }, ...stats.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('p', { class: 'pop-note' }, 'Source: Open-Meteo’s blend of the best models for the place, hourly. Cloudbase is for rising air (dew point spread × 410 ft).'),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}
