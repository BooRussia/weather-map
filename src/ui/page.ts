import type { Conditions } from '../data/conditions';
import type { Alert } from '../data/nws';
import type { PointForecast } from '../data/openmeteo';
import { clockLabel, hourlyCells, nextRain, uvWord, weekRows } from '../data/outlook';
import type { AppState } from '../state';
import { sentenceCase } from '../util/text';
import { compass8, formatTemp, formatWind } from '../util/units';
import { $, h, svg } from './dom';
import { amountText, conditionWord, hiLoLine, rateText, reflow, shortPeriodName, timeShort, visibilityText } from './format';
import {
  calendarIcon,
  clockIcon,
  closeIcon,
  dropIcon,
  eyeIcon,
  gaugeIcon,
  GLYPHS,
  sunMark,
  sunsetIcon,
  thermoIcon,
  umbrellaIcon,
  warningIcon,
  windIcon,
} from './icons';
import { sceneFor, SkyRenderer } from './sky';

const DOCK_KEY = 'weather-map:page-docked';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Temperature ramp (DESIGN.md): °F stops → color. */
const TEMP_STOPS: [number, string][] = [
  [32, '#5e5cf0'],
  [45, '#0a84ff'],
  [55, '#64d2ff'],
  [65, '#30d158'],
  [75, '#ffd60a'],
  [85, '#ff9f0a'],
  [95, '#ff453a'],
];

export function tempColor(f: number): string {
  if (f <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    if (f <= TEMP_STOPS[i][0]) {
      // Nearest stop is close enough for a 5px bar.
      const [a, ca] = TEMP_STOPS[i - 1];
      const [b, cb] = TEMP_STOPS[i];
      return f - a < b - f ? ca : cb;
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

/**
 * The weather page: Apple Weather's main screen for the selected point. A
 * live sky matching the current weather behind glass cards. Full screen on
 * phones (swipe down or ✕ to close); docked on the right at 1100px+.
 */
export class WeatherPage {
  private readonly el = $('#page');
  private readonly scroller = $('#page-scroll');
  private readonly sky = new SkyRenderer($<HTMLCanvasElement>('#sky'));
  private readonly wide = matchMedia('(min-width: 1100px)');
  private isOpen = false;
  private opener: HTMLElement | null = null;

  constructor(private readonly onLayout: (docked: boolean) => void) {
    $('#page-close').append(svg(closeIcon));
    $('#page-close').addEventListener('click', () => this.setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen && !this.docked && !document.querySelector('.sheet.open')) this.setOpen(false);
    });
    this.wide.addEventListener('change', () => this.layout());
    this.swipeToClose();
    window.addEventListener('resize', () => this.isOpen && this.sky.resize());
    // Desktop opens docked unless you closed it last time.
    if (this.wide.matches && readFlag(DOCK_KEY, true)) this.setOpen(true);
    else this.layout();
  }

  get open(): boolean {
    return this.isOpen;
  }

  get docked(): boolean {
    return this.isOpen && this.wide.matches;
  }

  toggle(opener?: HTMLElement): void {
    this.setOpen(!this.isOpen, opener);
  }

  setOpen(open: boolean, opener?: HTMLElement): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    if (this.wide.matches) writeFlag(DOCK_KEY, open);
    if (open) {
      this.opener = opener ?? null;
      this.el.hidden = false;
      // Next frame, so the slide-in transition runs from the off-screen position.
      requestAnimationFrame(() => {
        this.el.classList.add('open');
        this.sky.start();
        if (!this.docked) $('#page-close').focus({ preventScroll: true });
      });
    } else {
      this.el.classList.remove('open');
      this.sky.stop();
      const done = () => {
        if (!this.isOpen) this.el.hidden = true;
      };
      this.el.addEventListener('transitionend', done, { once: true });
      // Reduced motion has no transition; hide right away.
      setTimeout(done, 600);
      this.opener?.focus({ preventScroll: true });
    }
    this.layout();
  }

  scrollToAlerts(): void {
    const first = this.el.querySelector<HTMLDetailsElement>('.alert-card');
    if (!first) return;
    first.open = true;
    first.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  render(c: Conditions | null, s: AppState): void {
    $('#page-kicker').hidden = !s.gps;
    $('#page-place').textContent = c?.place ?? 'Locating';
    $('#page-temp').textContent = c?.tempF != null ? formatTemp(c.tempF, s.tempUnit) : '--°';
    $('#page-cond').textContent = c ? conditionWord(c) : '';
    $('#page-hilo').textContent = c ? hiLoLine(c, s) : '';

    const om = c?.om ?? null;
    // What's actually being observed beats the model when NWS has a fresh observation.
    const code = codeFromText(c?.observation?.text ?? '') ?? om?.current.weatherCode ?? 0;
    const { scene, clouds, intensity } = sceneFor(code, om?.current.isDay ?? true);
    this.sky.setScene(scene, clouds, intensity, s.theme === 'classic');

    const keep = this.scroller.scrollTop;
    $('#page-body').replaceChildren(
      ...(c?.alerts.map((a) => alertCard(a)) ?? []),
      ...(om ? [nextRainCard(om, s), hourlyCard(c!, om, s), weekCard(c!, om, s), tiles(c!, om, s)] : [loadingCard()]),
      sources(c),
    );
    this.scroller.scrollTop = keep;
  }

  private layout(): void {
    const docked = this.docked;
    this.el.setAttribute('aria-modal', String(this.isOpen && !docked));
    document.body.classList.toggle('page-docked', docked);
    this.onLayout(docked);
  }

  /** Phones: pull down from the top of the page to close it. */
  private swipeToClose(): void {
    let startY = 0;
    let tracking = false;
    this.scroller.addEventListener(
      'touchstart',
      (e) => {
        tracking = !this.docked && this.scroller.scrollTop <= 0;
        startY = e.touches[0].clientY;
      },
      { passive: true },
    );
    this.scroller.addEventListener(
      'touchmove',
      (e) => {
        if (tracking && e.touches[0].clientY - startY > 110) {
          tracking = false;
          this.setOpen(false);
        }
      },
      { passive: true },
    );
  }
}

/** NWS observation wording → the nearest WMO code, for picking the sky. */
export function codeFromText(text: string): number | null {
  const t = text.toLowerCase();
  if (!t) return null;
  if (t.includes('thunder')) return 95;
  if (/snow|sleet|ice pellets|flurr/.test(t)) return /heavy/.test(t) ? 75 : 73;
  if (/rain|drizzle|shower/.test(t)) return /heavy/.test(t) ? 65 : /light|drizzle/.test(t) ? 61 : 63;
  if (/fog|mist|haze|smoke/.test(t)) return 45;
  if (/overcast|^cloudy/.test(t)) return 3;
  if (/partly|mostly cloudy|mostly sunny|mostly clear/.test(t)) return 2;
  if (/clear|sunny|fair/.test(t)) return 0;
  return null;
}

/* ---------- cards ---------- */

function card(head: { icon: string; label: string } | null, ...children: (Node | null)[]): HTMLElement {
  return h(
    'section',
    { class: 'card glass' },
    head ? h('h3', { class: 'card-head' }, svg(head.icon), head.label) : null,
    ...children,
  );
}

function loadingCard(): HTMLElement {
  return card(null, h('p', { class: 'card-text' }, 'Loading the forecast'));
}

function alertCard(a: Alert): HTMLElement {
  return h(
    'details',
    { class: 'card glass alert-card' },
    h(
      'summary',
      {},
      h('span', { class: 'alert-title' }, svg(warningIcon), a.event),
      h(
        'p',
        { class: 'card-muted' },
        [a.ends ? `Until ${timeShort(a.ends)}` : null, a.sender].filter(Boolean).join(' · '),
      ),
    ),
    a.description ? h('p', { class: 'prose' }, reflow(a.description)) : null,
    a.instruction ? h('p', { class: 'prose' }, reflow(a.instruction)) : null,
    a.areaDesc ? h('p', { class: 'card-muted' }, a.areaDesc) : null,
  );
}

function nextRainCard(om: PointForecast, s: AppState): HTMLElement {
  const r = nextRain(om.minutely);
  const wet = r.levels.some((l) => l > 0);
  const title = h('p', { class: 'card-title' }, r.sentence);
  if (!wet) return card({ icon: umbrellaIcon, label: 'Next 2 hours' }, title);
  const bars = h('div', { class: 'rain-bars', 'aria-hidden': 'true' });
  r.levels.forEach((lv, i) => {
    const bar = h('span', { class: 'rain-bar', title: `${clockLabel(om.minutely[i].time)}: ${rateText(r.rates[i], s)}` });
    bar.style.height = lv > 0 ? `${Math.max(6, Math.round(lv * 100))}%` : '0';
    bars.append(bar);
  });
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Rain rate, next 2 hours'),
    ...om.minutely.map((m, i) => h('tr', {}, h('th', {}, clockLabel(m.time)), h('td', {}, rateText(r.rates[i], s)))),
  );
  return card(
    { icon: umbrellaIcon, label: 'Next 2 hours' },
    title,
    bars,
    h('div', { class: 'rain-axis', 'aria-hidden': 'true' }, ...['Now', '30m', '1h', '1h 30m', '2h'].map((t) => h('span', {}, t))),
    table,
  );
}

function hourlyCard(c: Conditions, om: PointForecast, s: AppState): HTMLElement {
  const first = c.periods[0];
  const summary = first ? h('p', { class: 'card-text', style: 'margin-bottom:10px' }, `${shortPeriodName(first.name)}: ${sentenceCase(first.shortForecast)}.`) : null;
  const strip = h('ol', { class: 'hours' });
  for (const cell of hourlyCells(om.hourly, om.daily)) {
    strip.append(
      cell.kind === 'hour'
        ? h(
            'li',
            { class: 'hour' },
            h('span', { class: 'hour-time' }, cell.label),
            h('span', { class: 'hour-pop' }, cell.pop >= 20 ? `${cell.pop}%` : ''),
            svg(GLYPHS[cell.glyph]),
            h('span', { class: 'hour-temp' }, formatTemp(cell.tempF, s.tempUnit)),
          )
        : h(
            'li',
            { class: 'hour is-sun' },
            h('span', { class: 'hour-time' }, cell.label),
            h('span', { class: 'hour-pop' }, ''),
            svg(GLYPHS[cell.event]),
            h('span', { class: 'hour-temp' }, cell.event),
          ),
    );
  }
  return card({ icon: clockIcon, label: 'Hourly forecast' }, summary, strip);
}

function weekCard(c: Conditions, om: PointForecast, s: AppState): HTMLElement {
  const classic = s.theme === 'classic';
  const list = h('ol', { class: 'days' });
  for (const d of weekRows(om.daily, c.tempF)) {
    const range = h('span', { class: 'range', 'aria-hidden': 'true' });
    const seg = h('span', { class: 'range-seg' });
    seg.style.left = `${(d.left * 100).toFixed(1)}%`;
    seg.style.width = `${Math.max(3, d.width * 100).toFixed(1)}%`;
    seg.style.background = classic
      ? 'var(--fg)'
      : `linear-gradient(to right, ${tempColor(d.loF)}, ${tempColor((d.loF + d.hiF) / 2)}, ${tempColor(d.hiF)})`;
    range.append(seg);
    if (d.now != null) {
      const dot = h('span', { class: 'range-now' });
      dot.style.left = `${(d.now * 100).toFixed(1)}%`;
      range.append(dot);
    }
    list.append(
      h(
        'li',
        {
          class: 'day',
          'aria-label': `${d.label}: low ${formatTemp(d.loF, s.tempUnit)}, high ${formatTemp(d.hiF, s.tempUnit)}, ${d.pop}% chance of rain`,
        },
        h('span', {}, d.label),
        h('span', { class: 'day-icon' }, svg(GLYPHS[d.glyph]), d.pop >= 20 ? h('span', { class: 'pop' }, `${d.pop}%`) : null),
        h('span', { class: 'day-lo' }, formatTemp(d.loF, s.tempUnit)),
        range,
        h('span', { class: 'day-hi' }, formatTemp(d.hiF, s.tempUnit)),
      ),
    );
  }
  return card({ icon: calendarIcon, label: '7-day forecast' }, list);
}

/* ---------- detail tiles ---------- */

function tile(icon: string, label: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card glass tile' }, h('h3', { class: 'card-head' }, svg(icon), label), ...children);
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Wind compass: ticks, N/E/S/W, an arrow pointing where the wind is going, speed in the middle. */
function compass(fromDeg: number, speed: string, unit: string): SVGSVGElement {
  const s = el('svg', { viewBox: '0 0 120 120', class: 'viz', role: 'img', 'aria-label': `Wind from the ${compass8(fromDeg)}` });
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const r1 = i % 18 === 0 ? 44 : 48;
    s.append(
      el('line', {
        x1: 60 + r1 * Math.sin(a),
        y1: 60 - r1 * Math.cos(a),
        x2: 60 + 52 * Math.sin(a),
        y2: 60 - 52 * Math.cos(a),
        class: 'viz-track',
        'stroke-width': i % 18 === 0 ? 2 : 1,
      }),
    );
  }
  for (const [t, x, y] of [
    ['N', 60, 26],
    ['E', 96, 64],
    ['S', 60, 101],
    ['W', 24, 64],
  ] as const) {
    const tx = el('text', { x, y, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, class: 'viz-dim' });
    tx.textContent = t;
    s.append(tx);
  }
  // Arrow points downwind: from + 180°.
  const g = el('g', { transform: `rotate(${(fromDeg + 180) % 360} 60 60)` });
  g.append(el('line', { x1: 60, y1: 104, x2: 60, y2: 22, class: 'viz-line', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
  g.append(el('path', { d: 'M60 14 53 27h14z', fill: 'var(--fg)' }));
  g.append(el('circle', { cx: 60, cy: 104, r: 4, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 2 }));
  s.append(g);
  s.append(el('circle', { cx: 60, cy: 60, r: 19, fill: 'rgba(0,0,0,0.35)' }));
  const v = el('text', { x: 60, y: 62, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 600, class: 'viz-text' });
  v.textContent = speed;
  const u = el('text', { x: 60, y: 73, 'text-anchor': 'middle', 'font-size': 8, class: 'viz-dim' });
  u.textContent = unit;
  s.append(v, u);
  return s;
}

/** Sun path for the day with the sun's current position. */
function sunArc(fraction: number): SVGSVGElement {
  const s = el('svg', { viewBox: '0 0 140 56', class: 'viz', 'aria-hidden': 'true' });
  const path = Array.from({ length: 41 }, (_, i) => {
    const x = (i / 40) * 140;
    const y = 40 - Math.sin((i / 40) * Math.PI) * 30;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('');
  s.append(el('path', { d: path, class: 'viz-track', fill: 'none', 'stroke-width': 2 }));
  s.append(el('line', { x1: 0, y1: 40, x2: 140, y2: 40, class: 'viz-track', 'stroke-width': 1 }));
  if (fraction >= 0 && fraction <= 1) {
    s.append(el('circle', { cx: fraction * 140, cy: 40 - Math.sin(fraction * Math.PI) * 30, r: 5, class: 'viz-dot' }));
  }
  return s;
}

/** Pressure gauge: a 270° arc with a marker, 960–1060 hPa. */
function gauge(hpa: number, value: string, unit: string): SVGSVGElement {
  const s = el('svg', { viewBox: '0 0 120 110', class: 'viz', 'aria-hidden': 'true' });
  const start = (-225 * Math.PI) / 180;
  for (let i = 0; i <= 54; i++) {
    const a = start + (i / 54) * ((270 * Math.PI) / 180);
    s.append(
      el('line', {
        x1: 60 + 40 * Math.cos(a),
        y1: 58 + 40 * Math.sin(a),
        x2: 60 + 48 * Math.cos(a),
        y2: 58 + 48 * Math.sin(a),
        class: 'viz-track',
        'stroke-width': 1.5,
      }),
    );
  }
  const f = Math.max(0, Math.min(1, (hpa - 960) / 100));
  const a = start + f * ((270 * Math.PI) / 180);
  s.append(
    el('line', {
      x1: 60 + 36 * Math.cos(a),
      y1: 58 + 36 * Math.sin(a),
      x2: 60 + 52 * Math.cos(a),
      y2: 58 + 52 * Math.sin(a),
      stroke: 'var(--fg)',
      'stroke-width': 4,
      'stroke-linecap': 'round',
    }),
  );
  const v = el('text', { x: 60, y: 62, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600, class: 'viz-text' });
  v.textContent = value;
  const u = el('text', { x: 60, y: 76, 'text-anchor': 'middle', 'font-size': 9, class: 'viz-dim' });
  u.textContent = unit;
  s.append(v, u);
  return s;
}

/** "07:25" style local times → minutes since midnight. */
const minutesOf = (isoLocal: string) => Number(isoLocal.slice(11, 13)) * 60 + Number(isoLocal.slice(14, 16));

function tiles(c: Conditions, om: PointForecast, s: AppState): HTMLElement {
  const cur = om.current;
  const today = om.daily[0];
  const tomorrow = om.daily[1];
  const tempF = c.tempF ?? cur.tempF;

  const feelsDiff = cur.feelsF - tempF;
  const feelsNote =
    Math.abs(feelsDiff) < 3
      ? 'Similar to the actual temperature.'
      : feelsDiff > 0
        ? 'Humidity is making it feel warmer.'
        : 'Wind is making it feel cooler.';

  const uv = Math.round(cur.uv);
  const uvBar = h('div', { class: 'uv-bar' });
  const uvDot = h('span', { class: 'range-now' });
  uvDot.style.left = `${Math.min(100, (cur.uv / 11) * 100).toFixed(1)}%`;
  uvBar.append(uvDot);

  const windVal = s.windUnit === 'kmh' ? Math.round(cur.windMph * 1.609344) : Math.round(cur.windMph);

  // Sun: which event is next, and where the sun is between sunrise and sunset.
  const nowMin = minutesOf(cur.time);
  const rise = today ? minutesOf(today.sunrise) : 0;
  const set = today ? minutesOf(today.sunset) : 0;
  const beforeSet = nowMin < set;
  const nextLabel = nowMin < rise ? 'Sunrise' : beforeSet ? 'Sunset' : 'Sunrise';
  const nextTime = today ? (nowMin < rise ? today.sunrise : beforeSet ? today.sunset : (tomorrow?.sunrise ?? today.sunrise)) : '';
  const otherLabel = nextLabel === 'Sunset' ? 'Sunrise' : 'Sunset';
  const otherTime = today ? (nextLabel === 'Sunset' ? today.sunrise : today.sunset) : '';

  const visMi = cur.visibilityM / 1609.344;
  const visNote = visMi >= 10 ? 'Perfectly clear view.' : visMi >= 5 ? 'Mostly clear.' : 'Haze or rain is limiting visibility.';

  const pressure =
    s.tempUnit === 'F'
      ? { value: (cur.pressureHpa * 0.02953).toFixed(2), unit: 'inHg' }
      : { value: String(Math.round(cur.pressureHpa)), unit: 'hPa' };

  const rain24 = om.hourly.reduce((sum, hr) => sum + hr.precipitation, 0);

  return h(
    'div',
    { class: 'tiles' },
    tile(thermoIcon, 'Feels like', h('div', { class: 'tile-value' }, formatTemp(cur.feelsF, s.tempUnit)), h('p', { class: 'tile-note' }, feelsNote)),
    tile(
      sunMark,
      'UV index',
      h('div', { class: 'tile-value' }, String(uv)),
      h('div', { class: 'tile-sub' }, uvWord(cur.uv)),
      uvBar,
      today ? h('p', { class: 'tile-note' }, `Max today: ${Math.round(today.uvMax)}`) : null,
    ),
    tile(
      windIcon,
      'Wind',
      compass(cur.windFromDeg, String(windVal), s.windUnit === 'kmh' ? 'km/h' : 'mph'),
      h('p', { class: 'tile-note' }, `Gusts ${formatWind(cur.gustMph, s.windUnit)} · from ${compass8(cur.windFromDeg)}`),
    ),
    tile(
      dropIcon,
      'Humidity',
      h('div', { class: 'tile-value' }, `${Math.round(cur.humidity)}%`),
      h('p', { class: 'tile-note' }, `The dew point is ${formatTemp(cur.dewF, s.tempUnit)} right now.`),
    ),
    tile(
      sunsetIcon,
      nextLabel,
      h('div', { class: 'tile-value' }, nextTime ? clockLabel(nextTime) : '--'),
      sunArc(set > rise ? (nowMin - rise) / (set - rise) : -1),
      otherTime ? h('p', { class: 'tile-note' }, `${otherLabel}: ${clockLabel(otherTime)}`) : null,
    ),
    tile(eyeIcon, 'Visibility', h('div', { class: 'tile-value' }, visibilityText(cur.visibilityM, s)), h('p', { class: 'tile-note' }, visNote)),
    tile(gaugeIcon, 'Pressure', gauge(cur.pressureHpa, pressure.value, pressure.unit)),
    tile(
      umbrellaIcon,
      'Precipitation',
      h('div', { class: 'tile-value' }, amountText(rain24, s)),
      h('div', { class: 'tile-sub' }, 'Next 24 hours'),
      h('p', { class: 'tile-note' }, nextRain(om.minutely).sentence),
    ),
  );
}

function sources(c: Conditions | null): HTMLElement {
  const obs = c?.observation;
  return h(
    'p',
    { class: 'page-foot' },
    [
      'Forecasts: Open-Meteo, NWS.',
      obs ? `Observed at ${obs.stationName}, ${timeShort(obs.timestamp)}.` : null,
      'Alerts: National Weather Service.',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage blocked: lasts for this visit.
  }
}
