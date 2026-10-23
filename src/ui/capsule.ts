import type { Conditions } from '../data/conditions';
import { dayHours, dayOutlook, hourOfDay, type Metric } from '../data/dayDetail';
import type { Alert } from '../data/nws';
import type { AppState } from '../state';
import { formatTemp, formatWind, fToC, mphToKmh } from '../util/units';
import { $, h, svg } from './dom';
import { conditionLine, conditionWord, hiLoLine } from './format';
import { dropIcon, thermoIcon, umbrellaIcon, windIcon } from './icons';
import { tempColor } from './page';

/**
 * The glass readout for the selected point: "MY LOCATION" when it is you,
 * the place, the temperature, the condition, Apple's H:/L: line, and chips for today's highest
 * wind and chance of rain.
 */
export function renderCapsule(c: Conditions | null, s: AppState): void {
  $('#cap-kicker').hidden = !s.gps;
  $('#cap-gps').hidden = !s.gps;
  const place = $('#cap-place');
  const temp = $('#cap-temp');
  const cond = $('#cap-cond');
  const hilo = $('#cap-hilo');
  renderChips(c, s);
  renderSparks(c, s);
  if (!c) {
    place.textContent = 'Locating';
    temp.textContent = '--°';
    cond.textContent = '';
    hilo.textContent = '';
    return;
  }
  place.textContent = c.place ?? 'Locating';
  temp.textContent = c.tempF != null ? formatTemp(c.tempF, s.tempUnit) : '--°';
  // Liquid shows Apple's short condition; Classic keeps the original wind-inclusive line.
  cond.textContent = c.failed
    ? 'Weather unavailable. Map still works.'
    : s.theme === 'classic'
      ? conditionLine(c, s.windUnit)
      : conditionWord(c);
  hilo.textContent = hiLoLine(c, s);
  $('#capsule').setAttribute(
    'aria-label',
    `${s.gps ? 'My location, ' : ''}${c.place ?? 'Selected point'}, ${temp.textContent}, ${cond.textContent}, ${hilo.textContent}. Open weather details.`,
  );
}

/** The alert pill: the most severe alert's name, plus a count when there are more. */
export function renderAlertPill(alerts: Alert[]): void {
  const pill = $<HTMLButtonElement>('#alert-pill');
  renderAlertCount(alerts);
  if (!alerts.length) {
    pill.hidden = true;
    return;
  }
  const more = alerts.length > 1 ? ` +${alerts.length - 1}` : '';
  $('#alert-pill-text').textContent = `${alerts[0].event}${more}`;
  pill.setAttribute('aria-label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}: ${alerts[0].event}. Open details.`);
  pill.hidden = false;
}

function renderChips(c: Conditions | null, s: AppState): void {
  const today = c?.om?.daily[0];
  const day = today && c?.om ? dayOutlook(c.om.week, today.date, today.precipProbability) : null;
  $('#cap-chips').hidden = !day;
  if (!day) return;
  const wind = $('#cap-wind');
  wind.replaceChildren(svg(windIcon), h('span', {}, formatWind(day.maxWindMph, s.windUnit)));
  wind.setAttribute(
    'aria-label',
    `Highest wind today ${formatWind(day.maxWindMph, s.windUnit)}, gusts to ${formatWind(day.maxGustMph, s.windUnit)}. Show the wind chart.`,
  );
  wind.title = `Max wind today · gusts to ${formatWind(day.maxGustMph, s.windUnit)}`;
  const rain = $('#cap-rain');
  rain.replaceChildren(svg(umbrellaIcon), h('span', {}, `${Math.round(day.pop)}%`));
  rain.setAttribute('aria-label', `${Math.round(day.pop)}% chance of rain today. Show the rain chart.`);
  rain.title = 'Chance of rain today';
}

/* ---------- little line graphs (phones) ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Which graph's chart is open under the banner, so a redraw keeps it pressed. */
let sparkOpen: Metric | null = null;

export function setSparkOpen(metric: Metric | null): void {
  sparkOpen = metric;
  for (const b of document.querySelectorAll<HTMLElement>('#cap-sparks [data-metric]')) {
    b.setAttribute('aria-pressed', String(b.dataset.metric === metric));
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * A day's hours as one line, no axes or fill, with a dot at now. `domain` fixes the scale (percentages);
 * otherwise it fits the day. `stroke` is a color, or a gradient (top, bottom) for temperature.
 */
function sparkline(values: number[], now: number | null, stroke: string | [string, string], domain?: [number, number]): SVGSVGElement {
  const W = 64;
  const H = 22;
  const pad = 3;
  const lo = domain?.[0] ?? Math.min(...values);
  const hi = domain?.[1] ?? Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => pad + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / span) * (H - 2 * pad);
  const s = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'spark-line', 'aria-hidden': 'true' });
  let paint = typeof stroke === 'string' ? stroke : '';
  if (typeof stroke !== 'string') {
    const g = el('linearGradient', { id: 'spark-temp', x1: 0, y1: pad, x2: 0, y2: H - pad, gradientUnits: 'userSpaceOnUse' });
    g.append(el('stop', { offset: 0, 'stop-color': stroke[0] }), el('stop', { offset: 1, 'stop-color': stroke[1] }));
    const defs = el('defs', {});
    defs.append(g);
    s.append(defs);
    paint = 'url(#spark-temp)';
  }
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  s.append(el('path', { d, fill: 'none', stroke: paint, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  if (now != null) {
    const i0 = Math.min(values.length - 1, Math.floor(now));
    const v = values[i0] + ((values[i0 + 1] ?? values[i0]) - values[i0]) * (now - i0);
    const nx = (Math.min(now, values.length - 1) / Math.max(1, values.length - 1)) * W;
    // A zero-length round-capped line: a round dot however the graph stretches.
    s.append(el('line', { x1: nx, y1: y(v), x2: nx, y2: y(v), stroke: '#ffffff', 'stroke-width': 5, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  }
  return s;
}

/**
 * Today's temperature, wind, rain, and humidity, each as its peak in its own color over a line of the
 * day's hours (owner, 2026-10-23). Each opens its chart under the banner, like the chips.
 */
function renderSparks(c: Conditions | null, s: AppState): void {
  const box = $('#cap-sparks');
  const om = c?.om;
  const today = om?.daily[0];
  const { hours, own } = om && today ? dayHours(om.week, today.date) : { hours: [], own: 0 };
  box.hidden = !own;
  if (!om || !today || !own) return;
  const day = hours.slice(0, own);
  const now = hourOfDay(om.current.time, today.date);
  const classic = s.theme === 'classic';
  const ink = (color: string) => (classic ? '#f0f0fa' : color);
  const temp = (f: number) => (s.tempUnit === 'C' ? fToC(f) : f);
  const wind = (mph: number) => (s.windUnit === 'kmh' ? mphToKmh(mph) : mph);
  const maxWind = Math.max(...day.map((x) => x.windMph));
  const maxHumid = Math.max(...day.map((x) => x.humidity));
  const cells: { metric: Metric; label: string; icon: string; value: string; color: string; line: SVGSVGElement; say: string }[] = [
    {
      metric: 'conditions',
      icon: thermoIcon,
      label: 'High',
      value: formatTemp(today.hiF, s.tempUnit),
      color: ink(tempColor(today.hiF)),
      line: sparkline(
        day.map((x) => temp(x.tempF)),
        now,
        classic ? '#f0f0fa' : [tempColor(Math.max(...day.map((x) => x.tempF))), tempColor(Math.min(...day.map((x) => x.tempF)))],
      ),
      say: `High ${formatTemp(today.hiF, s.tempUnit)} today`,
    },
    {
      metric: 'wind',
      label: 'Wind',
      icon: windIcon,
      value: formatWind(maxWind, s.windUnit),
      color: ink('#64d2ff'),
      line: sparkline(day.map((x) => wind(x.windMph)), now, ink('#64d2ff'), [0, Math.max(wind(maxWind), wind(10))]),
      say: `Wind up to ${formatWind(maxWind, s.windUnit)} today`,
    },
    {
      metric: 'precip',
      label: 'Rain',
      icon: umbrellaIcon,
      value: `${Math.round(today.precipProbability)}%`,
      color: ink('#7d7aff'),
      line: sparkline(day.map((x) => x.precipProbability), now, ink('#7d7aff'), [0, 100]),
      say: `${Math.round(today.precipProbability)}% chance of rain today`,
    },
    {
      metric: 'humidity',
      label: 'Humidity',
      icon: dropIcon,
      value: `${Math.round(maxHumid)}%`,
      color: ink('#30d158'),
      line: sparkline(day.map((x) => x.humidity), now, ink('#30d158'), [0, 100]),
      say: `Humidity up to ${Math.round(maxHumid)}% today`,
    },
  ];
  box.replaceChildren(
    ...cells.map((k) => {
      const b = h(
        'button',
        { type: 'button', class: 'spark', 'data-metric': k.metric, 'aria-pressed': String(sparkOpen === k.metric), 'aria-label': `${k.say}. Show the chart.` },
        h('span', { class: 'spark-label' }, k.label),
        // The icon tells the numbers apart in the small banner, where the labels and lines go.
        h('span', { class: 'spark-value' }, svg(k.icon), k.value),
        k.line,
      );
      (b.querySelector('.spark-value') as HTMLElement).style.color = k.color;
      return b;
    }),
  );
}

/** The small banner's alert mark (phones): a triangle with how many alerts are in effect inside it. */
function renderAlertCount(alerts: Alert[]): void {
  const b = $('#cap-alerts');
  b.hidden = !alerts.length;
  if (!alerts.length) return;
  const n = alerts.length > 9 ? '9+' : String(alerts.length);
  const tri = document.createElementNS(SVG_NS, 'svg');
  tri.setAttribute('viewBox', '0 0 28 25');
  tri.setAttribute('aria-hidden', 'true');
  tri.innerHTML = `<path d="M12.3 2.9a2 2 0 0 1 3.4 0l10.6 18.6a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3z" /><text x="14" y="20.5" text-anchor="middle">${n}</text>`;
  b.replaceChildren(tri);
  b.setAttribute('aria-label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}: ${alerts[0].event}. Open details.`);
}
