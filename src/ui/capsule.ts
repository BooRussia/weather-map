import { briefing } from '../data/briefing';
import type { Conditions } from '../data/conditions';
import { dayHours, dayOutlook, hourOfDay, type Metric } from '../data/dayDetail';
import { glyphFor, rainSoon, weekRows } from '../data/outlook';
import type { Alert } from '../data/nws';
import type { AppState } from '../state';
import { formatTemp, formatWind, fToC, windIn } from '../util/units';
import { $, h, svg } from './dom';
import { conditionLine, conditionWord, hiLoLine } from './format';
import { dropIcon, GLYPHS, thermoIcon, umbrellaIcon, windIcon } from './icons';
import { tempColor } from './page';

/**
 * The glass readout for the selected point: "MY LOCATION" when it is you,
 * the place, the temperature, the condition, Apple's H:/L: line, and chips for today's highest
 * wind and chance of rain.
 */
export function renderCapsule(c: Conditions | null, s: AppState, opts: { fullGraphs?: 'today' | 'week' } = {}): void {
  $('#cap-kicker').hidden = !s.gps;
  $('#cap-gps').hidden = !s.gps;
  const place = $('#cap-place');
  const temp = $('#cap-temp');
  const cond = $('#cap-cond');
  const hilo = $('#cap-hilo');
  const brief = $('#cap-brief');
  renderRainSoon(c);
  renderChips(c, s);
  renderSparks(c, s);
  renderTrend(c, s);
  placePeakLetters();
  // And again whenever the graphs change size or come into view (the banner's size, the window's).
  if (!trendWatch) {
    trendWatch = new ResizeObserver(() => placePeakLetters());
    trendWatch.observe($('#cap-trend'));
  }
  renderWeek(c, s);
  // Which graphs show (styles.css): the full banner's follow its strip, the small banner's the setting.
  const wrap = $('.cap-wrap');
  wrap.dataset.fullGraphs = opts.fullGraphs ?? (s.bannerForecast === 'daily' ? 'week' : 'today');
  wrap.dataset.smallGraphs = s.bannerGraphs;
  wrap.dataset.smallView = s.smallBanner;
  if (!c) {
    place.textContent = 'Locating';
    temp.textContent = '--°';
    cond.textContent = '';
    hilo.textContent = '';
    brief.hidden = true;
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
  // The day in a sentence (owner, 2026-10-29: the TV's briefing, on the desktop banner too); styles.css
  // shows it only where the wide banner's left side has room.
  brief.textContent = c.om?.daily.length && !c.failed ? briefing(c.om, (f) => formatTemp(f, s.tempUnit)) : '';
  brief.hidden = !brief.textContent;
  $('#capsule').setAttribute(
    'aria-label',
    `${s.gps ? 'My location, ' : ''}${c.place ?? 'Selected point'}, ${temp.textContent}, ${cond.textContent}, ${hilo.textContent}. ${brief.textContent ? `${brief.textContent} ` : ''}Open weather details.`,
  );
}

/**
 * Rain starting or stopping in the next two hours, under the place (owner, 2026-10-29: Dark Sky's
 * "rain starting in 12 min"), in both sizes, only when there's some; counted from now, so it's redrawn
 * every minute.
 */
export function renderRainSoon(c: Conditions | null): void {
  const line = $('#cap-soon');
  const om = c?.om;
  const now = om ? new Date(Date.now() + om.utcOffsetSeconds * 1000).toISOString().slice(0, 16) : '';
  const soon = om ? rainSoon(om.minutely, now) : null;
  line.hidden = !soon;
  if (!soon) return;
  line.replaceChildren(svg(umbrellaIcon), h('span', {}, soon.text));
  line.classList.toggle('is-wet', soon.wet);
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

/* ---------- little line graphs ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Which chart is open under the banner, and for which day (null: today's, from the graphs), so a redraw keeps its button pressed. */
let openMetric: Metric | null = null;
let openDate: string | null = null;

export function setSparkOpen(metric: Metric | null, date: string | null = null): void {
  openMetric = metric;
  openDate = metric ? date : null;
  for (const b of document.querySelectorAll<HTMLElement>('#cap-sparks [data-metric]')) {
    b.setAttribute('aria-pressed', String(!openDate && b.dataset.metric === openMetric));
  }
  for (const b of document.querySelectorAll<HTMLElement>('#cap-trend [data-metric]')) {
    b.setAttribute('aria-pressed', String(!!openDate && b.dataset.metric === openMetric && b.dataset.day === openDate));
  }
  for (const b of document.querySelectorAll<HTMLElement>('#cap-week .wk[data-day]')) {
    b.setAttribute('aria-pressed', String(openMetric === 'conditions' && b.dataset.day === openDate));
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A round dot however the graph stretches: a zero-length line with round caps. */
const dot = (x: number, y: number, color: string, size: number) =>
  el('line', { x1: x, y1: y, x2: x, y2: y, stroke: color, 'stroke-width': size, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' });

interface LineMarks {
  /** Today's graphs: a white dot at now (fractional index). */
  now?: number | null;
  /** The ten days': a dot a day, each in this color (or the line's), and the peak day's white and bigger. */
  days?: { colors?: string[]; peak: number | null };
}

/**
 * Values as one line, no axes or fill. Each line fits its own values, but spans at least `minSpan`,
 * centered, so one that barely changes stays a calm line through the middle, level with the others
 * (owner, 2026-10-24: a day with a few percent chance of rain drew its line along the bottom, lower
 * than the rest). `stroke` is a color, or a gradient (top, bottom) for temperature.
 */
function sparkline(values: number[], stroke: string | [string, string], minSpan: number, marks: LineMarks): SVGSVGElement {
  const W = 64;
  const H = 22;
  const pad = 3;
  const vlo = Math.min(...values);
  const vhi = Math.max(...values);
  const span = Math.max(vhi - vlo, minSpan, 1e-6);
  const lo = (vlo + vhi) / 2 - span / 2;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - 2 * pad);
  const s = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'spark-line', 'aria-hidden': 'true' });
  let paint = typeof stroke === 'string' ? stroke : '';
  if (typeof stroke !== 'string') {
    // Each graph its own gradient: two temperature graphs share the banner.
    const id = `spark-temp-${marks.days ? 'week' : 'day'}`;
    const g = el('linearGradient', { id, x1: 0, y1: pad, x2: 0, y2: H - pad, gradientUnits: 'userSpaceOnUse' });
    g.append(el('stop', { offset: 0, 'stop-color': stroke[0] }), el('stop', { offset: 1, 'stop-color': stroke[1] }));
    const defs = el('defs', {});
    defs.append(g);
    s.append(defs);
    paint = `url(#${id})`;
  }
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const days = marks.days;
  // The area under the line: unfilled except where a style asks for it (the TV's glass bar).
  s.append(el('path', { d: `${d}L${W} ${H}L0 ${H}Z`, class: 'spark-area', fill: 'none', stroke: 'none' }));
  s.append(
    el('path', {
      d,
      fill: 'none',
      stroke: paint,
      'stroke-width': days ? 1.5 : 2,
      'stroke-opacity': days ? 0.55 : 1,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  if (days) {
    const flat = typeof stroke === 'string' ? stroke : stroke[0];
    values.forEach((v, i) => {
      if (i !== days.peak && i !== 0) s.append(dot(x(i), y(v), days.colors?.[i] ?? flat, 4));
    });
    // Today, the first dot, a hollow white ring (owner, 2026-10-29: so you can count the days to the
    // peak); ringed around the white dot when today is the peak.
    const hole = (at: number, ring: number, gap: number) => {
      s.append(dot(x(0), y(values[0]), '#ffffff', ring), dot(x(0), y(values[0]), 'rgba(28, 28, 30, 0.95)', gap));
      if (at) s.append(dot(x(0), y(values[0]), '#ffffff', at));
    };
    if (days.peak === 0) hole(6.5, 11, 8.5);
    else hole(0, 7.5, 3.5);
    if (days.peak != null) {
      if (days.peak !== 0) s.append(dot(x(days.peak), y(values[days.peak]), '#ffffff', 6.5));
      // The line's points and the peak, for setting its letter clear of the line once it's laid out.
      s.dataset.points = values.map((v, i) => `${(x(i) / W).toFixed(4)},${(y(v) / H).toFixed(4)}`).join(' ');
      s.dataset.peak = String(days.peak);
    }
  }
  const now = marks.now;
  if (now != null) {
    const i0 = Math.min(values.length - 1, Math.floor(now));
    const v = values[i0] + ((values[i0 + 1] ?? values[i0]) - values[i0]) * (now - i0);
    s.append(dot((Math.min(now, values.length - 1) / Math.max(1, values.length - 1)) * W, y(v), '#ffffff', 5));
  }
  return s;
}

interface Spark {
  metric: Metric;
  label: string;
  icon: string;
  value: string;
  color: string;
  line: SVGSVGElement;
  say: string;
  /** The ten days': the peak day's name and date (its chart opens on that day). */
  day?: { name: string; date: string };
  /** The ten days': the peak day's first letter (set under its dot by placePeakLetters). */
  letter?: { text: string };
}

function sparkButtons(cells: Spark[]): HTMLElement[] {
  return cells.map((k) => {
    const pressed = k.day ? !!openDate && openMetric === k.metric && openDate === k.day.date : !openDate && openMetric === k.metric;
    const b = h(
      'button',
      {
        type: 'button',
        class: 'spark',
        'data-metric': k.metric,
        'data-day': k.day?.date ?? null,
        'aria-pressed': String(pressed),
        'aria-label': `${k.say}. Show the chart.`,
      },
      h('span', { class: 'spark-label' }, k.label),
      // The icon tells the numbers apart in the small banner, where the labels go.
      h('span', { class: 'spark-value' }, svg(k.icon), k.value),
      // The peak day's first letter just under its white dot (owner, 2026-10-29: a letter under every dot
      // was too busy, and a row of them under the graph sat too far from their dots).
      k.letter ? h('span', { class: 'spark-plot' }, k.line, h('span', { class: 'spark-letter', 'aria-hidden': 'true' }, k.letter.text)) : k.line,
    );
    (b.querySelector('.spark-value') as HTMLElement).style.color = k.color;
    return b;
  });
}

let trendWatch: ResizeObserver | null = null;

/** Clear space between a letter and the line or dots above it, px. */
const LETTER_GAP = 2;
/** How far below its point the line (half its stroke) and a day's dot (its radius) reach, px; the peak dot is bigger. */
const LINE_REACH = 1;
const DOT_REACH = 2;
const PEAK_REACH = 3.5;
/** Today's ring reaches further: on its own, and around the peak's dot when today is the peak. */
const TODAY_REACH = 3.75;
const TODAY_PEAK_REACH = 5.5;

/**
 * Where a peak's letter goes (owner, 2026-10-29: close under its dot, but never on the line): centered
 * under the dot, its top just clear of the lowest part of the line or any dot across the letter's
 * width. A steep drop beside the peak pushes it down; a gentle one keeps it close. In px, from the
 * graph's top left, for a graph `w` by `h` px; `points` are 0..1 across and down.
 */
export function letterSpot(points: [number, number][], peak: number, w: number, h: number, halfWidth: number): { left: number; top: number } {
  const px = points.map(([x, y]) => [x * w, y * h] as [number, number]);
  const cx = px[peak][0];
  const a = cx - halfWidth;
  const b = cx + halfWidth;
  // Today is the first point, drawn as a ring.
  const reach = (i: number) => (i === 0 ? (i === peak ? TODAY_PEAK_REACH : TODAY_REACH) : i === peak ? PEAK_REACH : DOT_REACH);
  let low = px[peak][1] + reach(peak);
  for (let i = 0; i < px.length; i++) {
    const [x, y] = px[i];
    if (x >= a && x <= b) low = Math.max(low, y + reach(i));
    const next = px[i + 1];
    if (!next || next[0] < a || x > b) continue;
    // A straight segment is lowest at one end of the stretch that's under the letter.
    for (const at of [Math.max(a, x), Math.min(b, next[0])]) {
      const f = next[0] > x ? (at - x) / (next[0] - x) : 0;
      low = Math.max(low, y + (next[1] - y) * f + LINE_REACH);
    }
  }
  return { left: cx, top: low + LETTER_GAP };
}

/** Sets each ten-day graph's peak letter clear of its line, and keeps room for it under the graph. Needs layout. */
export function placePeakLetters(): void {
  for (const plot of document.querySelectorAll<HTMLElement>('#cap-trend .spark-plot')) {
    const line = plot.querySelector<SVGSVGElement>('.spark-line');
    const letter = plot.querySelector<HTMLElement>('.spark-letter');
    if (!line?.dataset.points || !letter) continue;
    // Not shown (the small banner): no room kept.
    if (!letter.offsetParent) {
      plot.style.marginBottom = '';
      continue;
    }
    const { width: w, height: h } = line.getBoundingClientRect();
    if (!w || !h) continue;
    const points = line.dataset.points.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
    const spot = letterSpot(points, Number(line.dataset.peak), w, h, letter.offsetWidth / 2 + 1);
    letter.style.left = `${spot.left.toFixed(1)}px`;
    letter.style.top = `${spot.top.toFixed(1)}px`;
    // However far down the letter had to go, the graph keeps room for it.
    plot.style.marginBottom = `${Math.max(0, spot.top + letter.offsetHeight - h).toFixed(1)}px`;
  }
}

const unitsFor = (s: AppState) => ({
  ink: (color: string) => (s.theme === 'classic' ? '#f0f0fa' : color),
  temp: (f: number) => (s.tempUnit === 'C' ? fToC(f) : f),
  wind: (mph: number) => windIn(mph, s.windUnit),
});

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
  const { ink, temp, wind } = unitsFor(s);
  const maxWind = Math.max(...day.map((x) => x.windMph));
  const maxHumid = Math.max(...day.map((x) => x.humidity));
  box.replaceChildren(
    ...sparkButtons([
      {
        metric: 'conditions',
        icon: thermoIcon,
        label: 'High',
        value: formatTemp(today.hiF, s.tempUnit),
        color: ink(tempColor(today.hiF)),
        line: sparkline(
          day.map((x) => temp(x.tempF)),
          classic ? '#f0f0fa' : [tempColor(Math.max(...day.map((x) => x.tempF))), tempColor(Math.min(...day.map((x) => x.tempF)))],
          8,
          { now },
        ),
        say: `High ${formatTemp(today.hiF, s.tempUnit)} today`,
      },
      {
        metric: 'wind',
        label: 'Wind',
        icon: windIcon,
        value: formatWind(maxWind, s.windUnit),
        color: ink('#64d2ff'),
        line: sparkline(day.map((x) => wind(x.windMph)), ink('#64d2ff'), wind(8), { now }),
        say: `Wind up to ${formatWind(maxWind, s.windUnit)} today`,
      },
      {
        metric: 'precip',
        label: 'Rain',
        icon: umbrellaIcon,
        value: `${Math.round(today.precipProbability)}%`,
        color: ink('#7d7aff'),
        line: sparkline(day.map((x) => x.precipProbability), ink('#7d7aff'), 40, { now }),
        say: `${Math.round(today.precipProbability)}% chance of rain today`,
      },
      {
        metric: 'humidity',
        label: 'Humidity',
        icon: dropIcon,
        value: `${Math.round(maxHumid)}%`,
        color: ink('#30d158'),
        line: sparkline(day.map((x) => x.humidity), ink('#30d158'), 40, { now }),
        say: `Humidity up to ${Math.round(maxHumid)}% today`,
      },
    ]),
  );
}

/** Where a series peaks (the first such day); null when it never rises above nothing. */
function peakOf(values: number[]): number | null {
  const top = Math.max(...values);
  return top > 0 ? values.indexOf(top) : null;
}

/**
 * The same four over the ten days (owner, 2026-10-29), a dot a day, the peak day's white with its first
 * letter under it, each named for what it shows (Warmest, Windiest, Rainiest, Most humid) so the white
 * dot explains itself. Each opens its chart on that day.
 */
function renderTrend(c: Conditions | null, s: AppState): void {
  const box = $('#cap-trend');
  const om = c?.om;
  const days = (om?.daily ?? [])
    .map((d, i) => {
      const { hours, own } = dayHours(om!.week, d.date);
      const day = hours.slice(0, own);
      if (!own) return null;
      return {
        d,
        name: i === 0 ? 'Today' : DOW[new Date(`${d.date}T12:00:00Z`).getUTCDay()],
        wind: Math.max(...day.map((x) => x.windMph)),
        humidity: Math.max(...day.map((x) => x.humidity)),
      };
    })
    .filter((x) => x != null);
  box.hidden = days.length < 2;
  if (days.length < 2) return;
  const classic = s.theme === 'classic';
  const { ink, temp, wind } = unitsFor(s);
  const his = days.map((x) => x.d.hiF);
  const winds = days.map((x) => x.wind);
  const pops = days.map((x) => x.d.precipProbability);
  const humid = days.map((x) => x.humidity);
  const at = (i: number | null) => (i == null ? undefined : { name: days[i].name, date: days[i].d.date });
  const initials = days.map((x) => DOW[new Date(`${x.d.date}T12:00:00Z`).getUTCDay()][0]);
  const letters = (peak: number | null) => (peak == null ? undefined : { text: initials[peak] });
  const hot = peakOf(his.map((f) => f - Math.min(...his) + 1));
  const windy = peakOf(winds);
  const wet = peakOf(pops);
  const muggy = peakOf(humid);
  const on = (i: number | null) => (i == null ? '' : ` on ${days[i].name === 'Today' ? 'today' : days[i].name}`);
  box.replaceChildren(
    ...sparkButtons([
      {
        metric: 'conditions',
        icon: thermoIcon,
        label: 'Warmest',
        value: formatTemp(Math.max(...his), s.tempUnit),
        color: ink(tempColor(Math.max(...his))),
        line: sparkline(
          his.map(temp),
          classic ? '#f0f0fa' : [tempColor(Math.max(...his)), tempColor(Math.min(...his))],
          8,
          { days: { colors: classic ? undefined : his.map(tempColor), peak: hot } },
        ),
        say: `Warmest of the ten days: ${formatTemp(Math.max(...his), s.tempUnit)}${on(hot)}`,
        day: at(hot),
        letter: letters(hot),
      },
      {
        metric: 'wind',
        label: 'Windiest',
        icon: windIcon,
        value: formatWind(Math.max(...winds), s.windUnit),
        color: ink('#64d2ff'),
        line: sparkline(winds.map(wind), ink('#64d2ff'), wind(8), { days: { peak: windy } }),
        say: `Windiest of the ten days: ${formatWind(Math.max(...winds), s.windUnit)}${on(windy)}`,
        day: at(windy),
        letter: letters(windy),
      },
      {
        metric: 'precip',
        label: wet == null ? 'Rain' : 'Rainiest',
        icon: umbrellaIcon,
        value: `${Math.round(Math.max(...pops))}%`,
        color: ink('#7d7aff'),
        line: sparkline(pops, ink('#7d7aff'), 40, { days: { peak: wet } }),
        say: wet == null ? 'No rain in the ten days' : `Likeliest rain of the ten days: ${Math.round(Math.max(...pops))}%${on(wet)}`,
        day: at(wet),
        letter: letters(wet),
      },
      {
        metric: 'humidity',
        label: 'Most humid',
        icon: dropIcon,
        value: `${Math.round(Math.max(...humid))}%`,
        color: ink('#30d158'),
        line: sparkline(humid, ink('#30d158'), 40, { days: { peak: muggy } }),
        say: `Most humid of the ten days: ${Math.round(Math.max(...humid))}%${on(muggy)}`,
        day: at(muggy),
        letter: letters(muggy),
      },
    ]),
  );
}

/** How many hours the hourly strip runs: today and tomorrow. */
const STRIP_HOURS = 48;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Which strip was drawn last, so a redraw of the same one keeps its scroll. */
let stripKind = '';

/** "Now", "1PM"; midnight is the new day's name, so you can tell the days apart as you scroll. */
function hourLabel(time: string, first: boolean): string {
  if (first) return 'Now';
  const hr = Number(time.slice(11, 13));
  if (hr === 0) return DOW[new Date(`${time.slice(0, 10)}T12:00:00Z`).getUTCDay()];
  return `${hr % 12 || 12}${hr < 12 ? 'AM' : 'PM'}`;
}

/**
 * The strip along the full banner's foot (owner, 2026-10-24: the graphs for the small banner, the
 * forecast for the full one), scrolling sideways. Daily (the default): ten days, each its name, its
 * sky, the chance of rain when it's worth a mention, and its high and low. Hourly (Settings): the next
 * two days by the hour. Each opens that day's chart under the banner.
 */
function renderWeek(c: Conditions | null, s: AppState): void {
  const box = $('#cap-week');
  const om = c?.om;
  if (s.bannerForecast === 'hourly' && om) {
    const at = om.current.time.slice(0, 13);
    const from = om.week.findIndex((x) => x.time.slice(0, 13) >= at);
    const hours = from < 0 ? [] : om.week.slice(from, from + STRIP_HOURS);
    box.hidden = !hours.length;
    if (!hours.length) return;
    const left = stripKind === 'hourly' ? box.scrollLeft : 0;
    stripKind = 'hourly';
    box.replaceChildren(
      ...hours.map((x, i) => {
        const label = hourLabel(x.time, i === 0);
        // Now is the temperature right now, as on the map, not the hour's forecast.
        const temp = formatTemp(i === 0 && c?.tempF != null ? c.tempF : x.tempF, s.tempUnit);
        const pop = Math.round(x.precipProbability);
        return h(
          'button',
          {
            type: 'button',
            class: `wk is-hour${i && x.time.slice(11, 13) === '00' ? ' is-day' : ''}`,
            'data-day': x.time.slice(0, 10),
            'aria-label': `${label}: ${temp}, ${pop}% chance of rain. Show the day.`,
          },
          h('span', { class: 'wk-day' }, label),
          h('span', { class: 'wk-icon' }, svg(GLYPHS[glyphFor(x.weatherCode, x.isDay)])),
          h('span', { class: 'wk-pop' }, pop >= 20 ? `${pop}%` : ''),
          h('span', { class: 'wk-hi' }, temp),
        );
      }),
    );
    box.scrollLeft = left;
    return;
  }
  const days = om ? weekRows(om.daily, c?.tempF ?? null) : [];
  box.hidden = !days.length;
  if (!om || !days.length) return;
  const left = stripKind === 'daily' ? box.scrollLeft : 0;
  stripKind = 'daily';
  box.replaceChildren(
    ...days.map((d, i) => {
      const date = om.daily[i].date;
      const hi = formatTemp(d.hiF, s.tempUnit);
      const lo = formatTemp(d.loF, s.tempUnit);
      const pop = Math.round(d.pop);
      return h(
        'button',
        {
          type: 'button',
          class: 'wk',
          'data-day': date,
          'aria-pressed': String(openMetric === 'conditions' && openDate === date),
          'aria-label': `${d.label}: high ${hi}, low ${lo}, ${pop}% chance of rain. Show the day.`,
        },
        h('span', { class: 'wk-day' }, d.label),
        h('span', { class: 'wk-icon' }, svg(GLYPHS[d.glyph])),
        h('span', { class: 'wk-pop' }, pop >= 20 ? `${pop}%` : ''),
        h('span', { class: 'wk-hi' }, hi),
        h('span', { class: 'wk-lo' }, lo),
      );
    }),
  );
  box.scrollLeft = left;
}

/**
 * The banner's alert mark, in its top-left corner at every size (owner, 2026-10-26: the pills took a
 * whole row): a triangle with how many alerts are in effect, in the worst one's color, red for a
 * warning, orange for a watch, yellow for the rest; hovering lists them.
 */
function renderAlertCount(alerts: Alert[]): void {
  const b = $('#cap-alerts');
  b.hidden = !alerts.length;
  if (!alerts.length) return;
  const worst = alerts[0].event;
  b.dataset.level = /warning/i.test(worst) ? 'warning' : /watch/i.test(worst) ? 'watch' : 'advisory';
  b.title = [...new Set(alerts.map((a) => a.event))].join('\n');
  const n = alerts.length > 9 ? '9+' : String(alerts.length);
  const tri = document.createElementNS(SVG_NS, 'svg');
  tri.setAttribute('viewBox', '0 0 28 25');
  tri.setAttribute('aria-hidden', 'true');
  tri.innerHTML = `<path d="M12.3 2.9a2 2 0 0 1 3.4 0l10.6 18.6a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3z" /><text x="14" y="20.5" text-anchor="middle">${n}</text>`;
  b.replaceChildren(tri);
  b.setAttribute('aria-label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}: ${alerts[0].event}. Open details.`);
}
