import type { LatLon } from '../config';
import { alertColor } from '../data/alertColors';
import { weatherCodeText, type StopForecast } from '../data/openmeteo';
import { glyphFor } from '../data/outlook';
import { reverseName, searchPlaces, type Place } from '../data/photon';
import { RouteError, type RoutePoint } from '../data/route';
import { zoneOffsetS } from '../data/schedule';
import { deviceZone, planTrip, stopSpacing, type TripPlan, type TripStop } from '../data/trip';
import { worse, type Hazard, type HazardKind, type HazardSource, type Level } from '../data/tripHazards';
import type { AppState } from '../state';
import { formatTemp, formatWind } from '../util/units';
import { $, h, svg } from './dom';
import {
  boltMark,
  closeIcon,
  dropIcon,
  eyeIcon,
  GLYPHS,
  locateIcon,
  rainMark,
  thermoIcon,
  warningIcon,
  windIcon,
} from './icons';
import { segmented } from './layersMenu';
import { HOUSE, PIN } from './search';

const DEBOUNCE_MS = 280;
/** Place names are looked up a couple at a time (Photon is a shared, fair-use service). */
const NAME_CONCURRENCY = 2;
/** "Later" reaches a week out: forecasts beyond that aren't worth planning around. */
const MAX_DAYS_AHEAD = 7;
const narrow = () => matchMedia('(max-width: 699px)').matches;

const HAZARD_ICON: Record<HazardKind, string> = {
  alert: warningIcon,
  storms: boltMark,
  thunder: boltMark,
  flood: dropIcon,
  rain: rainMark,
  snow: GLYPHS.snow,
  ice: thermoIcon,
  fog: eyeIcon,
  wind: windIcon,
};

const SOURCE: Record<HazardSource, string> = {
  NWS: 'NWS alert',
  SPC: 'SPC outlook',
  WPC: 'WPC outlook',
  Forecast: 'Forecast',
};

const SOURCE_PLURAL: Record<HazardSource, string> = {
  NWS: 'NWS alerts',
  SPC: 'severe-storm outlooks',
  WPC: 'flood outlooks',
  Forecast: 'the forecast',
};

interface Choice {
  label: string;
  lat: number;
  lon: number;
  /** "My location": resolved to wherever you are when the trip is checked. */
  me?: boolean;
}

interface Item extends Choice {
  sub: string;
  kind: 'me' | Place['kind'];
}

/** "6 h 55 min". */
export function durationText(s: number): string {
  const total = Math.max(1, Math.round(s / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

const distanceText = (m: number, s: AppState) =>
  s.tempUnit === 'F' ? `${Math.round(m / 1609.344).toLocaleString()} mi` : `${Math.round(m / 1000).toLocaleString()} km`;

/**
 * "3:40 PM", or "Wed 8:00 AM" on another day, in the place's own time zone,
 * marked ("CDT") when its clock differs from this device's.
 */
export function clockText(ms: number, zone: string | null, now = Date.now()): string {
  const here = deviceZone();
  const tz = zone ?? here;
  const day = (x: number) => new Date(x).toLocaleDateString('en-CA', { timeZone: tz });
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: tz };
  if (day(ms) !== day(now)) opts.weekday = 'short';
  if (zoneOffsetS(tz, ms) !== zoneOffsetS(here, ms)) opts.timeZoneName = 'short';
  return new Date(ms).toLocaleString(undefined, opts);
}

/** A stop's time in its day's list: no weekday (the heading has it); the zone, if different, apart. */
function stopClock(ms: number, zone: string | null): HTMLElement {
  const here = deviceZone();
  const tz = zone ?? here;
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const abbr =
    zoneOffsetS(tz, ms) !== zoneOffsetS(here, ms)
      ? (new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')
          ?.value ?? '')
      : '';
  return h('span', { class: 'stop-time' }, time, abbr ? h('span', { class: 'stop-tz' }, abbr) : null);
}

const t = clockText;
const span = (from: number, to: number, zone: string | null) =>
  to - from < 10 * 60_000 ? `around ${t(from, zone)}` : `${t(from, zone)}–${t(to, zone)}`;
const short = (label: string) => label.split(',')[0];

/** Hours of driving a day (0: nonstop), and the hour each later day starts. */
const DAY_HOURS = [0, 8, 10, 12];
const START_HOURS = [7, 8, 9];
const TRIP_PREFS_KEY = 'weather-map:trip:v1';
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

function readTripPrefs(): { dayHours: number; startHour: number } {
  const fallback = { dayHours: 10, startHour: 8 };
  try {
    const p = JSON.parse(localStorage.getItem(TRIP_PREFS_KEY) ?? '{}') as Partial<typeof fallback>;
    return {
      dayHours: DAY_HOURS.includes(p.dayHours ?? -1) ? p.dayHours! : fallback.dayHours,
      startHour: START_HOURS.includes(p.startHour ?? -1) ? p.startHour! : fallback.startHour,
    };
  } catch {
    return fallback;
  }
}

function writeTripPrefs(p: { dayHours: number; startHour: number }): void {
  try {
    localStorage.setItem(TRIP_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
}

/** Minor things on the way, as one sentence: "Some rain and a chance of storms." */
export function lightWeather(hs: Pick<Hazard, 'kind' | 'title'>[]): string {
  const phrase = (hz: Pick<Hazard, 'kind' | 'title'>) =>
    hz.kind === 'thunder' ? 'a chance of storms' : hz.kind === 'flood' ? 'a low flash-flood risk' : hz.kind === 'rain' ? 'some rain' : hz.title.toLowerCase();
  const parts = [...new Set(hs.map(phrase))];
  const list = parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/** A datetime-local value (local time, minutes). */
function localInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A labeled place field with Photon suggestions (and "My location" when there is one). */
class PlaceField {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private items: Item[] = [];
  private active = -1;
  private timer = 0;
  private ctrl: AbortController | null = null;
  value: Choice | null = null;

  constructor(
    label: string,
    placeholder: string,
    private readonly near: () => LatLon,
    private readonly me: (() => LatLon | null) | null,
  ) {
    const id = `trip-${label.toLowerCase()}`;
    this.input = h('input', {
      id,
      class: 'trip-input',
      type: 'search',
      placeholder,
      autocomplete: 'off',
      enterkeyhint: 'next',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': `${id}-list`,
    });
    // Suggestions sit in the flow under the field (the panel scrolls; an overlay would be clipped).
    this.list = h('ul', { id: `${id}-list`, class: 'trip-results', role: 'listbox', hidden: true });
    this.el = h(
      'div',
      { class: 'trip-place' },
      h('div', { class: 'trip-field' }, h('label', { class: 'trip-field-label', for: id }, label), this.input),
      this.list,
    );

    this.input.addEventListener('input', () => {
      this.value = null;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.run(), DEBOUNCE_MS);
    });
    this.input.addEventListener('focus', () => {
      this.input.select();
      if (!this.input.value.trim() || this.value?.me) this.offerMe();
      else if (this.items.length) this.show(true);
    });
    this.input.addEventListener('blur', () => this.show(false));
    this.input.addEventListener('keydown', (e) => this.key(e));
  }

  set(choice: Choice | null): void {
    this.value = choice;
    this.input.value = choice?.label ?? '';
  }

  private meItem(): Item | null {
    const p = this.me?.();
    return p ? { label: 'My location', sub: 'Where you are now', lat: p.lat, lon: p.lon, me: true, kind: 'me' } : null;
  }

  private offerMe(): void {
    const me = this.meItem();
    this.items = me ? [me] : [];
    this.active = me ? 0 : -1;
    if (me) this.render(null);
  }

  private async run(): Promise<void> {
    const q = this.input.value.trim();
    this.ctrl?.abort();
    if (q.length < 2) {
      this.offerMe();
      if (!this.items.length) this.show(false);
      return;
    }
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const found = await searchPlaces(q, this.near(), ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.items = found.map((p) => ({
        label: p.subtitle ? `${p.title}, ${p.subtitle}` : p.title,
        sub: p.subtitle,
        lat: p.lat,
        lon: p.lon,
        kind: p.kind,
      }));
      this.active = this.items.length ? 0 : -1;
      this.render(this.items.length ? null : 'No matches');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.items = [];
      this.render('Search is unavailable right now');
    }
  }

  private render(empty: string | null): void {
    this.list.replaceChildren(
      ...(empty
        ? [h('li', { class: 'result-empty' }, empty)]
        : this.items.map((it, i) => {
            const btn = h(
              'button',
              { type: 'button', class: 'result', role: 'option', 'aria-selected': String(i === this.active) },
              h('span', { class: 'result-mark' }, svg(it.kind === 'me' ? locateIcon : it.kind === 'address' ? HOUSE : PIN)),
              h(
                'span',
                {},
                h('span', { class: 'result-title' }, it.kind === 'me' ? it.label : short(it.label)),
                it.sub ? h('span', { class: 'result-sub' }, it.sub) : null,
              ),
            );
            // pointerdown, not click: picks before the field loses focus on touch.
            btn.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              this.pick(it);
            });
            return h('li', {}, btn);
          })),
    );
    this.show(true);
  }

  private show(on: boolean): void {
    this.list.hidden = !on;
    this.input.setAttribute('aria-expanded', String(on));
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.show(false);
      return;
    }
    if (e.key === 'Enter') {
      const it = this.items[Math.max(0, this.active)];
      if (!this.value && it && !this.list.hidden) {
        e.preventDefault();
        this.pick(it);
      }
      return;
    }
    if (!this.items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const n = this.items.length;
    this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    this.list.querySelectorAll('.result').forEach((el, i) => el.setAttribute('aria-selected', String(i === this.active)));
    this.show(true);
  }

  private pick(it: Item): void {
    this.set({ label: it.label, lat: it.lat, lon: it.lon, me: it.me });
    this.show(false);
    this.input.dispatchEvent(new CustomEvent('pick', { bubbles: true }));
  }
}

export interface TripHooks {
  /** Where you are, if location is on. */
  myLocation(): LatLon | null;
  /** Bias for suggestions. */
  near(): LatLon;
  state(): AppState;
  /** Draw (or clear) a plan on the map. */
  show(plan: TripPlan | null): void;
  /** A stop or hazard was tapped: show that spot, at the time you'll be there. */
  focus(point: RoutePoint): void;
  /** Opened, closed, folded, or unfolded. */
  layout(open: boolean, folded: boolean): void;
}

/**
 * Trip weather: pick a start and a destination, and see what the drive runs
 * into at the time you'll actually be at each spot. Phones: a bottom panel
 * that folds into a summary under the search bar. Wide screens: a left column.
 */
export class TripPanel {
  private readonly root = $('#trip');
  private readonly body = $('#trip-body');
  private readonly sum = $('#trip-sum');
  private readonly foldBtn = $<HTMLButtonElement>('#trip-fold');
  private readonly from: PlaceField;
  private readonly to: PlaceField;
  private readonly when = h('input', { type: 'datetime-local', class: 'trip-when', 'aria-label': 'Leave at' });
  private readonly whenRow = h('div', { class: 'trip-when-row', hidden: true }, this.when);
  private readonly startRow: HTMLElement;
  private readonly go = h('button', { type: 'submit', class: 'trip-go' }, 'Check the drive');
  private readonly form: HTMLFormElement;
  private readonly head = h('div', { class: 'trip-route' });
  private readonly status = h('p', { class: 'trip-status', role: 'status', hidden: true });
  private readonly results = h('div', { class: 'trip-out' });
  private leave: 'now' | 'later' = 'now';
  private prefs = readTripPrefs();
  private plan: TripPlan | null = null;
  private labels = { from: '', to: '' };
  private names = new Map<number, string>();
  private nameRun = 0;
  private editing = true;
  private folded = false;
  private ctrl: AbortController | null = null;
  private redraw = 0;

  constructor(private readonly hooks: TripHooks) {
    this.from = new PlaceField('From', 'Starting point', hooks.near, hooks.myLocation);
    this.to = new PlaceField('To', 'Where to?', hooks.near, null);
    const leave = segmented(
      'Leave',
      [
        { value: 'now', label: 'Now' },
        { value: 'later', label: 'Later' },
      ],
      'now',
      (v) => {
        this.leave = v;
        this.whenRow.hidden = v === 'now';
        if (v === 'later') this.limitWhen();
      },
    );
    const perDay = segmented(
      'Driving each day',
      DAY_HOURS.map((n) => ({ value: String(n), label: n ? `${n} h` : 'Nonstop' })),
      String(this.prefs.dayHours),
      (v) => this.setPrefs({ dayHours: Number(v) }),
    );
    const mornings = segmented(
      'Start each day at',
      START_HOURS.map((n) => ({ value: String(n), label: hourLabel(n) })),
      String(this.prefs.startHour),
      (v) => this.setPrefs({ startHour: Number(v) }),
    );
    perDay.classList.add('seg-compact');
    mornings.classList.add('seg-compact');
    this.startRow = h('div', { class: 'trip-leave', hidden: !this.prefs.dayHours }, h('span', { class: 'trip-field-label' }, 'Mornings'), mornings);
    this.form = h(
      'form',
      { class: 'trip-form', novalidate: true },
      h('div', { class: 'group trip-fields' }, this.from.el, this.to.el),
      h('div', { class: 'trip-leave' }, h('span', { class: 'trip-field-label' }, 'Leave'), leave),
      this.whenRow,
      h('div', { class: 'trip-leave' }, h('span', { class: 'trip-field-label' }, 'Each day'), perDay),
      this.startRow,
      this.go,
    );
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.run();
    });
    // Picking From moves on to To; picking To checks the drive.
    this.from.input.addEventListener('pick', () => {
      if (this.to.value) void this.run();
      else this.to.input.focus();
    });
    this.to.input.addEventListener('pick', () => {
      if (this.from.value) void this.run();
      else this.from.input.focus();
    });

    this.body.append(this.form, this.head, this.status, this.results);
    $('#trip-close').append(svg(closeIcon));
    $('#trip-close').addEventListener('click', () => this.close());
    this.foldBtn.addEventListener('click', () => this.setFolded(!this.folded));
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    if (!this.from.value && this.hooks.myLocation()) this.from.set({ label: 'My location', lat: 0, lon: 0, me: true });
    this.setFolded(false);
    if (this.plan) this.hooks.show(this.plan);
    else requestAnimationFrame(() => (this.from.value ? this.to : this.from).input.focus());
  }

  close(): void {
    this.ctrl?.abort();
    this.root.hidden = true;
    this.hooks.show(null);
    this.hooks.layout(false, false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Re-render for new units or theme. */
  refresh(): void {
    this.render();
  }

  private setPrefs(patch: Partial<{ dayHours: number; startHour: number }>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.startRow.hidden = !this.prefs.dayHours;
    writeTripPrefs(this.prefs);
  }

  private setFolded(folded: boolean): void {
    this.folded = folded;
    this.root.classList.toggle('folded', folded);
    this.foldBtn.setAttribute('aria-expanded', String(!folded));
    this.hooks.layout(this.isOpen, folded);
  }

  private limitWhen(): void {
    const now = Date.now();
    this.when.min = localInput(now);
    this.when.max = localInput(now + MAX_DAYS_AHEAD * 86_400_000);
    if (!this.when.value) this.when.value = localInput(Math.ceil(now / 3_600_000) * 3_600_000);
  }

  private say(text: string | null): void {
    this.status.hidden = !text;
    this.status.textContent = text ?? '';
  }

  private async run(): Promise<void> {
    const from = this.from.value;
    const to = this.to.value;
    if (!from) {
      this.say('Choose where you’re starting from.');
      this.from.input.focus();
      return;
    }
    if (!to) {
      this.say('Choose where you’re going.');
      this.to.input.focus();
      return;
    }
    let depart = Date.now();
    if (this.leave === 'later') {
      const at = new Date(this.when.value).getTime();
      if (!Number.isFinite(at)) {
        this.say('Pick a time to leave.');
        return;
      }
      depart = Math.max(depart, at);
    }
    const start = from.me ? this.hooks.myLocation() : from;
    if (!start) {
      this.say('Your location isn’t available. Search for a starting point instead.');
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.go.disabled = true;
    this.say('Checking the route and the weather along it…');
    try {
      const opts = { maxDriveH: this.prefs.dayHours || null, startHour: this.prefs.startHour };
      const plan = await planTrip(start, to, depart, opts, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.plan = plan;
      this.labels = { from: from.label, to: to.label };
      this.names = new Map();
      this.editing = false;
      this.say(null);
      this.render();
      this.body.scrollTop = 0;
      this.hooks.show(plan);
      void this.loadNames(plan);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.say(e instanceof RouteError ? e.message : 'Couldn’t check that drive. Check your connection and try again.');
    } finally {
      if (this.ctrl === ctrl) this.go.disabled = false;
    }
  }

  /**
   * Stops listed: hourly within each day (every forecast stop on long
   * drives), every night, the ends, and any stop with weather to flag.
   */
  private shown(plan: TripPlan): number[] {
    const every = stopSpacing(plan.route.duration) === 30 ? 2 : 1;
    const last = plan.stops.length - 1;
    const out: number[] = [];
    let day = -1;
    let j = 0;
    plan.stops.forEach((s, i) => {
      if (s.day !== day) {
        day = s.day;
        j = 0;
      }
      if (j % every === 0 || i === 0 || i === last || s.night || s.level) out.push(i);
      j++;
    });
    return out;
  }

  private async loadNames(plan: TripPlan): Promise<void> {
    const run = ++this.nameRun;
    // Where you'll sleep matters most: name the nights first.
    const queue = this.shown(plan)
      .filter((i) => i > 0 && i < plan.stops.length - 1)
      .sort((a, b) => Number(!!plan.stops[b].night) - Number(!!plan.stops[a].night));
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        if (run !== this.nameRun) return;
        const s = plan.stops[i];
        const name = await reverseName(s.lat, s.lon).catch(() => null);
        if (run !== this.nameRun) return;
        if (name) {
          this.names.set(i, name);
          this.scheduleRender();
        }
      }
    };
    await Promise.all(Array.from({ length: NAME_CONCURRENCY }, worker));
  }

  private scheduleRender(): void {
    if (this.redraw) return;
    this.redraw = requestAnimationFrame(() => {
      this.redraw = 0;
      this.renderResults();
    });
  }

  private nameOf(i: number): string {
    const p = this.plan!;
    if (i === 0) return short(this.labels.from);
    if (i === p.stops.length - 1) return short(this.labels.to);
    // Until (or unless) a town name comes back: how far along it is.
    const m = p.stops[i].m;
    return this.names.get(i) ?? (this.hooks.state().tempUnit === 'F' ? `Mile ${Math.round(m / 1609.344)}` : `Km ${Math.round(m / 1000)}`);
  }

  /** The stop nearest a point on the route, optionally only among named ones. */
  private nearest(pt: RoutePoint, named: boolean): number {
    const p = this.plan!;
    const last = p.stops.length - 1;
    let best = -1;
    for (const i of this.shown(p)) {
      if (named && i !== 0 && i !== last && !this.names.has(i)) continue;
      if (best < 0 || Math.abs(p.stops[i].m - pt.m) < Math.abs(p.stops[best].m - pt.m)) best = i;
    }
    return best;
  }

  private near(pt: RoutePoint): string {
    const i = this.nearest(pt, true);
    return i < 0 ? 'On the way' : `Near ${short(this.nameOf(i))}`;
  }

  /** The time zone at a point on the route (its nearest stop's). */
  private zoneAt(pt: RoutePoint): string | null {
    const i = this.nearest(pt, false);
    return i < 0 ? null : this.plan!.stops[i].zone;
  }

  private render(): void {
    const s = this.hooks.state();
    const p = this.plan;
    this.form.hidden = !this.editing && !!p;
    this.head.hidden = this.editing || !p;
    if (p && !this.editing) {
      const later = p.depart - Date.now() > 5 * 60_000;
      const nights = p.schedule.days.length - 1;
      const first = p.stops[0];
      const end = p.stops[p.stops.length - 1];
      const edit = h('button', { type: 'button', class: 'trip-edit' }, 'Edit');
      edit.addEventListener('click', () => {
        this.editing = true;
        this.render();
        this.to.input.focus();
      });
      this.head.replaceChildren(
        h(
          'div',
          { class: 'trip-route-text' },
          h('p', { class: 'trip-route-title' }, `${short(this.labels.from)} → ${short(this.labels.to)}`),
          h(
            'p',
            { class: 'trip-route-sub' },
            [
              later ? `Leave ${t(p.depart, first.zone)}` : null,
              nights ? `${nights + 1} days, ${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
              `${durationText(p.route.duration)}${nights ? ' driving' : ''}`,
              distanceText(p.route.distance, s),
              `Arrive ${t(p.arrive, end.zone)}`,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
        edit,
      );
    }
    this.renderResults();
  }

  private wx(f: TripStop['forecast'], s: AppState, pop: boolean): HTMLElement | null {
    if (!f) return null;
    return h(
      'span',
      { class: 'stop-wx' },
      svg(GLYPHS[glyphFor(f.weatherCode, f.isDay)]),
      h('span', { class: 'stop-temp' }, Number.isFinite(f.tempF) ? formatTemp(f.tempF, s.tempUnit) : '--'),
      pop ? h('span', { class: 'stop-pop' }, f.precipProbability >= 20 ? `${Math.round(f.precipProbability)}%` : '') : null,
    );
  }

  private stopRow(i: number, s: AppState): HTMLElement {
    const st = this.plan!.stops[i];
    const night = st.night;
    const flags = night
      ? [
          st.flags.length ? `Evening: ${st.flags.map((f) => f.title).join(', ')}` : null,
          night.leaveFlags.length ? `Morning: ${night.leaveFlags.map((f) => f.title).join(', ')}` : null,
        ].filter(Boolean)
      : st.flags.map((f) => f.title);
    const leaveTime = night
      ? new Date(night.leave).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: st.zone ?? undefined })
      : '';
    const btn = h(
      'button',
      { type: 'button', class: `stop${night ? ' is-night' : ''}` },
      stopClock(st.at, st.zone),
      night
        ? h('span', { class: 'stop-moon' }, svg(GLYPHS['clear-night']))
        : h('span', { class: `stop-dot${st.level ? ` level-${st.level}` : ''}` }),
      h(
        'span',
        { class: 'stop-main' },
        night ? h('span', { class: 'stop-kicker' }, `Night ${night.n}`) : null,
        h('span', { class: 'stop-place' }, this.nameOf(i)),
        // The night's own line: tonight's weather, then tomorrow morning's as you leave.
        night
          ? h(
              'span',
              { class: 'stop-overnight' },
              this.wx(st.forecast, s, false),
              h('span', { class: 'stop-arrow' }, '→'),
              this.wx(night.leaveForecast, s, false),
              h('span', { class: 'stop-leave' }, `Leave ${leaveTime}`),
            )
          : null,
        flags.length ? h('span', { class: `stop-flags level-${st.level}` }, flags.join(' · ')) : null,
      ),
      night ? null : this.wx(st.forecast, s, true),
    );
    btn.addEventListener('click', () => this.focus(st));
    return h('li', {}, btn);
  }

  /** Where stop `i` is (null: no plan, or no such stop). */
  stopPoint(i: number): LatLon | null {
    const st = this.plan?.stops[i];
    return st ? { lat: st.lat, lon: st.lon } : null;
  }

  /**
   * The card for a stop's dot on the map: where it is, when you'll be there, the forecast for that
   * hour, and any watches or warnings over it then (each in its NWS color).
   */
  stopCard(i: number): HTMLElement | null {
    const p = this.plan;
    const st = p?.stops[i];
    if (!p || !st) return null;
    const s = this.hooks.state();
    const night = st.night;
    const zone = st.zone;
    const ahead = st.at - Date.now();
    const when = [
      i === 0 ? `Leave ${t(st.at, zone)}` : `Arrive ${t(st.at, zone)}`,
      night ? `Leave ${t(night.leave, zone)}` : null,
      ahead > 60_000 ? `in ${durationText(ahead / 1000)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const wx = (f: StopForecast | null, label: string | null) =>
      f
        ? h(
            'div',
            { class: 'tip-wx' },
            label ? h('span', { class: 'tip-wx-label' }, label) : null,
            svg(GLYPHS[glyphFor(f.weatherCode, f.isDay)]),
            h('span', { class: 'tip-temp' }, Number.isFinite(f.tempF) ? formatTemp(f.tempF, s.tempUnit) : '--'),
            h(
              'span',
              { class: 'tip-cond' },
              [
                weatherCodeText(f.weatherCode),
                f.precipProbability >= 20 ? `${Math.round(f.precipProbability)}% rain` : null,
                f.gustMph >= 25 ? `gusts ${formatWind(f.gustMph, s.windUnit)}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          )
        : h('p', { class: 'tip-note' }, 'Forecast unavailable');

    // Flags worth a second line (plain rain already reads in the condition).
    const flags = [...new Map([...st.flags, ...(night?.leaveFlags ?? [])].filter((f) => f.level !== 'info').map((f) => [f.title, f])).values()];
    const worst = flags.reduce<Level | null>((l, f) => worse(l, f.level), null);

    const alerts = st.alerts;
    const alertList =
      alerts == null
        ? h('p', { class: 'tip-note' }, 'Alerts couldn’t be checked')
        : alerts.length
          ? h(
              'ul',
              { class: 'tip-alerts' },
              ...alerts.map((a) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'tip-swatch', style: `background:${alertColor(a.phenom, a.sig)}` }),
                  h('span', { class: 'tip-alert-name' }, a.title),
                  h(
                    'span',
                    { class: 'tip-alert-when' },
                    a.on && a.on > st.at ? `from ${t(a.on, zone)}` : a.off ? `until ${t(a.off, zone)}` : 'in effect',
                  ),
                ),
              ),
            )
          : h('p', { class: 'tip-note' }, night ? 'No watches or warnings overnight' : 'No watches or warnings then');

    return h(
      'div',
      { class: 'tip-body' },
      night ? h('p', { class: 'tip-kicker' }, `Night ${night.n}`) : null,
      h('p', { class: 'tip-place' }, this.nameOf(i)),
      h('p', { class: 'tip-when' }, when),
      wx(st.forecast, night ? 'Tonight' : null),
      night ? wx(night.leaveForecast, 'Morning') : null,
      flags.length ? h('p', { class: `tip-flags level-${worst}` }, flags.map((f) => f.title).join(' · ')) : null,
      alertList,
    );
  }

  private hazardDetail(hz: Hazard, zone: string | null): string {
    let detail = hz.detail;
    if (hz.source === 'NWS' && hz.active) {
      detail = hz.on && hz.on > hz.from ? `Starts ${t(hz.on, zone)}` : hz.off ? `Until ${t(hz.off, zone)}` : '';
    }
    return [detail, SOURCE[hz.source]].filter(Boolean).join(' · ');
  }

  private renderResults(): void {
    const p = this.plan;
    if (!p || this.editing) {
      this.results.replaceChildren();
      this.sum.textContent = '';
      return;
    }
    const s = this.hooks.state();
    const active = p.hazards.filter((hz) => hz.active);
    const past = p.hazards.filter((hz) => !hz.active);
    const watch = active.filter((hz) => hz.level !== 'info');
    const worst = watch.reduce<Level | null>((l, hz) => worse(l, hz.level), null);
    const nights = p.schedule.days.length - 1;

    const verdict = watch.length
      ? `${watch.length} ${watch.length === 1 ? 'thing' : 'things'} to watch`
      : active.length
        ? 'Mostly clear'
        : 'Clear all the way';
    const verdictSub = watch.length
      ? 'At the times you’ll be there.'
      : active.length
        ? lightWeather(active)
        : 'No alerts, outlooks, or rough weather expected along the way.';
    this.sum.textContent = [
      short(this.labels.to),
      nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null,
      watch.length ? `${watch.length} to watch` : 'clear',
    ]
      .filter(Boolean)
      .join(' · ');

    const hazardItem = (hz: Hazard) => {
      const zone = this.zoneAt(hz.where);
      const btn = h(
        'button',
        { type: 'button', class: `hz level-${hz.level}${hz.active ? '' : ' is-past'}` },
        h('span', { class: 'hz-mark' }, svg(HAZARD_ICON[hz.kind])),
        h(
          'span',
          { class: 'hz-text' },
          h('span', { class: 'hz-title' }, hz.title),
          h('span', { class: 'hz-when' }, `${this.near(hz.where)} · ${span(hz.from, hz.to, zone)}`),
          h('span', { class: 'hz-detail' }, this.hazardDetail(hz, zone)),
        ),
      );
      btn.addEventListener('click', () => this.focus(hz.where));
      return h('li', {}, btn);
    };

    // One list per driving day (a single "Along the way" list for a one-day drive).
    const byDay = new Map<number, HTMLElement[]>();
    for (const i of this.shown(p)) {
      const d = p.stops[i].day;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(this.stopRow(i, s));
    }
    const dayLists = [...byDay].flatMap(([d, rows]) => {
      const first = p.stops.find((st) => st.day === d)!;
      const leave = p.schedule.days[d].leave;
      const date = new Date(leave).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: first.zone ?? undefined });
      return [
        h('p', { class: 'group-label' }, nights ? `Day ${d + 1} · ${date}` : 'Along the way'),
        h('ol', { class: 'group trip-stops' }, ...rows),
      ];
    });

    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        { class: `trip-verdict${worst ? ` level-${worst}` : ''}` },
        h('span', { class: 'trip-verdict-mark' }, svg(watch.length ? warningIcon : GLYPHS['clear-day'])),
        h('span', {}, h('span', { class: 'trip-verdict-title' }, verdict), h('span', { class: 'trip-verdict-sub' }, verdictSub)),
      ),
      active.length ? h('ul', { class: 'trip-hazards' }, ...active.map(hazardItem)) : null,
      past.length ? h('p', { class: 'group-label' }, 'On the route, but not while you’re there') : null,
      past.length ? h('ul', { class: 'trip-hazards' }, ...past.map(hazardItem)) : null,
      p.failed.length
        ? h('p', { class: 'pop-note' }, `Couldn’t check ${p.failed.map((f) => SOURCE_PLURAL[f]).join(' or ')} just now.`)
        : null,
      ...dayLists,
      h(
        'p',
        { class: 'pop-note' },
        nights
          ? `Drive times are typical speeds with no breaks; nights fall where ${this.prefs.dayHours} hours of driving runs out, and each morning starts at ${hourLabel(this.prefs.startHour)} local time. Weather is the forecast for when you’ll be at each spot; tap one to see it on the map, with forecast radar when it’s within reach.`
          : 'Drive times are typical speeds with no breaks. Weather is the forecast for when you’ll be at each spot; tap one to see it on the map, with forecast radar when it’s within reach.',
      ),
    ];
    this.results.replaceChildren(...parts.filter((n): n is HTMLElement => !!n));
  }

  private focus(pt: RoutePoint): void {
    // On a phone, fold the panel so the map (and the radar at that hour) is visible.
    if (narrow()) this.setFolded(true);
    this.hooks.focus(pt);
  }
}
