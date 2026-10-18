import type { Conditions } from '../data/conditions';
import { dayHours, extremes, hourOfDay, meanDirection, METRICS, niceScale, type Metric } from '../data/dayDetail';
import type { HourDetail, PointForecast } from '../data/openmeteo';
import { clockLabel, glyphFor, uvWord } from '../data/outlook';
import type { AppState } from '../state';
import { compass8, cToF, fToC, mphToKmh } from '../util/units';
import { h, svg } from './dom';
import { chevronIcon, closeIcon, cloudMark, dropIcon, eyeIcon, gaugeIcon, GLYPHS, sunMark, umbrellaIcon, windIcon } from './icons';
import { segmented } from './layersMenu';
import { tempColor } from './page';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Chart geometry (viewBox units): the plot, then a gutter on the right for the scale. */
const W = 340;
const PR = 34;
const PW = W - PR;
const PT = 12;
const PB = 22;

const ICONS: Record<Metric, string> = {
  conditions: cloudMark,
  uv: sunMark,
  wind: windIcon,
  precip: umbrellaIcon,
  humidity: dropIcon,
  visibility: eyeIcon,
  pressure: gaugeIcon,
};

/** UV index → color (green, yellow, orange, red, violet), the WHO scale. */
function uvColor(uv: number): string {
  return uv < 3 ? '#30d158' : uv < 6 ? '#ffd60a' : uv < 8 ? '#ff9f0a' : uv < 11 ? '#ff453a' : '#bf5af2';
}

interface Scale {
  min: number;
  max: number;
  step: number;
}

/** How one metric reads, in the units you picked. */
interface Spec {
  value: (x: HourDetail) => number;
  fmt: (v: number) => string;
  tick: (v: number) => string;
  scale: (lo: number, hi: number) => Scale;
  color: (v: number) => string;
  bars?: boolean;
  about: string;
}

function specFor(m: Metric, s: AppState, feels: boolean): Spec {
  const metric = s.tempUnit === 'C';
  const auto = (lo: number, hi: number) => niceScale(lo, hi);
  switch (m) {
    case 'conditions': {
      const t = (f: number) => (metric ? fToC(f) : f);
      return {
        value: (x) => t(feels ? x.feelsF : x.tempF),
        fmt: (v) => `${Math.round(v)}°`,
        tick: (v) => `${Math.round(v)}°`,
        scale: (lo, hi) => niceScale(lo - 1, hi + 1),
        color: (v) => tempColor(metric ? cToF(v) : v),
        about: feels ? 'How warm or cold it feels, with wind and humidity.' : 'The actual temperature.',
      };
    }
    case 'uv':
      return {
        value: (x) => x.uv,
        fmt: (v) => String(Math.round(v)),
        tick: (v) => String(v),
        scale: (_lo, hi) => ({ min: 0, max: hi > 12 ? 15 : 12, step: 3 }),
        color: uvColor,
        about: 'How strong the sun’s ultraviolet light is. At 3 and up, protect your skin.',
      };
    case 'wind': {
      const kmh = s.windUnit === 'kmh';
      return {
        value: (x) => (kmh ? mphToKmh(x.windMph) : x.windMph),
        fmt: (v) => `${Math.round(v)} ${kmh ? 'km/h' : 'mph'}`,
        tick: (v) => String(Math.round(v)),
        scale: (_lo, hi) => niceScale(0, Math.max(hi, kmh ? 15 : 10)),
        color: () => '#64d2ff',
        about: 'Sustained wind; the dotted line is gusts.',
      };
    }
    case 'precip':
      return {
        value: (x) => (metric ? x.precipitation : x.precipitation / 25.4),
        fmt: (v) => (metric ? `${v.toFixed(1)} mm` : `${v.toFixed(2)}″`),
        tick: (v) => (metric ? String(+v.toFixed(1)) : `${+v.toFixed(2)}″`),
        scale: (_lo, hi) => niceScale(0, Math.max(hi, metric ? 2 : 0.08)),
        color: () => '#0a84ff',
        bars: true,
        about: 'Rain, or snow melted down to water, in each hour.',
      };
    case 'humidity':
      return {
        value: (x) => x.humidity,
        fmt: (v) => `${Math.round(v)}%`,
        tick: (v) => `${v}%`,
        scale: () => ({ min: 0, max: 100, step: 20 }),
        color: () => '#5ac8fa',
        about: 'Relative humidity. The dew point says how muggy it feels.',
      };
    case 'visibility':
      return {
        value: (x) => x.visibilityM / (metric ? 1000 : 1609.344),
        fmt: (v) => `${v < 3 ? v.toFixed(1) : Math.round(v)} ${metric ? 'km' : 'mi'}`,
        tick: (v) => String(Math.round(v)),
        scale: (_lo, hi) => niceScale(0, Math.max(hi, metric ? 16 : 10)),
        color: () => '#d1d1d6',
        about: 'How far you can see clearly. Fog, haze, and heavy rain bring it down.',
      };
    case 'pressure':
      return {
        value: (x) => (metric ? x.pressureHpa : x.pressureHpa * 0.02953),
        fmt: (v) => (metric ? `${Math.round(v)} hPa` : `${v.toFixed(2)} inHg`),
        tick: (v) => (metric ? String(Math.round(v)) : v.toFixed(2)),
        scale: auto,
        color: () => '#bf5af2',
        about: 'Sea-level air pressure. Falling pressure often brings unsettled weather.',
      };
  }
}

/* ---------- chart ---------- */

let uid = 0;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const f1 = (n: number) => n.toFixed(1);

/** A smooth line through the points (Catmull-Rom), kept inside the plot. */
function smooth(p: [number, number][], top: number, bottom: number): string {
  if (!p.length) return '';
  const cy = (v: number) => Math.min(bottom, Math.max(top, v));
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const [p1, p2] = [p[i], p[i + 1]];
    const p3 = p[i + 2] ?? p2;
    d +=
      `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(cy(p1[1] + (p2[1] - p0[1]) / 6))} ` +
      `${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(cy(p2[1] - (p3[1] - p1[1]) / 6))} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}

interface ChartOpts {
  /** One value per hour from midnight; a 25th is the next midnight. */
  values: number[];
  /** Hours that belong to the day (the ones you can scrub). */
  own: number;
  scale: Scale;
  tick: (v: number) => string;
  color: (v: number) => string;
  bars?: boolean;
  /** A second, dotted line (gusts). */
  dotted?: number[];
  /** Now, in hours from midnight; earlier hours are drawn dimmed and dashed. */
  now: number | null;
  hiLo?: boolean;
  height: number;
  label: string;
}

interface Chart {
  el: SVGSVGElement;
  /** Show the scrub cursor at an hour, or hide it. */
  cursor: (i: number | null) => void;
}

function chart(o: ChartOpts): Chart {
  const H = o.height;
  const PH = H - PT - PB;
  const bottom = PT + PH;
  const span = o.scale.max - o.scale.min || 1;
  const x = (i: number) => (i / 24) * PW;
  const y = (v: number) => PT + (1 - (Math.min(o.scale.max, Math.max(o.scale.min, v)) - o.scale.min) / span) * PH;
  const id = `dd${++uid}`;
  const s = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dd-chart', role: 'img', 'aria-label': o.label });

  // Colored by value, top to bottom; the fill fades toward the floor.
  const defs = el('defs');
  const grad = el('linearGradient', { id: `${id}g`, x1: 0, y1: PT, x2: 0, y2: bottom, gradientUnits: 'userSpaceOnUse' });
  for (let k = 0; k <= 8; k++) grad.append(el('stop', { offset: k / 8, 'stop-color': o.color(o.scale.max - (k / 8) * span) }));
  const fade = el('linearGradient', { id: `${id}f`, x1: 0, y1: 0, x2: 0, y2: 1 });
  fade.append(el('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.55 }), el('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0.06 }));
  const mask = el('mask', { id: `${id}m` });
  mask.append(el('rect', { x: 0, y: PT, width: PW, height: PH, fill: `url(#${id}f)` }));
  const nowX = o.now != null ? x(o.now) : 0;
  const past = el('clipPath', { id: `${id}p` });
  past.append(el('rect', { x: 0, y: 0, width: nowX, height: H }));
  const future = el('clipPath', { id: `${id}n` });
  future.append(el('rect', { x: nowX, y: 0, width: Math.max(0, PW - nowX), height: H }));
  defs.append(grad, fade, mask, past, future);
  s.append(defs);

  // Grid: the scale on the right, every 6 hours across.
  for (let k = 0; o.scale.min + k * o.scale.step <= o.scale.max + 1e-9; k++) {
    const v = +(o.scale.min + k * o.scale.step).toPrecision(12);
    s.append(el('line', { x1: 0, x2: PW, y1: f1(y(v)), y2: f1(y(v)), class: 'dd-grid' }));
    const t = el('text', { x: PW + 6, y: f1(y(v) + 3.5), class: 'dd-tick' });
    t.textContent = o.tick(v);
    s.append(t);
  }
  for (const i of [0, 6, 12, 18, 24]) {
    s.append(el('line', { x1: x(i), x2: x(i), y1: PT, y2: bottom, class: 'dd-grid' }));
    if (i < 24) {
      const t = el('text', { x: x(i) + 3, y: H - 6, class: 'dd-tick' });
      t.textContent = String(i).padStart(2, '0');
      s.append(t);
    }
  }

  const fill = `url(#${id}g)`;
  if (o.bars) {
    const bw = PW / 24;
    o.values.slice(0, o.own).forEach((v, i) => {
      if (v <= 0) return;
      const top = Math.min(y(v), bottom - 1.5);
      s.append(
        el('rect', {
          x: f1(x(i) + 1.5),
          y: f1(top),
          width: f1(bw - 3),
          height: f1(bottom - top),
          rx: 2,
          fill: o.color(v),
          class: o.now != null && i + 1 <= o.now ? 'dd-bar is-past' : 'dd-bar',
        }),
      );
    });
  } else {
    const pts = o.values.map((v, i) => [x(i), y(v)] as [number, number]);
    const line = smooth(pts, PT, bottom);
    const area = `${line}L${f1(pts[pts.length - 1][0])} ${bottom}L0 ${bottom}Z`;
    const ahead = el('g', { 'clip-path': `url(#${id}n)` });
    ahead.append(
      el('path', { d: area, fill, mask: `url(#${id}m)` }),
      el('path', { d: line, stroke: fill, class: 'dd-line' }),
    );
    s.append(ahead);
    if (o.now != null) {
      const before = el('g', { 'clip-path': `url(#${id}p)` });
      before.append(el('path', { d: area, class: 'dd-area-past' }), el('path', { d: line, class: 'dd-line is-past' }));
      s.append(before);
    }
    if (o.dotted) {
      s.append(el('path', { d: smooth(o.dotted.map((v, i) => [x(i), y(v)]), PT, bottom), stroke: fill, class: 'dd-line is-dotted' }));
    }
    if (o.hiLo) {
      const e = extremes(o.values.slice(0, o.own));
      for (const [i, label] of [
        [e.loAt, 'L'],
        [e.hiAt, 'H'],
      ] as const) {
        s.append(el('circle', { cx: f1(x(i)), cy: f1(y(o.values[i])), r: 3.5, class: 'dd-mark' }));
        const t = el('text', { x: f1(x(i)), y: f1(y(o.values[i]) - 8), 'text-anchor': 'middle', class: 'dd-mark-label' });
        t.textContent = label;
        s.append(t);
      }
    }
    if (o.now != null) {
      const i0 = Math.floor(o.now);
      const v = o.values[i0] + ((o.values[i0 + 1] ?? o.values[i0]) - o.values[i0]) * (o.now - i0);
      s.append(el('line', { x1: f1(nowX), x2: f1(nowX), y1: PT, y2: bottom, class: 'dd-now' }));
      s.append(el('circle', { cx: f1(nowX), cy: f1(y(v)), r: 4.5, class: 'dd-now-dot' }));
    }
  }

  const cur = el('g', { class: 'dd-cursor', visibility: 'hidden' });
  const cl = el('line', { y1: PT, y2: bottom });
  const cd = el('circle', { r: 5 });
  cur.append(cl, cd);
  s.append(cur);
  return {
    el: s,
    cursor: (i) => {
      cur.setAttribute('visibility', i == null ? 'hidden' : 'visible');
      if (i == null) return;
      const cx = o.bars ? x(i + 0.5) : x(i);
      for (const a of ['x1', 'x2']) cl.setAttribute(a, f1(cx));
      cd.setAttribute('cx', f1(cx));
      cd.setAttribute('cy', f1(y(o.values[i])));
    },
  };
}

/* ---------- panel ---------- */

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** The hour readout uses the current conditions, not the model's hour, so it matches the page. */
function nowHour(c: Conditions, om: PointForecast): HourDetail {
  const k = om.current;
  return {
    time: k.time,
    tempF: c.tempF ?? k.tempF,
    precipitation: k.precipitation,
    precipProbability: 0,
    weatherCode: k.weatherCode,
    windMph: k.windMph,
    windFromDeg: k.windFromDeg,
    gustMph: k.gustMph,
    isDay: k.isDay,
    feelsF: k.feelsF,
    uv: k.uv,
    humidity: k.humidity,
    dewF: k.dewF,
    visibilityM: k.visibilityM,
    pressureHpa: k.pressureHpa,
  };
}

/**
 * Apple Weather's detail view for one day: a 24-hour chart of a metric you pick, with the hours
 * already gone dimmed, a readout you scrub with a finger or the pointer, and the day in a sentence.
 * Floats over the map beside the docked weather page; a sheet over the page on phones. Everything
 * comes from the point forecast the page already has, so opening it costs no requests.
 */
export class DayDetail {
  private readonly root = h('section', {
    id: 'detail',
    class: 'detail glass-thick',
    role: 'dialog',
    'aria-labelledby': 'detail-title',
    hidden: true,
  });
  private metric: Metric = 'conditions';
  private date: string | null = null;
  private feels = false;
  private c: Conditions | null = null;
  private s: AppState | null = null;
  private opener: HTMLElement | null = null;

  constructor() {
    document.body.append(this.root);
    // Escape closes this before the page under it.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.isOpen || document.querySelector('.sheet.open')) return;
        e.stopPropagation();
        this.close();
      },
      true,
    );
    this.swipeToClose();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(metric: Metric, date: string | null, opener: HTMLElement | null, feels = false): void {
    this.metric = metric;
    this.date = date;
    this.feels = feels;
    const was = this.isOpen;
    if (!was) this.opener = opener;
    this.root.hidden = false;
    this.render(true);
    if (!was) {
      requestAnimationFrame(() => {
        this.root.classList.add('open');
        this.root.querySelector<HTMLElement>('.dd-close')?.focus({ preventScroll: true });
      });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    const done = () => {
      if (!this.root.classList.contains('open')) this.root.hidden = true;
    };
    this.root.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 500);
    this.opener?.focus({ preventScroll: true });
    this.opener = null;
  }

  /** New data for the place (or new units): redraw if open. */
  update(c: Conditions | null, s: AppState): void {
    this.c = c;
    this.s = s;
    if (this.isOpen) this.render(false);
  }

  private render(reset: boolean): void {
    const c = this.c;
    const s = this.s;
    const om = c?.om;
    if (!c || !s || !om || !om.daily.length) {
      this.root.replaceChildren(this.head(), h('p', { class: 'dd-text' }, 'Loading the forecast'));
      return;
    }
    // A new place may be in another time zone: fall back to its today.
    if (!this.date || !om.daily.some((d) => d.date === this.date)) this.date = om.daily[0].date;
    const date = this.date;
    const isToday = date === om.daily[0].date;
    const { hours, own } = dayHours(om.week, date);
    if (!own) {
      this.root.replaceChildren(this.head(), this.days(om), h('p', { class: 'dd-text' }, 'No hourly forecast for this day.'));
      return;
    }
    const spec = specFor(this.metric, s, this.feels);
    const values = hours.map(spec.value);
    const day = values.slice(0, own);
    const e = extremes(day);
    const now = isToday ? hourOfDay(om.current.time, date) : null;
    const dotted = this.metric === 'wind' ? hours.map((x) => (s.windUnit === 'kmh' ? mphToKmh(x.gustMph) : x.gustMph)) : undefined;
    const scale = spec.scale(e.lo, Math.max(e.hi, ...(dotted?.slice(0, own) ?? [])));

    const main = chart({
      values,
      own,
      scale,
      tick: spec.tick,
      color: s.theme === 'classic' ? () => '#f0f0fa' : spec.color,
      bars: spec.bars,
      dotted,
      now,
      hiLo: this.metric === 'conditions',
      height: 200,
      label: `${METRICS.find((m) => m.id === this.metric)!.label}, ${weekday(date)}, by the hour`,
    });
    const charts = [main];

    // Readout: now (today) or the day as a whole; scrubbing shows that hour.
    const value = h('span', { class: 'dd-value-num' });
    const glyph = h('span', { class: 'dd-value-glyph' });
    const sub = h('p', { class: 'dd-sub' });
    const dayRead = (): [string, string] => this.dayReadout(spec, hours, own, e, isToday ? nowHour(c, om) : null);
    const show = (i: number | null) => {
      const [v, line] = i == null ? dayRead() : this.hourReadout(spec, hours[i]);
      value.textContent = v;
      sub.textContent = line;
      const g = this.metric === 'conditions' ? (i == null ? (isToday ? nowHour(c, om) : null) : hours[i]) : null;
      glyph.replaceChildren(...(g ? [svg(GLYPHS[glyphFor(g.weatherCode, g.isDay)])] : []));
      charts.forEach((ch) => ch.cursor(i));
    };

    const plot = (ch: Chart) => {
      const wrap = h('div', { class: 'dd-plot' });
      wrap.append(ch.el);
      const at = (e: PointerEvent) => {
        const r = ch.el.getBoundingClientRect();
        const fx = ((e.clientX - r.left) / r.width) * W;
        return Math.max(0, Math.min(own - 1, Math.round((fx / PW) * 24 - (spec.bars ? 0.5 : 0))));
      };
      wrap.addEventListener('pointerdown', (e) => {
        wrap.setPointerCapture(e.pointerId);
        show(at(e));
      });
      wrap.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse' || wrap.hasPointerCapture(e.pointerId)) show(at(e));
      });
      const end = () => show(null);
      wrap.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && end());
      wrap.addEventListener('pointercancel', end);
      wrap.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && end());
      return wrap;
    };

    const picker = h('select', { class: 'dd-select', 'aria-label': 'Show' });
    for (const m of METRICS) picker.append(h('option', { value: m.id, selected: m.id === this.metric }, m.label));
    picker.addEventListener('change', () => {
      this.metric = picker.value as Metric;
      this.feels = false;
      this.render(true);
    });

    const parts: (Node | null)[] = [
      this.head(),
      this.days(om),
      h('p', { class: 'dd-date' }, longDate(date)),
      h(
        'div',
        { class: 'dd-top' },
        h('div', { class: 'dd-read', 'aria-live': 'polite' }, h('p', { class: 'dd-value' }, value, glyph), sub),
        h('label', { class: 'dd-pick glass' }, svg(ICONS[this.metric]), svg(chevronIcon), picker),
      ),
      this.iconRow(hours, own),
      plot(main),
    ];

    if (this.metric === 'conditions') {
      parts.push(
        segmented('Temperature', [
          { value: 'actual', label: 'Actual' },
          { value: 'feels', label: 'Feels Like' },
        ], this.feels ? 'feels' : 'actual', (v) => {
          this.feels = v === 'feels';
          this.render(false);
        }),
      );
    }
    parts.push(h('p', { class: 'dd-about' }, spec.about));

    if (this.metric === 'conditions' || this.metric === 'precip') {
      const pops = hours.map((x) => x.precipProbability);
      const chance = chart({
        values: pops,
        own,
        scale: { min: 0, max: 100, step: 20 },
        tick: (v) => `${v}%`,
        color: () => (s.theme === 'classic' ? '#f0f0fa' : '#64d2ff'),
        now,
        height: 150,
        label: `Chance of precipitation, ${weekday(date)}, by the hour`,
      });
      charts.push(chance);
      const pop = om.daily.find((d) => d.date === date)?.precipProbability ?? Math.max(...pops.slice(0, own));
      parts.push(
        h(
          'section',
          { class: 'dd-sec' },
          h('h3', { class: 'dd-sec-title' }, 'Chance of Precipitation'),
          h('p', { class: 'dd-muted' }, `${isToday ? 'Today’s' : `${weekday(date)}’s`} chance: ${Math.round(pop)}%`),
          plot(chance),
        ),
      );
    }

    parts.push(
      h('section', { class: 'dd-sec' }, h('h3', { class: 'dd-sec-title' }, 'Daily Summary'), h('p', { class: 'dd-text' }, this.summary(spec, hours, own, e, isToday))),
    );

    const keep = this.root.scrollTop;
    this.root.replaceChildren(...parts.filter((p): p is Node => p != null));
    this.root.scrollTop = reset ? 0 : keep;
    show(null);
  }

  private head(): HTMLElement {
    const close = h('button', { class: 'dd-close round-btn glass', type: 'button', 'aria-label': 'Close' }, svg(closeIcon));
    close.addEventListener('click', () => this.close());
    const label = METRICS.find((m) => m.id === this.metric)!.label;
    return h('header', { class: 'dd-head' }, close, h('h2', { id: 'detail-title', class: 'dd-title' }, svg(ICONS[this.metric]), label));
  }

  private days(om: PointForecast): HTMLElement {
    const list = h('div', { class: 'dd-days', role: 'group', 'aria-label': 'Day' });
    for (const d of om.daily) {
      const at = new Date(`${d.date}T12:00:00Z`);
      const b = h(
        'button',
        { type: 'button', class: 'dd-day', 'aria-pressed': String(d.date === this.date), 'aria-label': longDate(d.date) },
        h('span', { class: 'dd-dow' }, at.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })),
        h('span', { class: 'dd-num' }, String(at.getUTCDate())),
      );
      b.addEventListener('click', () => {
        this.date = d.date;
        this.render(false);
      });
      list.append(b);
    }
    return list;
  }

  /** Weather glyphs (or wind arrows) every two hours above the chart. */
  private iconRow(hours: HourDetail[], own: number): HTMLElement | null {
    if (this.metric !== 'conditions' && this.metric !== 'wind') return null;
    const row = h('div', { class: 'dd-icons', 'aria-hidden': 'true' });
    for (let i = 0; i < 24; i += 2) {
      const x = hours[Math.min(i, own - 1)];
      if (this.metric === 'conditions') {
        row.append(h('span', {}, svg(GLYPHS[glyphFor(x.weatherCode, x.isDay)])));
      } else {
        const arrow = svg('<svg viewBox="0 0 24 24" class="dd-arrow"><path d="M12 20V4M6 10l6-6 6 6" /></svg>');
        arrow.style.transform = `rotate(${(x.windFromDeg + 180) % 360}deg)`;
        row.append(h('span', {}, arrow));
      }
    }
    return row;
  }

  private dayReadout(spec: Spec, hours: HourDetail[], own: number, e: ReturnType<typeof extremes>, now: HourDetail | null): [string, string] {
    const s = this.s!;
    const day = hours.slice(0, own);
    const temp = (f: number) => `${Math.round(s.tempUnit === 'C' ? fToC(f) : f)}°`;
    const gustMax = Math.max(...day.map((x) => x.gustMph));
    switch (this.metric) {
      case 'conditions':
        return [now ? spec.fmt(spec.value(now)) : spec.fmt(e.hi), `H:${spec.fmt(e.hi)} L:${spec.fmt(e.lo)}`];
      case 'uv': {
        const v = now ? now.uv : e.hi;
        return [spec.fmt(v), `${uvWord(v)} · Max ${Math.round(e.hi)}`];
      }
      case 'wind': {
        const g = now ? now.gustMph : gustMax;
        return [spec.fmt(now ? spec.value(now) : e.hi), `Gusts ${spec.fmt(s.windUnit === 'kmh' ? mphToKmh(g) : g)}`];
      }
      case 'precip':
        return [spec.fmt(e.sum), now ? 'Total today' : 'Total for the day'];
      case 'humidity': {
        const dews = day.map((x) => x.dewF);
        return [
          spec.fmt(now ? now.humidity : e.avg),
          now ? `Dew point ${temp(now.dewF)}` : `Average · Dew point ${temp(Math.min(...dews))} to ${temp(Math.max(...dews))}`,
        ];
      }
      case 'visibility':
        return [spec.fmt(now ? spec.value(now) : e.lo), now ? `Lowest today ${spec.fmt(e.lo)}` : 'Lowest of the day'];
      case 'pressure': {
        const first = day[0].pressureHpa;
        const last = day[own - 1].pressureHpa;
        const trend = last - first > 1.5 ? 'Rising' : first - last > 1.5 ? 'Falling' : 'Steady';
        return [spec.fmt(now ? spec.value(now) : e.avg), now ? trend : `Average · ${trend}`];
      }
    }
  }

  private hourReadout(spec: Spec, x: HourDetail): [string, string] {
    const s = this.s!;
    const at = clockLabel(x.time, false);
    const temp = (f: number) => `${Math.round(s.tempUnit === 'C' ? fToC(f) : f)}°`;
    const extra =
      this.metric === 'wind'
        ? `Gusts ${spec.fmt(s.windUnit === 'kmh' ? mphToKmh(x.gustMph) : x.gustMph)} · from ${compass8(x.windFromDeg)}`
        : this.metric === 'precip' || this.metric === 'conditions'
          ? `${Math.round(x.precipProbability)}% chance`
          : this.metric === 'humidity'
            ? `Dew point ${temp(x.dewF)}`
            : this.metric === 'uv'
              ? uvWord(x.uv)
              : null;
    return [spec.fmt(spec.value(x)), extra ? `${at} · ${extra}` : at];
  }

  /** The day in a sentence or two. */
  private summary(spec: Spec, hours: HourDetail[], own: number, e: ReturnType<typeof extremes>, isToday: boolean): string {
    const s = this.s!;
    const day = hours.slice(0, own);
    const when = (i: number) => clockLabel(day[i].time, false);
    const name = isToday ? 'Today' : weekday(day[0].time.slice(0, 10));
    switch (this.metric) {
      case 'conditions': {
        const t = (f: number) => `${Math.round(s.tempUnit === 'C' ? fToC(f) : f)}°`;
        const feels = extremes(day.map((x) => x.feelsF));
        const air = extremes(day.map((x) => x.tempF));
        return (
          `${name}: a low of ${t(air.lo)} around ${when(air.loAt)} and a high of ${t(air.hi)} around ${when(air.hiAt)}. ` +
          `It feels like ${t(feels.lo)} to ${t(feels.hi)}.`
        );
      }
      case 'uv': {
        const strong = day.map((x, i) => (x.uv >= 3 ? i : -1)).filter((i) => i >= 0);
        const peak = `${name}, the UV index peaks at ${Math.round(e.hi)} (${uvWord(e.hi).toLowerCase()}) around ${when(e.hiAt)}.`;
        return strong.length
          ? `${peak} Use sun protection from ${when(strong[0])} to ${clockLabel(hours[strong[strong.length - 1] + 1]?.time ?? day[own - 1].time, false)}.`
          : `${peak} No sun protection needed.`;
      }
      case 'wind': {
        const g = Math.max(...day.map((x) => x.gustMph));
        const dir = compass8(meanDirection(day.map((x) => x.windFromDeg)));
        const gust = spec.fmt(s.windUnit === 'kmh' ? mphToKmh(g) : g);
        return `${name}: wind ${spec.fmt(e.lo).replace(/ .*/, '')} to ${spec.fmt(e.hi)}, mostly from the ${dir}, with gusts up to ${gust}.`;
      }
      case 'precip': {
        const pops = extremes(day.map((x) => x.precipProbability));
        if (e.sum <= 0 && pops.hi < 20) return `${name}: no precipitation expected.`;
        return `${name}: ${spec.fmt(e.sum)} expected in all. The best chance, ${Math.round(pops.hi)}%, is around ${when(pops.hiAt)}.`;
      }
      case 'humidity':
        return `${name}: humidity from ${spec.fmt(e.lo)} around ${when(e.loAt)} to ${spec.fmt(e.hi)} around ${when(e.hiAt)}.`;
      case 'visibility':
        return e.lo >= spec.value({ ...day[0], visibilityM: 8000 })
          ? `${name}: clear views all day, ${spec.fmt(e.lo)} or more.`
          : `${name}: visibility drops to ${spec.fmt(e.lo)} around ${when(e.loAt)}.`;
      case 'pressure': {
        const diff = day[own - 1].pressureHpa - day[0].pressureHpa;
        const trend = diff > 1.5 ? 'rising' : diff < -1.5 ? 'falling' : 'steady';
        return `${name}: pressure ${trend}, from ${spec.fmt(spec.value(day[0]))} to ${spec.fmt(spec.value(day[own - 1]))}.`;
      }
    }
  }

  /** Phones: pull the sheet down by its top to close it. */
  private swipeToClose(): void {
    let startY = 0;
    let tracking = false;
    this.root.addEventListener(
      'touchstart',
      (e) => {
        tracking = this.root.scrollTop <= 0 && !(e.target as Element).closest('.dd-plot');
        startY = e.touches[0].clientY;
      },
      { passive: true },
    );
    this.root.addEventListener(
      'touchmove',
      (e) => {
        if (tracking && e.touches[0].clientY - startY > 110) {
          tracking = false;
          this.close();
        }
      },
      { passive: true },
    );
  }
}
