import type { Conditions } from '../data/conditions';
import { aqiNote, aqiWord, getAirQuality, pollenWord, type AirQuality } from '../data/airQuality';
import { getNormal, getOutlooks, MODELS, NORMAL_YEARS, type Normal, type Outlooks } from '../data/climate';
import { getTides, tideAt, type Tides } from '../data/tides';
import { getAloft, type Aloft } from '../data/aloft';
import { aloftCard } from './aloftCard';
import { getKp, type KpBlock } from '../data/flyability';
import { flyCard } from './flyCard';
import { cloudWord, dayHours, hourOfDay, type Metric } from '../data/dayDetail';
import { moonPhase, moonTimes } from '../data/moon';
import type { Alert } from '../data/nws';
import type { DailyPoint, HourDetail, PointForecast } from '../data/openmeteo';
import { clockLabel, hourlyCells, nextRain, uvWord, weekRows } from '../data/outlook';
import type { AppState } from '../state';
import { sentenceCase } from '../util/text';
import { compass8, formatTemp, formatWind, windIn, windLabel } from '../util/units';
import { $, h, svg } from './dom';
import { amountText, conditionWord, hiLoLine, rateText, reflow, shortPeriodName, timeShort, visibilityText } from './format';
import {
  calendarIcon,
  closeIcon,
  cloudMark,
  dropIcon,
  eyeIcon,
  flowerIcon,
  gaugeIcon,
  modelsIcon,
  tideIcon,
  GLYPHS,
  sunMark,
  sunsetIcon,
  thermoIcon,
  umbrellaIcon,
  warningIcon,
  windIcon,
  airIcon,
} from './icons';
import { DayDetail } from './dayDetail';
import { paintMoon } from './moonRender';
import { sceneFor, SkyRenderer } from './sky';

const DOCK_KEY = 'weather-map:page-docked';
/** How long the page's extras (air, averages, tides, the models) are kept before loading again. */
const EXTRAS_MS = 60 * 60_000;
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
 * The weather page: Apple Weather's main screen for the selected point. A live sky matching the
 * current weather behind glass cards. With the one-panel layout (every screen since 2026-10-25) it
 * comes down from the banner as a drawer, full screen, its cards a centered column; without it,
 * docked on the right at 1100px+.
 */
export class WeatherPage {
  private readonly el = $('#page');
  private readonly scroller = $('#page-scroll');
  private readonly sky = new SkyRenderer($<HTMLCanvasElement>('#sky'));
  private readonly wide = matchMedia('(min-width: 1100px)');
  private isOpen = false;
  private opener: HTMLElement | null = null;
  /** Tap a card, tile, or day: that day's detail, hour by hour. */
  private readonly detail = new DayDetail();
  /** What the hourly card and the 7-day list show (owner, 2026-10-23: Apple's toggles, plus humidity). */
  private mode: PageMode = readMode();
  private last: { c: Conditions | null; s: AppState } | null = null;
  /** What loads when the page shows a place (air, averages, tides, the models), by kind and place: null, none there. */
  private readonly extras = new Map<string, { at: number; v: unknown }>();
  /** Hours from now the winds-aloft card shows (its ‹ › buttons). */
  private aloftOffset = 0;
  /** The flyability card's hour tapped, from now. */
  private flyHour = 0;
  private readonly loading = new Set<string>();
  /** Told the sky's top color while the page is open, null when it closes (the browser's status-bar strip follows it). */
  onTop: ((color: string | null) => void) | null = null;

  constructor(private readonly onLayout: (docked: boolean) => void) {
    const body = $('#page-body');
    const openDetail = (e: Event) => {
      const t = (e.target as Element).closest<HTMLElement>('[data-detail]');
      if (t) this.detail.open(t.dataset.detail as Metric, t.dataset.day ?? null, t, t.dataset.feels === '1');
    };
    body.addEventListener('click', openDetail);
    body.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).matches('[data-detail]')) {
        e.preventDefault();
        openDetail(e);
      }
    });
    $('#page-close').append(svg(closeIcon));
    $('#page-close').addEventListener('click', () => this.setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen && !this.docked && !document.querySelector('.sheet.open')) this.setOpen(false);
    });
    this.wide.addEventListener('change', () => this.layout());
    this.swipeToClose();
    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.sky.resize();
      if (this.drawer && !this.dragging) this.hang(this.span(), false);
    });
    // Desktop without the drawer opens docked unless you closed it last time.
    if (this.wide.matches && !this.drawer && readFlag(DOCK_KEY, true)) this.setOpen(true);
    else this.layout();
  }

  get open(): boolean {
    return this.isOpen;
  }

  get docked(): boolean {
    return this.isOpen && this.wide.matches && !this.drawer;
  }

  toggle(opener?: HTMLElement): void {
    this.setOpen(!this.isOpen, opener);
  }

  /* ---------- phones: the banner is the page's foot; the two come down as one drawer ---------- */

  /** How far the drawer is down, px: 0 closed (the banner at the top), span() open. */
  private pulled = 0;
  /** Where it was when the finger went down. */
  private from = 0;
  private dragging = false;

  private get drawer(): boolean {
    return document.body.classList.contains('phone');
  }

  private head(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.phone-head');
  }

  /** The banner's top edge when closed (layout, so a transform in flight doesn't count). */
  private top(): number {
    return this.head()?.offsetTop ?? 0;
  }

  /** How far it all travels to open: until the banner has gone off the bottom of the screen. */
  private span(): number {
    return Math.max(0, innerHeight - this.top());
  }

  /**
   * Hang the drawer `px` down: the banner by exactly that, and the page right above it, its bottom
   * edge on the banner's top, so the two read as one sheet. Open, the page fills the screen and the
   * banner, its foot, has been pushed off the bottom (owner, 2026-10-23: not left lying over it).
   */
  private hang(px: number, animate: boolean): void {
    const head = this.head();
    this.pulled = Math.min(this.span(), Math.max(0, px));
    const t = animate ? '' : 'none';
    this.el.style.transition = t;
    this.el.style.transform = `translateY(${(this.top() + this.pulled - innerHeight).toFixed(1)}px)`;
    if (head) {
      head.style.transition = t;
      head.style.transform = this.pulled ? `translateY(${this.pulled.toFixed(1)}px)` : '';
    }
  }

  /** The handle moved `dy` px (down is +) since the finger went down: the drawer follows it. */
  drag(dy: number): void {
    if (!this.drawer) return;
    if (!this.dragging) {
      this.dragging = true;
      this.from = this.isOpen ? this.span() : 0;
      if (!this.isOpen) {
        this.el.hidden = false;
        document.body.classList.add('drawer-on');
        // The live sky comes down with it, not a blank page that lights up once it lands.
        this.sky.start();
      }
    }
    this.hang(this.from + dy, false);
  }

  /** Let go: open or closed by how far it went and which way it was moving (px/ms, down +). */
  release(dy: number, speed: number, opener?: HTMLElement): void {
    if (!this.dragging) return;
    this.dragging = false;
    const span = this.span();
    const open = this.from === 0 ? dy > span * 0.2 || speed > 0.5 : !(-dy > span * 0.2 || speed < -0.5);
    if (open) {
      if (this.isOpen) this.hang(span, true);
      else this.setOpen(true, opener);
    } else if (this.isOpen) {
      this.setOpen(false);
    } else {
      this.shut();
    }
  }

  /** Up and away: the drawer closes, then the page hides and the banner lets go of its transform. */
  private shut(): void {
    this.hang(0, true);
    this.sky.stop();
    const done = () => {
      if (this.isOpen || this.dragging) return;
      this.el.hidden = true;
      this.el.style.transform = '';
      this.el.style.transition = '';
      const head = this.head();
      if (head) head.style.transition = '';
      document.body.classList.remove('drawer-on');
    };
    this.el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 600);
  }

  setOpen(open: boolean, opener?: HTMLElement): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    if (this.wide.matches && !this.drawer) writeFlag(DOCK_KEY, open);
    if (open) {
      // The page takes over from a chart hanging under the banner.
      if (this.detail.bannerMetric) this.detail.close();
      this.opener = opener ?? null;
      this.el.hidden = false;
      this.onTop?.(this.sky.topColor());
      if (this.drawer) {
        // Phones: down from the top with the banner as its foot, from wherever a pull left it.
        document.body.classList.add('drawer-on');
        if (!this.pulled) {
          this.hang(0, false);
          void this.el.offsetHeight;
        }
        this.el.classList.add('open');
        this.hang(this.span(), true);
        this.sky.start();
        $('#page-close').focus({ preventScroll: true });
      } else {
        // Next frame, so the slide-in transition runs from the off-screen position.
        requestAnimationFrame(() => {
          this.el.classList.add('open');
          this.sky.start();
          if (!this.docked) $('#page-close').focus({ preventScroll: true });
        });
      }
    } else {
      this.detail.close();
      this.onTop?.(null);
      this.el.classList.remove('open');
      if (this.drawer || this.pulled) {
        this.shut();
      } else {
        this.sky.stop();
        const done = () => {
          if (!this.isOpen) this.el.hidden = true;
        };
        this.el.addEventListener('transitionend', done, { once: true });
        // Reduced motion has no transition; hide right away.
        setTimeout(done, 600);
      }
      this.opener?.focus({ preventScroll: true });
    }
    this.layout();
  }

  /** The banner's chips: that metric's chart for today (or `date`), dropped down under the banner; tap again to close. */
  toggleDetail(metric: Metric, opener: HTMLElement, anchor: HTMLElement, date: string | null = null): void {
    if (this.detail.bannerMetric === metric && this.detail.bannerDate === date) this.detail.close();
    else this.detail.open(metric, date, opener, false, anchor);
  }

  /** Keeps the chart current while the page is closed (the page's own render does it while open). */
  feedDetail(c: Conditions | null, s: AppState): void {
    this.detail.update(c, s);
  }

  /** Told when the chart under the banner opens, closes, or changes metric. */
  set onDetailToggle(fn: (bannerMetric: Metric | null, bannerDate: string | null) => void) {
    this.detail.onToggle = () => fn(this.detail.bannerMetric, this.detail.bannerDate);
  }

  scrollToAlerts(): void {
    const first = this.el.querySelector<HTMLDetailsElement>('.alert-card');
    if (!first) return;
    first.open = true;
    first.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private setMode(m: PageMode): void {
    this.mode = m;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Lasts for this visit.
    }
    if (this.last) this.render(this.last.c, this.last.s);
  }

  /**
   * Something extra for the place, loaded the first time the page shows it: known, null (none there),
   * or undefined while it loads (then a redraw). Kept an hour, then loaded again behind what's shown.
   */
  private later<T>(kind: string, c: Conditions, load: () => Promise<T | null>): T | null | undefined {
    const key = `${kind}:${c.point.lat.toFixed(2)},${c.point.lon.toFixed(2)}`;
    const had = this.extras.get(key);
    if ((!had || Date.now() - had.at > EXTRAS_MS) && !this.loading.has(key)) {
      this.loading.add(key);
      void load()
        .then((v) => this.extras.set(key, { at: Date.now(), v }))
        // A failed load keeps what was there (or none) for another hour, rather than trying on every redraw.
        .catch(() => this.extras.set(key, { at: Date.now(), v: had?.v ?? null }))
        .finally(() => {
          this.loading.delete(key);
          if (this.isOpen && this.last) this.render(this.last.c, this.last.s);
        });
    }
    return had?.v as T | null | undefined;
  }

  /** The winds-aloft card at the hour it's on, now plus its offset, stepping keeps it in the two days. */
  private aloft(c: Conditions, om: PointForecast): HTMLElement | null {
    const aloft = this.later<Aloft>('aloft', c, () => getAloft(c.point));
    const now = aloft ? Math.max(0, aloft.hours.findIndex((x) => x.time.slice(0, 13) === om.current.time.slice(0, 13))) : 0;
    return aloftCard(aloft, now + this.aloftOffset, now, (by) => {
      if (!aloft) return;
      this.aloftOffset = Math.max(-now, Math.min(aloft.hours.length - 1 - now, this.aloftOffset + by));
      if (this.last) this.render(this.last.c, this.last.s);
    });
  }

  /** Flyability: shares the winds-aloft data (its 400 ft wind) and adds the Kp forecast. */
  private fly(c: Conditions, om: PointForecast): HTMLElement {
    const redraw = () => this.last && this.render(this.last.c, this.last.s);
    return flyCard(
      om,
      c.point,
      this.later<Aloft>('aloft', c, () => getAloft(c.point)),
      this.later<KpBlock[]>('kp', c, () => getKp()),
      this.flyHour,
      (i) => {
        this.flyHour = i;
        redraw();
      },
      redraw,
    );
  }

  render(c: Conditions | null, s: AppState): void {
    this.last = { c, s };
    $('#page-kicker').hidden = !s.gps;
    $('#page-place').textContent = c?.place ?? 'Locating';
    $('#page-temp').textContent = c?.tempF != null ? formatTemp(c.tempF, s.tempUnit) : '--°';
    $('#page-cond').textContent = c ? conditionWord(c) : '';
    $('#page-hilo').textContent = c ? hiLoLine(c, s) : '';

    const om = c?.om ?? null;
    // What's actually being observed beats the model when NWS has a fresh observation.
    let code = codeFromText(c?.observation?.text ?? '') ?? om?.current.weatherCode ?? 0;
    let phase = sunPhase(om);
    if (import.meta.env.DEV) {
      // Dev only: ?sky=95&phase=0.97 previews a weather code at a time of day.
      const q = new URLSearchParams(location.search);
      if (q.has('sky')) code = Number(q.get('sky'));
      if (q.has('phase')) phase = Number(q.get('phase'));
    }
    const { scene, clouds, intensity } = sceneFor(code, phase >= 0 && phase <= 1);
    this.sky.setScene(scene, clouds, intensity, s.theme === 'classic', phase);
    // The cards darken over a bright sky, so their white type keeps its contrast (styles.css --sky-light).
    const light = this.sky.brightness();
    if (light != null) this.el.style.setProperty('--sky-light', light.toFixed(2));
    if (this.isOpen) this.onTop?.(this.sky.topColor());

    const keep = this.scroller.scrollTop;
    const air = c ? this.later('air', c, () => getAirQuality(c.point)) : undefined;
    const outlooks = c ? this.later('outlooks', c, () => getOutlooks(c.point)) : undefined;
    const yesterday = om?.daily[0] ? new Date(Date.parse(`${om.daily[0].date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null;
    $('#page-body').replaceChildren(
      ...(c?.alerts.map((a) => alertCard(a)) ?? []),
      ...(om
        ? [
            nextRainCard(om, s),
            hourlyCard(c!, om, s, this.mode, (m) => this.setMode(m)),
            weekCard(c!, om, s, this.mode),
            ...longCards(c!, om, s, air),
            tiles(c!, om, s, {
              air,
              normal: this.later('normal', c!, () => (om.daily[0] ? getNormal(c!.point, om.daily[0].date) : Promise.resolve(null))),
              outlooks,
            }),
            tidesCard(this.later('tides', c!, () => (yesterday ? getTides(c!.point, yesterday) : Promise.resolve(null))), om, s),
            modelsCard(outlooks, s),
            s.pilotCards ? this.aloft(c!, om) : null,
            s.pilotCards ? this.fly(c!, om) : null,
          ].filter((x): x is HTMLElement => x != null)
        : [loadingCard()]),
      sources(c),
    );
    this.scroller.scrollTop = keep;
    this.detail.update(c, s);
  }

  private layout(): void {
    const docked = this.docked;
    this.el.setAttribute('aria-modal', String(this.isOpen && !docked));
    document.body.classList.toggle('page-docked', docked);
    this.onLayout(docked);
  }

  /**
   * Send the page back the way it came. Phones (it came down from the top): push up past the end of
   * the page. Tablets: pull down from the top of it.
   */
  private swipeToClose(): void {
    let startY = 0;
    let tracking = false;
    this.scroller.addEventListener(
      'touchstart',
      (e) => {
        const s = this.scroller;
        tracking = !this.docked && (this.drawer ? s.scrollTop + s.clientHeight >= s.scrollHeight - 2 : s.scrollTop <= 0);
        startY = e.touches[0].clientY;
      },
      { passive: true },
    );
    this.scroller.addEventListener(
      'touchmove',
      (e) => {
        const dy = e.touches[0].clientY - startY;
        if (tracking && (this.drawer ? -dy : dy) > 110) {
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

/** Make a card, tile, or row open the day-detail panel. */
function opens<T extends HTMLElement>(node: T, metric: Metric, opts: { day?: string; feels?: boolean } = {}): T {
  node.dataset.detail = metric;
  if (opts.day) node.dataset.day = opts.day;
  if (opts.feels) node.dataset.feels = '1';
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  return node;
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
  if (!wet) return opens(card({ icon: umbrellaIcon, label: 'Next 2 hours' }, title), 'precip');
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
  return opens(
    card(
      { icon: umbrellaIcon, label: 'Next 2 hours' },
      title,
      bars,
      h('div', { class: 'rain-axis', 'aria-hidden': 'true' }, ...['Now', '30m', '1h', '1h 30m', '2h'].map((t) => h('span', {}, t))),
      table,
    ),
    'precip',
  );
}

/* ---------- hourly and 7 days, by what's picked: conditions, rain, wind, humidity ---------- */

type PageMode = 'temp' | 'precip' | 'wind' | 'humidity';
const MODE_KEY = 'weather-map:page-mode';
const MODES: { id: PageMode; icon: string; label: string; metric: Metric; color: string }[] = [
  { id: 'temp', icon: cloudMark, label: 'Conditions', metric: 'conditions', color: '#ffd60a' },
  { id: 'precip', icon: umbrellaIcon, label: 'Precipitation', metric: 'precip', color: '#409cff' },
  { id: 'wind', icon: windIcon, label: 'Wind', metric: 'wind', color: '#64d2ff' },
  { id: 'humidity', icon: dropIcon, label: 'Humidity', metric: 'humidity', color: '#30d158' },
];
const modeOf = (m: PageMode) => MODES.find((x) => x.id === m)!;

function readMode(): PageMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES.some((m) => m.id === v) ? (v as PageMode) : 'temp';
  } catch {
    return 'temp';
  }
}

/** Apple's toggle in the card's corner: one icon per view. */
function modeSeg(mode: PageMode, setMode: (m: PageMode) => void): HTMLElement {
  const g = h('div', { class: 'mode-seg', role: 'group', 'aria-label': 'Show by the hour' });
  for (const m of MODES) {
    const b = h('button', { type: 'button', 'aria-pressed': String(m.id === mode), 'aria-label': m.label, title: m.label }, svg(m.icon));
    b.addEventListener('click', (e) => {
      // The card itself opens the chart; the toggle only switches the view.
      e.stopPropagation();
      setMode(m.id);
    });
    g.append(b);
  }
  return g;
}

/** Rain intensity, mm/h → 0..1 (square root, so drizzle still shows; full at 8 mm/h). */
const rainLevel = (mmH: number) => Math.min(1, Math.sqrt(Math.max(0, mmH) / 8));

/** One hour's slice of a line that runs on through the strip: from the edge it shares with the hour before to the one after. */
function hourLine(prev: number, cur: number, next: number, lo: number, hi: number, color: string, now: boolean): SVGSVGElement {
  const y = (v: number) => 27 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * 22;
  const a = y((prev + cur) / 2);
  const m = y(cur);
  const b = y((cur + next) / 2);
  const s = el('svg', { viewBox: '0 0 100 30', preserveAspectRatio: 'none', class: 'hour-line', 'aria-hidden': 'true' });
  s.append(el('path', { d: `M0 ${a}L50 ${m}L100 ${b}L100 30L0 30Z`, fill: color, 'fill-opacity': 0.18 }));
  s.append(el('path', { d: `M0 ${a}L50 ${m}L100 ${b}`, fill: 'none', stroke: color, 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }));
  if (now) s.append(el('line', { x1: 50, y1: m, x2: 50, y2: m, stroke: '#ffffff', 'stroke-width': 7, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  return s;
}

function hourlyCard(c: Conditions, om: PointForecast, s: AppState, mode: PageMode, setMode: (m: PageMode) => void): HTMLElement {
  const first = c.periods[0];
  const unit = windLabel(s.windUnit);
  const wind = (mph: number) => windIn(mph, s.windUnit);
  const [title, sub] =
    mode === 'precip'
      ? ['Precipitation', 'Intensity · Chance']
      : mode === 'wind'
        ? ['Wind', `Speed (${unit}) · Direction`]
        : mode === 'humidity'
          ? ['Humidity', 'Humidity · Dew point']
          : ['Hourly forecast', first ? `${shortPeriodName(first.name)}: ${sentenceCase(first.shortForecast)}.` : ''];
  const head = h(
    'div',
    { class: 'card-top' },
    h('div', { class: 'card-top-text' }, h('h3', { class: 'card-title2' }, title), sub ? h('p', { class: 'card-sub' }, sub) : null),
    modeSeg(mode, setMode),
  );

  const cells = hourlyCells(om.hourly, om.daily);
  // Lines run on through the sunrise/sunset cells with the hours either side.
  const raw = cells.map((k) =>
    k.kind !== 'hour' ? Number.NaN : mode === 'wind' ? wind(k.at.windMph) : (k.at as HourDetail).humidity,
  );
  const vals = raw.map((v, i) => (Number.isFinite(v) ? v : ((raw[i - 1] ?? raw[i + 1]) + (raw[i + 1] ?? raw[i - 1])) / 2));
  const hi = mode === 'wind' ? Math.max(wind(10), ...vals.filter(Number.isFinite)) : 100;
  const color = modeOf(mode).color;

  const strip = h('ol', { class: `hours is-${mode}` });
  cells.forEach((k, i) => {
    if (k.kind !== 'hour') {
      strip.append(
        h(
          'li',
          { class: 'hour is-sun' },
          h('span', { class: 'hour-time' }, k.label),
          mode === 'temp' ? h('span', { class: 'hour-pop' }, '') : null,
          svg(GLYPHS[k.event]),
          h('span', { class: 'hour-temp' }, k.event),
          mode === 'wind' || mode === 'humidity' ? hourLine(vals[i - 1] ?? vals[i], vals[i], vals[i + 1] ?? vals[i], 0, hi, color, false) : null,
        ),
      );
      return;
    }
    const at = k.at as HourDetail;
    if (mode === 'precip') {
      const bar = h('span', { class: 'hour-bar' }, h('i', {}));
      (bar.firstChild as HTMLElement).style.height = `${(rainLevel(at.precipitation) * 100).toFixed(0)}%`;
      strip.append(
        h(
          'li',
          { class: 'hour', title: `${rateText(at.precipitation, s)}, ${Math.round(at.precipProbability)}% chance` },
          h('span', { class: 'hour-time' }, k.label),
          bar,
          h('span', { class: 'hour-chance' }, `${Math.round(at.precipProbability)}%`),
        ),
      );
    } else if (mode === 'wind' || mode === 'humidity') {
      const arrow = mode === 'wind' ? svg('<svg viewBox="0 0 24 24" class="hour-arrow"><path d="M12 20V5M6 11l6-6 6 6" /></svg>') : null;
      if (arrow) arrow.style.transform = `rotate(${(at.windFromDeg + 180) % 360}deg)`;
      strip.append(
        h(
          'li',
          { class: 'hour', title: mode === 'humidity' ? `Dew point ${formatTemp(at.dewF, s.tempUnit)}` : `Gusts ${formatWind(at.gustMph, s.windUnit)}` },
          h('span', { class: 'hour-time' }, k.label),
          h(
            'span',
            { class: 'hour-val' },
            mode === 'wind' ? String(Math.round(vals[i])) : `${Math.round(vals[i])}%`,
            mode === 'wind' ? h('small', {}, unit) : h('small', {}, `dew ${formatTemp(at.dewF, s.tempUnit)}`),
          ),
          arrow,
          hourLine(vals[i - 1] ?? vals[i], vals[i], vals[i + 1] ?? vals[i], 0, hi, color, i === 0),
        ),
      );
    } else {
      strip.append(
        h(
          'li',
          { class: 'hour' },
          h('span', { class: 'hour-time' }, k.label),
          h('span', { class: 'hour-pop' }, k.pop >= 20 ? `${k.pop}%` : ''),
          svg(GLYPHS[k.glyph]),
          h('span', { class: 'hour-temp' }, formatTemp(k.tempF, s.tempUnit)),
        ),
      );
    }
  });
  return opens(h('section', { class: 'card glass' }, head, strip), modeOf(mode).metric);
}

/** A day as a little graph in its row: bars (rain, two hours a bar) or a line, with a dot at now today. */
function dayGraph(values: number[], lo: number, hi: number, color: string, bars: boolean, now: number | null): SVGSVGElement {
  const W = 120;
  const H = 26;
  const s = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'day-graph', 'aria-hidden': 'true' });
  const y = (v: number) => H - 2 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - 4);
  if (bars) {
    const n = 12;
    const bw = W / n;
    for (let k = 0; k < n; k++) {
      const v = Math.max(values[k * 2] ?? 0, values[k * 2 + 1] ?? 0);
      s.append(el('rect', { x: k * bw + 2, y: 2, width: bw - 4, height: H - 4, rx: 2.5, fill: '#ffffff', 'fill-opacity': 0.12 }));
      if (v > 0) s.append(el('rect', { x: k * bw + 2, y: y(v), width: bw - 4, height: H - 2 - y(v), rx: 2.5, fill: color }));
    }
    return s;
  }
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  s.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  if (now != null) {
    const i0 = Math.min(values.length - 1, Math.floor(now));
    const nx = (now / Math.max(1, values.length - 1)) * W;
    s.append(el('line', { x1: nx, y1: y(values[i0]), x2: nx, y2: y(values[i0]), stroke: '#ffffff', 'stroke-width': 7, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  }
  return s;
}

function weekCard(c: Conditions, om: PointForecast, s: AppState, mode: PageMode): HTMLElement {
  const classic = s.theme === 'classic';
  const metric = modeOf(mode).metric;
  const color = classic ? '#f0f0fa' : modeOf(mode).color;
  const wind = (mph: number) => windIn(mph, s.windUnit);
  const list = h('ol', { class: `days is-${mode}` });
  weekRows(om.daily, c.tempF).forEach((d, i) => {
    const date = om.daily[i].date;
    const { hours, own } = dayHours(om.week, date);
    const day = hours.slice(0, own);
    const now = i === 0 ? hourOfDay(om.current.time, date) : null;
    let row: HTMLElement;
    if (mode === 'temp' || !own) {
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
      row = h(
        'li',
        { class: 'day', 'aria-label': `${d.label}: low ${formatTemp(d.loF, s.tempUnit)}, high ${formatTemp(d.hiF, s.tempUnit)}, ${d.pop}% chance of rain` },
        h('span', {}, d.label),
        h('span', { class: 'day-icon' }, svg(GLYPHS[d.glyph]), d.pop >= 20 ? h('span', { class: 'pop' }, `${d.pop}%`) : null),
        h('span', { class: 'day-lo' }, formatTemp(d.loF, s.tempUnit)),
        range,
        h('span', { class: 'day-hi' }, formatTemp(d.hiF, s.tempUnit)),
      );
    } else if (mode === 'precip') {
      const total = day.reduce((sum, x) => sum + x.precipitation, 0);
      const pop = om.daily[i].precipProbability;
      row = h(
        'li',
        { class: 'day', 'aria-label': `${d.label}: ${amountText(total, s)} of rain, ${Math.round(pop)}% chance` },
        h('span', {}, d.label),
        dayGraph(day.map((x) => rainLevel(x.precipitation)), 0, 1, color, true, null),
        h('span', { class: 'day-amt' }, amountText(total, s)),
        h('span', { class: `day-chance${pop >= 20 ? '' : ' is-low'}` }, pop >= 20 ? svg(dropIcon) : null, `${Math.round(pop)}%`),
      );
    } else {
      const vals = day.map((x) => (mode === 'wind' ? wind(x.windMph) : x.humidity));
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const text = mode === 'wind' ? `${Math.round(lo)}–${Math.round(hi)} ${windLabel(s.windUnit)}` : `${Math.round(lo)}–${Math.round(hi)}%`;
      row = h(
        'li',
        { class: 'day', 'aria-label': `${d.label}: ${mode === 'wind' ? 'wind' : 'humidity'} ${text}` },
        h('span', {}, d.label),
        dayGraph(vals, mode === 'wind' ? 0 : 0, mode === 'wind' ? Math.max(wind(20), hi) : 100, color, false, now),
        h('span', { class: 'day-span' }, text),
      );
    }
    list.append(opens(row, metric, { day: date }));
  });
  return card({ icon: calendarIcon, label: `${om.daily.length}-day forecast` }, list);
}

/* ---------- detail tiles ---------- */

function tile(icon: string, label: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card glass tile', 'aria-label': `${label} details` }, h('h3', { class: 'card-head' }, svg(icon), label), ...children);
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

/** The moon as it looks tonight: NASA's map on a lit sphere at this phase (moonRender.ts). */
function moonCanvas(phase: number, name: string): HTMLCanvasElement {
  const px = Math.round(124 * Math.min(3, Math.max(1, window.devicePixelRatio || 1)));
  const c = h('canvas', { class: 'moon-canvas', width: px, height: px, role: 'img', 'aria-label': name });
  paintMoon(c, phase);
  return c;
}

/** "07:25" style local times → minutes since midnight. */
const minutesOf = (isoLocal: string) => Number(isoLocal.slice(11, 13)) * 60 + Number(isoLocal.slice(14, 16));

/** Where the day is, for the sky: 0 at sunrise, 1 at sunset, below 0 or above 1 at night. */
export function sunPhase(om: PointForecast | null): number {
  const today = om?.daily[0];
  if (!om || !today) return om?.current.isDay === false ? -0.5 : 0.5;
  const rise = minutesOf(today.sunrise);
  const set = minutesOf(today.sunset);
  return set > rise ? (minutesOf(om.current.time) - rise) / (set - rise) : om.current.isDay ? 0.5 : -0.5;
}

/* ---------- the long cards: air quality, wind, moon (Apple's full-width ones) ---------- */

/** A long card's list: a label on the left, its value on the right, hairlines between. */
function rows(...items: [string, string][]): HTMLElement {
  return h('dl', { class: 'long-rows' }, ...items.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function longCards(c: Conditions, om: PointForecast, s: AppState, air: AirQuality | null | undefined): HTMLElement[] {
  const cur = om.current;
  const out: HTMLElement[] = [];

  // Air quality: the U.S. AQI, its word, where it sits on the scale, and how it compares with yesterday.
  if (air !== null) {
    if (air === undefined) {
      out.push(card({ icon: airIcon, label: 'Air quality' }, h('p', { class: 'card-text' }, 'Loading air quality')));
    } else {
      const bar = h('div', { class: 'aqi-bar' });
      const dot = h('span', { class: 'range-now' });
      dot.style.left = `${Math.min(100, (air.aqi / 300) * 100).toFixed(1)}%`;
      bar.append(dot);
      out.push(
        card(
          { icon: airIcon, label: 'Air quality' },
          h('div', { class: 'tile-value' }, String(air.aqi)),
          h('div', { class: 'tile-sub' }, aqiWord(air.aqi)),
          bar,
          h('p', { class: 'tile-note' }, aqiNote(air)),
        ),
      );
    }
  }

  // Wind: speed, gusts, and direction beside the compass.
  const windVal = Math.round(windIn(cur.windMph, s.windUnit));
  out.push(
    opens(
      card(
        { icon: windIcon, label: 'Wind' },
        h(
          'div',
          { class: 'long-body' },
          rows(
            ['Wind', formatWind(cur.windMph, s.windUnit)],
            ['Gusts', formatWind(cur.gustMph, s.windUnit)],
            ['Direction', `${Math.round(cur.windFromDeg)}° ${compass8(cur.windFromDeg)}`],
          ),
          compass(cur.windFromDeg, String(windVal), windLabel(s.windUnit)),
        ),
      ),
      'wind',
    ),
  );

  // Moon: its phase, how much is lit, when it rises (or sets) here today, and the next full moon.
  const moon = moonPhase(new Date());
  const today = om.daily[0];
  const offset = om.utcOffsetSeconds * 1000;
  const midnight = today ? Date.parse(`${today.date}T00:00:00Z`) - offset : Date.now();
  const times = moonTimes(midnight, c.point.lat, c.point.lon);
  const local = (ms: number) => clockLabel(new Date(ms + offset).toISOString().slice(0, 16));
  const nowMs = Date.now();
  // Calendar days to the full moon, in the place's own time zone (as Apple counts them).
  const fullIn = today ? Math.round((Date.parse(new Date(moon.nextFull.getTime() + offset).toISOString().slice(0, 10)) - Date.parse(today.date)) / 86_400_000) : moon.daysToFull;
  const next = times.rise && times.rise > nowMs ? (['Moonrise', local(times.rise)] as [string, string]) : times.set && times.set > nowMs ? (['Moonset', local(times.set)] as [string, string]) : (['Moonrise', times.rise ? local(times.rise) : 'Not today'] as [string, string]);
  out.push(
    opens(
      card(
        { icon: GLYPHS['clear-night'], label: moon.name },
        h(
          'div',
          { class: 'long-body' },
          rows(
            ['Illumination', `${Math.round(moon.illumination * 100)}%`],
            next,
            ['Next full moon', fullIn ? `${fullIn} day${fullIn > 1 ? 's' : ''}` : 'Tonight'],
          ),
          moonCanvas(moon.phase, moon.name),
        ),
      ),
      'conditions',
    ),
  );
  return out;
}

/** The degrees between two temperatures in the chosen unit, signed. */
const degreesApart = (aF: number, bF: number, s: AppState) => Math.round((aF - bF) * (s.tempUnit === 'C' ? 5 / 9 : 1));

/**
 * Apple's Averages, and yesterday (owner, 2026-10-29): today's high against the average high around
 * this date over the last ten years, and how it compares with yesterday's.
 */
function averagesTile(today: DailyPoint, normal: Normal, yesterday: Normal | null, s: AppState): HTMLElement {
  const d = degreesApart(today.hiF, normal.hiF, s);
  const t = (f: number) => formatTemp(f, s.tempUnit);
  return opens(
    tile(
      calendarIcon,
      'Averages',
      h('div', { class: 'tile-value' }, `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}°`),
      h('p', { class: 'tile-note avg-note' }, `${d === 0 ? 'same as' : d > 0 ? 'above' : 'below'} the ${NORMAL_YEARS}-year average high for the date`),
      h(
        'dl',
        { class: 'avg-rows' },
        h('dt', {}, 'Today'),
        h('dd', {}, `H:${t(today.hiF)}`),
        h('dt', {}, 'Average'),
        h('dd', {}, `H:${t(normal.hiF)}`),
        ...(yesterday ? [h('dt', {}, 'Yesterday'), h('dd', {}, `H:${t(yesterday.hiF)}`)] : []),
      ),
    ),
    'conditions',
  );
}

/** Pollen where it's forecast (Europe): the worst kind's level, then the others. */
function pollenTile(pollen: { name: string; grains: number }[]): HTMLElement {
  const [top, ...rest] = pollen;
  const others = rest.filter((p) => p.grains > 0);
  return tile(
    flowerIcon,
    'Pollen',
    h('div', { class: 'tile-value' }, pollenWord(top.grains)),
    h('div', { class: 'tile-sub' }, top.grains > 0 ? top.name : 'Little in the air'),
    h(
      'p',
      { class: 'tile-note' },
      [`${top.name} ${top.grains}`, ...others.map((p) => `${p.name} ${p.grains}`)].join(' · ') + ' grains/m³.',
    ),
  );
}

function tiles(
  c: Conditions,
  om: PointForecast,
  s: AppState,
  extra: { air: AirQuality | null | undefined; normal: Normal | null | undefined; outlooks: Outlooks | null | undefined },
): HTMLElement {
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

  const next12 = om.hourly.slice(0, 12);
  const cloudsNext12 = next12.reduce((sum, hr) => sum + hr.cloudCover, 0) / Math.max(1, next12.length);


  return h(
    'div',
    { class: 'tiles' },
    opens(tile(thermoIcon, 'Feels like', h('div', { class: 'tile-value' }, formatTemp(cur.feelsF, s.tempUnit)), h('p', { class: 'tile-note' }, feelsNote)), 'conditions', {
      feels: true,
    }),
    today && extra.normal ? averagesTile(today, extra.normal, extra.outlooks?.yesterday ?? null, s) : null,
    opens(tile(
      sunMark,
      'UV index',
      h('div', { class: 'tile-value' }, String(uv)),
      h('div', { class: 'tile-sub' }, uvWord(cur.uv)),
      uvBar,
      today ? h('p', { class: 'tile-note' }, `Max today: ${Math.round(today.uvMax)}`) : null,
    ), 'uv'),
    opens(tile(
      dropIcon,
      'Humidity',
      h('div', { class: 'tile-value' }, `${Math.round(cur.humidity)}%`),
      h('p', { class: 'tile-note' }, `The dew point is ${formatTemp(cur.dewF, s.tempUnit)} right now.`),
    ), 'humidity'),
    opens(tile(
      sunsetIcon,
      nextLabel,
      h('div', { class: 'tile-value' }, nextTime ? clockLabel(nextTime) : '--'),
      sunArc(set > rise ? (nowMin - rise) / (set - rise) : -1),
      otherTime ? h('p', { class: 'tile-note' }, `${otherLabel}: ${clockLabel(otherTime)}`) : null,
    ), 'uv'),
    opens(tile(eyeIcon, 'Visibility', h('div', { class: 'tile-value' }, visibilityText(cur.visibilityM, s)), h('p', { class: 'tile-note' }, visNote)), 'visibility'),
    opens(tile(gaugeIcon, 'Pressure', gauge(cur.pressureHpa, pressure.value, pressure.unit)), 'pressure'),
    opens(tile(
      umbrellaIcon,
      'Precipitation',
      h('div', { class: 'tile-value' }, amountText(rain24, s)),
      h('div', { class: 'tile-sub' }, 'Next 24 hours'),
      h('p', { class: 'tile-note' }, nextRain(om.minutely).sentence),
    ), 'precip'),
    opens(
      tile(
        cloudMark,
        'Cloud cover',
        h('div', { class: 'tile-value' }, `${Math.round(cur.cloudCover)}%`),
        h('div', { class: 'tile-sub' }, cloudWord(cur.cloudCover)),
        h('p', { class: 'tile-note' }, `${cloudWord(cloudsNext12)} for the next 12 hours.`),
      ),
      'clouds',
    ),
    extra.air?.pollen ? pollenTile(extra.air.pollen) : null,
  );
}

/**
 * Tides at the nearest NOAA station (owner, 2026-10-29), on the coast only: the next high and low, the
 * water now, and today's curve with a dot at now.
 */
function tidesCard(tides: Tides | null | undefined, om: PointForecast, s: AppState): HTMLElement | null {
  if (!tides) return null;
  const now = om.current.time;
  const ahead = tides.events.filter((e) => e.time > now);
  const nextHigh = ahead.find((e) => e.high);
  const nextLow = ahead.find((e) => !e.high);
  const level = tideAt(tides.events, now);
  const ft = (v: number) => (s.tempUnit === 'C' ? `${(v * 0.3048).toFixed(1)} m` : `${v.toFixed(1)} ft`);
  const when = (e: { time: string }) => `${e.time.slice(0, 10) === now.slice(0, 10) ? '' : 'Tomorrow '}${clockLabel(e.time)}`;
  const rising = ahead[0]?.high ?? false;
  return card(
    { icon: tideIcon, label: `Tides · ${tides.station}` },
    h(
      'div',
      { class: 'long-body' },
      rows(
        ...([
          level != null ? ['Now', `${ft(level)}, ${rising ? 'rising' : 'falling'}`] : null,
          nextHigh ? ['High tide', `${when(nextHigh)} · ${ft(nextHigh.ft)}`] : null,
          nextLow ? ['Low tide', `${when(nextLow)} · ${ft(nextLow.ft)}`] : null,
        ].filter((r): r is [string, string] => r != null)),
      ),
      tideCurve(tides, now),
    ),
  );
}

/** Today's tide, midnight to midnight, the highs and lows marked and a dot at now. */
function tideCurve(tides: Tides, now: string): SVGSVGElement {
  const W = 124;
  const H = 72;
  const day = now.slice(0, 10);
  const at = (m: number) => `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const levels = Array.from({ length: 49 }, (_, i) => tideAt(tides.events, at(Math.min(1439, i * 30))));
  const known = levels.filter((v): v is number => v != null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const x = (m: number) => (m / 1440) * W;
  const y = (v: number) => 8 + (1 - (v - lo) / Math.max(0.1, hi - lo)) * (H - 16);
  const svgEl = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz tide-viz', role: 'img', 'aria-label': 'Today’s tide' });
  const d = levels.map((v, i) => (v == null ? '' : `${i ? 'L' : 'M'}${x(i * 30).toFixed(1)} ${y(v).toFixed(1)}`)).join('');
  svgEl.append(el('path', { d: `${d}L${W} ${H}L0 ${H}Z`, class: 'tide-fill' }), el('path', { d, class: 'tide-line' }));
  for (const e of tides.events.filter((e) => e.time.slice(0, 10) === day)) {
    const m = Number(e.time.slice(11, 13)) * 60 + Number(e.time.slice(14, 16));
    svgEl.append(el('circle', { cx: x(m), cy: y(e.ft), r: 2, class: 'tide-mark' }));
  }
  const nowM = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));
  const v = tideAt(tides.events, now);
  if (v != null) svgEl.append(el('circle', { cx: x(nowM), cy: y(v), r: 4, class: 'tide-now' }));
  return svgEl;
}

/**
 * The forecast models side by side (owner, 2026-10-29: Windy's hallmark): the European, American, and
 * German models' highs and chances of rain for the ten days, so you can see where they agree.
 */
function modelsCard(outlooks: Outlooks | null | undefined, s: AppState): HTMLElement | null {
  if (!outlooks?.days.length) return null;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const head = h('tr', {}, h('th', {}), ...MODELS.map((m) => h('th', { scope: 'col', title: `${m.name} model` }, m.short)));
  const body = outlooks.days.map((d, i) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, i === 0 ? 'Today' : DOW[new Date(`${d.date}T12:00:00Z`).getUTCDay()]),
      ...d.models.map((m) =>
        h(
          'td',
          {},
          m ? h('span', { class: 'mdl-hi' }, formatTemp(m.hiF, s.tempUnit)) : '–',
          m && m.pop != null ? h('span', { class: 'mdl-pop' }, `${Math.round(m.pop)}%`) : null,
        ),
      ),
    ),
  );
  return card(
    { icon: modelsIcon, label: 'Forecast models' },
    h('p', { class: 'card-text mdl-note' }, 'Each model’s high and chance of rain. Where they agree, the forecast is surer.'),
    h('table', { class: 'mdl-table' }, h('thead', {}, head), h('tbody', {}, ...body)),
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
