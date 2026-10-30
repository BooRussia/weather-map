import { TrafficLayer } from '../map/trafficLayer';
import { windLabel } from '../util/units';
import { canNotify } from '../util/notify';
import { WEATHER_MAPS, type WeatherMapId } from '../maps/catalog';
import type { AppState, Store } from '../state';
import { $, h, svg } from './dom';
import type { ShortcutId } from './barShortcuts';
import { advisoryMark, airspaceMark, alertMark, boltMark, chevronIcon, closeIcon, cloudMark, fireMark, gaugeMark, hurricaneMark, layersIcon, outlookMark, pirepMark, planeMark, rainMark, stormTrackMark, tackIcon, windIcon } from './icons';
import { mapThumb } from './mapThumbs';
import { canSupport, supportRow } from './support';

/** Where everything on the map comes from (the credits line under the map names them too). */
const DATA_NOTE =
  'Places, observations, forecasts, and alerts: NWS. Radar: NOAA MRMS (now and the last 2 hours), NEXRAD history and the HRRR ' +
  'forecast (with its snow, mix, and ice) via Iowa Environmental Mesonet; rain beyond radar range from NOAA NESDIS’s satellite ' +
  'Hydro-Estimator via SSEC RealEarth (UW–Madison). Lightning: the GOES lightning mapper via SSEC RealEarth, about a minute ' +
  'behind (the bolts’ timing is for show). Satellite clouds: NOAA GOES East and West and the NESDIS global mosaic via nowCOAST. ' +
  'Wind: Environment and Climate Change Canada (GeoMet, GDPS model). Weather maps: Environment and Climate Change Canada ' +
  '(GeoMet: GDPS, GDWPS, GIOPS models), NASA GIBS (GOES infrared), and Open-Meteo (CC BY 4.0), which also gives falling rain ' +
  'and point forecasts. Hurricanes: NHC. Search: Photon (OpenStreetMap). Satellite imagery: Esri, Vantor, Earthstar ' +
  'Geographics, and the GIS User Community. Map © CARTO © OpenStreetMap contributors (Standard in Carto’s Voyager ' +
  'colors). State and county lines: U.S. Census Bureau via the us-atlas package. Traffic © TomTom. ' +
  'The moon: NASA’s Scientific Visualization Studio (CGI Moon Kit, LRO camera). Air quality: Open-Meteo (CAMS).';

/** The privacy policy (public/privacy.html), where the App Store listing points too. */
const PRIVACY_URL = 'https://boorussia.github.io/weather-map/privacy.html';

type LayerKey = keyof AppState['layers'];

interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** iOS segmented control. */
export function segmented<T extends string>(label: string, options: SegOption<T>[], current: T, onChange: (v: T) => void): HTMLElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === current) }, o.label);
    b.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(o.value);
    });
    group.append(b);
  }
  return group;
}

/** A list row with an iOS switch; the whole row toggles it. */
export function switchRow(opts: {
  label: string;
  sub?: string;
  mark?: string;
  markClass?: string;
  /** Something between the label and the switch (a pin). */
  extra?: HTMLElement | null;
  checked: boolean;
  onChange: (on: boolean) => void;
}): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': opts.label });
  input.checked = opts.checked;
  input.addEventListener('change', () => opts.onChange(input.checked));
  return h(
    'label',
    { class: 'row' },
    opts.mark ? h('span', { class: `row-mark ${opts.markClass ?? ''}` }, svg(opts.mark)) : null,
    h('span', { class: 'row-label' }, opts.label, opts.sub ? h('span', { class: 'row-sub' }, opts.sub) : null),
    opts.extra ?? null,
    input,
  );
}

/**
 * The credits for what's on the map now, with their links: the list that used to run along the bottom
 * of the screen (owner, 2026-10-23: it belongs here, not in the way).
 */
function creditsNow(): HTMLElement | null {
  const live = document.querySelector('.credits');
  if (!live) return null;
  const copy = live.cloneNode(true) as HTMLElement;
  copy.removeAttribute('class');
  return h('p', { class: 'credits-now' }, h('strong', {}, 'On the map now: '), ...copy.childNodes);
}

/** Traffic needs a TomTom key; without one the switch says so and can't be turned on. */
function trafficSwitch(s: AppState, set: (on: boolean) => void): HTMLElement {
  const row = switchRow({
    label: 'Traffic',
    sub: TrafficLayer.available ? 'Live speeds: freeways zoomed out, every road up close' : 'Needs a free TomTom key (VITE_TOMTOM_KEY)',
    checked: s.traffic && TrafficLayer.available,
    onChange: set,
  });
  if (!TrafficLayer.available) row.querySelector('input')!.disabled = true;
  return row;
}

export function segRow(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), control);
}

/**
 * The layers drawer, on the right like Windy's menu, in three tabs with one home for each kind of thing
 * (owner, 2026-10-24: colors and styles were in all three, and it felt scattered). Weather: the
 * switches for the weather drawn over the map, each with its own options folded under it. Map: what's
 * underneath, the base map with its lines and traffic, and the weather map that colors it (one at a
 * time, picked from thumbnails). Settings: every look in one place (the app's and the radar's), units,
 * sound, and where the data comes from.
 */
export class LayersMenu {
  private readonly el = $('#layers-menu');
  private readonly btn = $('#layers-btn');
  /** Hurricanes' options list is open (kept while the menu re-renders). */
  private tropicsOpen = false;
  /** Storm outlook's options are open. */
  private outlookOpen = false;
  /** The data sources note is open. */
  private dataOpen = false;
  private cellsOpen = false;
  /** Radar's options are open. */
  private radarOpen = false;
  /** Which part of the drawer shows (owner, 2026-10-23: one long list had too much going on). */
  private tab: 'weather' | 'map' | 'settings' = 'weather';
  /** The coffee cup steams the next time Settings is drawn: when the drawer opens, or the tab is picked. */
  private steam = false;

  constructor(
    private readonly store: Store,
    private readonly onLayer: (layer: LayerKey, on: boolean) => void,
    /** Weather maps that have data right now (others are left out of the picker). */
    private readonly mapAvailable: (id: WeatherMapId) => boolean = () => true,
    /** The weather switches pinned to the bar (barShortcuts.ts). */
    private readonly pins: { has(id: ShortcutId): boolean; toggle(id: ShortcutId): void } | null = null,
  ) {
    this.btn.append(svg(layersIcon));
    this.btn.addEventListener('click', () => this.toggle());
    // Alerts for my location turns itself back off when notifications are refused: show it.
    store.subscribe((s, prev) => {
      if (s.notify !== prev.notify && this.open) this.render();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.open && !t.closest('#layers-menu') && !t.closest('#layers-btn')) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) {
        this.toggle(false);
        this.btn.focus();
      }
    });
  }

  get open(): boolean {
    return this.el.classList.contains('open');
  }

  /** Slides in from the right; closed, it's inert (CSS hides it once the slide ends). */
  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    if (on) {
      this.steam = true;
      this.render();
    }
    this.el.classList.toggle('open', on);
    this.el.inert = !on;
    this.btn.setAttribute('aria-expanded', String(on));
    if (on) (this.el.querySelector('.sheet-close') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** Thumbnail tiles, one per weather map, plus None. */
  private mapTiles(): HTMLElement {
    const current = this.store.get().weatherMap;
    // Sparse maps get their thumbnails nudged toward the colored end so they read as what they are.
    const bias: Partial<Record<WeatherMapId, number>> = {
      wind: 0.32, gust: 0.4, rain: 0.34, rainTotal: 0.32, thunder: 0.4, humidity: 0.55, visibility: 0.22,
      waves: 0.3, swell: 0.28, currents: 0.3, sst: 0.6, aqi: 0.22, smoke: 0.3, snowDepth: 0.36, newSnow: 0.32, infrared: 0.6, aurora: 0.3,
    };
    const tile = (id: WeatherMapId, label: string, img: string) => {
      const b = h(
        'button',
        { type: 'button', class: 'map-tile', 'aria-pressed': String(id === current) },
        h('img', { src: img, alt: '', width: 120, height: 84, decoding: 'async' }),
        h('span', {}, label),
      );
      b.addEventListener('click', () => {
        this.store.set({ weatherMap: id });
        // On phones the drawer covers the map: close it to show the choice.
        if (window.matchMedia('(max-width: 699px)').matches) this.toggle(false);
        else this.render();
      });
      return b;
    };
    const maps = WEATHER_MAPS.filter((m) => this.mapAvailable(m.id));
    return h(
      'div',
      { class: 'map-tiles', role: 'group', 'aria-label': 'Weather map' },
      tile('none', 'None', mapThumb('none', null, 1)),
      ...maps.map((m, i) => tile(m.id, m.label, mapThumb(m.id, m.ramp, i + 7, bias[m.id] ?? 0.5))),
    );
  }

  /**
   * The thumbtack on a weather row (owner, 2026-10-26): pins that layer's switch to the bar, right of
   * the timeline, or takes it off. Lightning's is the bar's lightning-only button.
   */
  private pin(id: ShortcutId, label: string): HTMLElement | null {
    if (!this.pins) return null;
    const on = this.pins.has(id);
    const say = on ? `Take ${label} off the bar` : `Put ${label} on the bar`;
    const b = h('button', { type: 'button', class: 'row-pin', 'aria-pressed': String(on), 'aria-label': say, title: say }, svg(tackIcon));
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.pins!.toggle(id);
      this.render();
    });
    return b;
  }

  private layer(key: LayerKey, label: string, mark: string, markClass: string, sub?: string): HTMLElement {
    return switchRow({
      label,
      sub,
      mark,
      markClass,
      extra: this.pin(key as ShortcutId, key === 'thunder' ? 'Lightning only' : label),
      checked: this.store.get().layers[key],
      onChange: (on) => {
        this.store.set({ layers: { ...this.store.get().layers, [key]: on } });
        this.onLayer(key, on);
      },
    });
  }

  /**
   * Hurricanes: the layer switch, and a disclosure for what it shows (cone,
   * spaghetti, wind odds…), so people can look at just the parts they want.
   */
  private tropicsRows(): HTMLElement[] {
    const s = this.store.get();
    const t = s.tropics;
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': 'Hurricanes' });
    input.checked = s.layers.tropics;
    input.addEventListener('change', () => {
      this.store.set({ layers: { ...this.store.get().layers, tropics: input.checked } });
      this.onLayer('tropics', input.checked);
    });
    const more = h(
      'button',
      {
        type: 'button',
        id: 'tropics-more',
        class: 'row-more',
        'aria-expanded': String(this.tropicsOpen),
        'aria-controls': 'tropics-options',
        'aria-label': 'What hurricanes show',
      },
      svg(chevronIcon),
    );
    more.addEventListener('click', () => {
      this.tropicsOpen = !this.tropicsOpen;
      this.render();
      $('#tropics-more').focus();
    });
    const head = h(
      'div',
      { class: 'row' },
      h('span', { class: 'row-mark is-alert' }, svg(hurricaneMark)),
      h('span', { class: 'row-label' }, 'Hurricanes', h('span', { class: 'row-sub' }, 'NHC and models')),
      this.pin('tropics', 'the hurricane tracker'),
      more,
      input,
    );
    if (!this.tropicsOpen) return [head];

    const set = (patch: Partial<typeof t>) => this.store.set({ tropics: { ...this.store.get().tropics, ...patch } });
    const opt = (key: keyof typeof t, label: string, sub?: string) =>
      switchRow({ label, sub, checked: Boolean(t[key]), onChange: (on) => set({ [key]: on } as Partial<typeof t>) });
    const members = switchRow({
      label: 'Members',
      sub: '31 faint GFS ensemble tracks',
      checked: s.modelGroups.includes('member'),
      onChange: (on) => {
        const groups = this.store.get().modelGroups.filter((g) => g !== 'member');
        this.store.set({ modelGroups: on ? [...groups, 'member'] : groups });
      },
    });
    members.classList.add('is-nested');
    // Wind-speed odds thresholds, in the user's unit: 34, 50, 64 kt.
    const at = (kt: number, kmh: number, mph: number) => `${s.windUnit === 'kt' ? kt : s.windUnit === 'kmh' ? kmh : mph}+`;
    const odds = segmented<'0' | '34' | '50' | '64'>(
      'Wind-speed odds',
      [
        { value: '0', label: 'Off' },
        { value: '34', label: at(34, 63, 39) },
        { value: '50', label: at(50, 93, 58) },
        { value: '64', label: at(64, 119, 74) },
      ],
      String(t.windProb) as '0' | '34' | '50' | '64',
      (v) => set({ windProb: Number(v) as typeof t.windProb }),
    );
    odds.classList.add('seg-compact');
    const oddsRow = h(
      'div',
      { class: 'row row-stack' },
      h('span', { class: 'row-label' }, 'Wind-speed odds', h('span', { class: 'row-sub' }, `Chance of winds this strong (${windLabel(s.windUnit)}), 5 days`)),
      odds,
    );
    return [
      head,
      h(
        'div',
        { id: 'tropics-options', class: 'sub-options' },
        opt('cone', 'Forecast cone'),
        opt('track', 'Forecast track'),
        opt('models', 'Spaghetti models', 'Groups: tap a storm'),
        members,
        opt('past', 'Past track'),
        opt('warnings', 'Warnings', 'Coastal watches and warnings'),
        opt('windField', 'Wind field', 'Storm- and hurricane-force winds now'),
        oddsRow,
        opt('arrival', 'Wind arrival', 'When storm winds likely start'),
        opt('surge', 'Storm surge flooding', 'Blue up to 3 ft above ground, yellow 3+, orange 6+, red 9+ (when NHC issues it)'),
        opt('outlook', 'Possible storms', 'NHC’s 7-day outlook'),
        opt('sst', 'Sea temperature', '80 °F (26.5 °C) and warmer fuels storms'),
      ),
    ];
  }

  /** Radar: the switch, and a disclosure for what it shows besides rain (snow, mix, and ice; falling rain). */
  private radarRows(): HTMLElement[] {
    const s = this.store.get();
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': 'Radar' });
    input.checked = s.layers.rain;
    input.addEventListener('change', () => {
      this.store.set({ layers: { ...this.store.get().layers, rain: input.checked } });
      this.onLayer('rain', input.checked);
    });
    const more = h(
      'button',
      { type: 'button', id: 'radar-more', class: 'row-more', 'aria-expanded': String(this.radarOpen), 'aria-controls': 'radar-options', 'aria-label': 'Radar options' },
      svg(chevronIcon),
    );
    more.addEventListener('click', () => {
      this.radarOpen = !this.radarOpen;
      this.render();
      $('#radar-more').focus();
    });
    const extras = [s.precipType ? 'Snow, mix & ice' : null, s.rainStreaks ? 'Falling rain' : null].filter(Boolean).join(' · ');
    const head = h(
      'div',
      { class: 'row' },
      h('span', { class: 'row-mark is-precip' }, svg(rainMark)),
      h('span', { class: 'row-label' }, 'Radar', extras ? h('span', { class: 'row-sub' }, extras) : null),
      this.pin('rain', 'Radar'),
      more,
      input,
    );
    if (!this.radarOpen) return [head];
    return [
      head,
      h(
        'div',
        { id: 'radar-options', class: 'sub-options' },
        switchRow({
          label: 'Snow, mix & ice',
          sub: 'Radar colored by what’s falling',
          checked: s.precipType,
          onChange: (on) => {
            this.store.set({ precipType: on });
            this.render();
          },
        }),
        switchRow({
          label: 'Falling rain',
          sub: 'Streaks where it’s raining',
          checked: s.rainStreaks,
          onChange: (on) => {
            this.store.set({ rainStreaks: on });
            this.render();
          },
        }),
      ),
    ];
  }

  /** Storm tracks: the switch, and a disclosure with storm reports and what the colors mean. */
  private cellRows(): HTMLElement[] {
    const s = this.store.get();
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': 'Storm tracks' });
    input.checked = s.layers.cells;
    input.addEventListener('change', () => {
      this.store.set({ layers: { ...this.store.get().layers, cells: input.checked } });
      this.onLayer('cells', input.checked);
    });
    const more = h(
      'button',
      { type: 'button', id: 'cells-more', class: 'row-more', 'aria-expanded': String(this.cellsOpen), 'aria-controls': 'cells-options', 'aria-label': 'Storm track options' },
      svg(chevronIcon),
    );
    more.addEventListener('click', () => {
      this.cellsOpen = !this.cellsOpen;
      this.render();
      $('#cells-more').focus();
    });
    const head = h(
      'div',
      { class: 'row' },
      h('span', { class: 'row-mark is-precip' }, svg(stormTrackMark)),
      h('span', { class: 'row-label' }, 'Storm tracks', h('span', { class: 'row-sub' }, 'Strong storms and where they’re headed')),
      this.pin('cells', 'Storm tracks'),
      more,
      input,
    );
    if (!this.cellsOpen) return [head];
    return [
      head,
      h(
        'div',
        { id: 'cells-options', class: 'sub-options' },
        h(
          'div',
          { class: 'row cell-key' },
          h('span', { class: 'row-label' }, 'Colors', h('span', { class: 'row-sub' }, 'Red: tornado signature · orange: rotation · green: large hail · white: strong storm')),
        ),
        switchRow({
          label: 'Storm reports',
          sub: 'Tornado, hail, wind, and flood reports, past 24 h',
          checked: s.stormReports,
          onChange: (on) => this.store.set({ stormReports: on }),
        }),
      ),
    ];
  }

  /**
   * Storm outlook: the switch, and a disclosure for which outlook (SPC severe
   * storms or WPC flash flooding) and which day.
   */
  private outlookRows(): HTMLElement[] {
    const s = this.store.get();
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': 'Storm outlook' });
    input.checked = s.layers.outlook;
    input.addEventListener('change', () => {
      this.store.set({ layers: { ...this.store.get().layers, outlook: input.checked } });
      this.onLayer('outlook', input.checked);
    });
    const more = h(
      'button',
      { type: 'button', id: 'outlook-more', class: 'row-more', 'aria-expanded': String(this.outlookOpen), 'aria-controls': 'outlook-options', 'aria-label': 'Which outlook' },
      svg(chevronIcon),
    );
    more.addEventListener('click', () => {
      this.outlookOpen = !this.outlookOpen;
      this.render();
      $('#outlook-more').focus();
    });
    const kindLabel = s.outlookKind === 'severe' ? 'Severe storms' : 'Flash flooding';
    const dayLabel = ['Today', 'Tomorrow', 'Day 3'][s.outlookDay - 1];
    const head = h(
      'div',
      { class: 'row' },
      h('span', { class: 'row-mark is-bolt' }, svg(outlookMark)),
      h('span', { class: 'row-label' }, 'Storm outlook', h('span', { class: 'row-sub' }, `${kindLabel} · ${dayLabel}`)),
      this.pin('outlook', 'Storm outlook'),
      more,
      input,
    );
    if (!this.outlookOpen) return [head];
    const kind = segmented<'severe' | 'flood'>(
      'Outlook',
      [
        { value: 'severe', label: 'Severe' },
        { value: 'flood', label: 'Flooding' },
      ],
      s.outlookKind,
      (v) => {
        this.store.set({ outlookKind: v });
        this.render();
      },
    );
    const day = segmented<'1' | '2' | '3'>(
      'Day',
      [
        { value: '1', label: 'Today' },
        { value: '2', label: 'Tomorrow' },
        { value: '3', label: 'Day 3' },
      ],
      String(s.outlookDay) as '1' | '2' | '3',
      (v) => {
        this.store.set({ outlookDay: Number(v) as 1 | 2 | 3 });
        this.render();
      },
    );
    day.classList.add('seg-compact');
    return [
      head,
      h(
        'div',
        { id: 'outlook-options', class: 'sub-options' },
        h('div', { class: 'row row-stack' }, h('span', { class: 'row-label' }, 'Outlook', h('span', { class: 'row-sub' }, 'From NOAA’s Storm Prediction and Weather Prediction Centers')), kind),
        h('div', { class: 'row row-stack' }, h('span', { class: 'row-label' }, 'Day'), day),
      ),
    ];
  }

  /** Settings: every look in one place (the app's and the radar's), then units, sound, and the data. */
  private settingsTab(s: AppState): (HTMLElement | null)[] {
    const temp = segmented('Temperature', [{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }], s.tempUnit, (v) =>
      this.store.set({ tempUnit: v }),
    );
    const wind = segmented('Wind', [{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }, { value: 'kt', label: 'kt' }], s.windUnit, (v) =>
      this.store.set({ windUnit: v }),
    );
    temp.classList.add('seg-compact');
    wind.classList.add('seg-compact');
    const more = h(
      'button',
      { type: 'button', id: 'data-more', class: 'row-more', 'aria-expanded': String(this.dataOpen), 'aria-controls': 'data-note', 'aria-label': 'Where the data comes from' },
      svg(chevronIcon),
    );
    more.addEventListener('click', () => {
      this.dataOpen = !this.dataOpen;
      this.render();
      $('#data-more').focus();
    });
    const theme = segmented('App look', [{ value: 'liquid', label: 'Liquid' }, { value: 'classic', label: 'Classic' }], s.theme, (v) =>
      this.store.set({ theme: v }),
    );
    theme.classList.add('seg-compact');
    const radar = segmented('Radar colors', [{ value: 'color', label: 'Color' }, { value: 'mono', label: 'Mono' }], s.colorMode, (v) =>
      this.store.set({ colorMode: v }),
    );
    radar.classList.add('seg-compact');
    const strip = segmented<'daily' | 'hourly'>(
      'Banner forecast',
      [
        { value: 'daily', label: 'Daily' },
        { value: 'hourly', label: 'Hourly' },
      ],
      s.bannerForecast,
      (v) => this.store.set({ bannerForecast: v }),
    );
    strip.classList.add('seg-compact');
    const graphs = segmented<'today' | 'week'>(
      'Small banner graphs',
      [
        { value: 'today', label: 'Today' },
        { value: 'week', label: '10 days' },
      ],
      s.bannerGraphs,
      (v) => this.store.set({ bannerGraphs: v }),
    );
    graphs.classList.add('seg-compact');
    const small = segmented<'graphs' | 'forecast'>(
      'Small banner',
      [
        { value: 'graphs', label: 'Graphs' },
        { value: 'forecast', label: 'Forecast' },
      ],
      s.smallBanner,
      (v) => {
        this.store.set({ smallBanner: v });
        this.render();
      },
    );
    small.classList.add('seg-compact');
    const phone = document.body.classList.contains('phone');
    const steaming = this.steam;
    this.steam = false;
    return [
      // Buy the devs a coffee (owner, 2026-10-30): first, its cup steaming for a moment as Settings opens.
      canSupport ? h('div', { class: 'group' }, supportRow(steaming)) : null,
      h('p', { class: 'group-label' }, 'Look'),
      h('div', { class: 'group' }, segRow('App', theme), segRow('Radar colors', radar)),
      h('p', { class: 'group-label' }, 'General'),
      h(
        'div',
        { class: 'group' },
        h('div', { class: 'row row-units' }, h('span', { class: 'row-label' }, 'Units'), temp, wind),
        phone ? segRow('Banner forecast', strip) : null,
        // The small banner's row (a sideways swipe on it swaps them too), and which graphs.
        phone ? segRow('Small banner', small) : null,
        phone && s.smallBanner === 'graphs' ? segRow('Small banner graphs', graphs) : null,
        switchRow({ label: 'Thunder sound', checked: s.sound, onChange: (on) => this.store.set({ sound: on }) }),
        canNotify()
          ? switchRow({
              label: 'Alerts for my location',
              sub: 'New warnings and watches, and rain about to start, while the app is open',
              checked: s.notify,
              onChange: (on) => this.store.set({ notify: on }),
            })
          : null,
        h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Where the data comes from'), more),
        this.dataOpen ? h('div', { id: 'data-note', class: 'pop-note data-note' }, h('p', {}, DATA_NOTE), creditsNow()) : null,
        // The hosted page, opened outside the app (the iPhone app hands it to Safari).
        h('a', { class: 'row row-link', href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, h('span', { class: 'row-label' }, 'Privacy policy'), svg(chevronIcon)),
      ),
    ];
  }

  private render(): void {
    const s = this.store.get();
    // The list scrolls inside the panel, so the glass edge stays put; keep the place across re-renders.
    const scroll = this.el.querySelector('.popover-body')?.scrollTop ?? 0;
    const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close map layers' }, svg(closeIcon));
    close.addEventListener('click', () => {
      this.toggle(false);
      this.btn.focus();
    });
    const head = h('div', { class: 'drawer-head' }, h('p', { class: 'pop-title' }, 'Map layers'), close);
    const tabs = segmented(
      'Show',
      [
        { value: 'weather', label: 'Weather' },
        { value: 'map', label: 'Map' },
        { value: 'settings', label: 'Settings' },
      ],
      this.tab,
      (v) => {
        this.tab = v;
        this.steam = true;
        this.render();
        const b = this.el.querySelector('.popover-body');
        if (b) b.scrollTop = 0;
      },
    );
    tabs.classList.add('drawer-tabs');
    const body = h(
      'div',
      { class: 'popover-body' },
      ...(this.tab === 'weather' ? this.weatherTab(s) : this.tab === 'map' ? this.mapTab(s) : this.settingsTab(s)),
    );
    this.el.replaceChildren(head, tabs, body);
    body.scrollTop = scroll;
  }

  /** Weather: the switches for what's drawn over the map, live weather then storm hazards (hurricanes last, its options run long). */
  private weatherTab(s: AppState): HTMLElement[] {
    const rows: HTMLElement[] = [
      h('p', { class: 'group-label' }, 'Live'),
      h(
        'div',
        { class: 'group' },
        ...this.radarRows(),
        this.layer('clouds', 'Satellite clouds', cloudMark, '', 'Live GOES imagery · beta'),
        this.layer('thunder', 'Lightning', boltMark, 'is-bolt', 'Live from GOES satellite'),
        this.layer('wind', 'Wind', windIcon, ''),
      ),
      h('p', { class: 'group-label' }, 'Storms'),
      h(
        'div',
        { class: 'group' },
        ...this.cellRows(),
        switchRow({
          label: 'Alert areas',
          mark: alertMark,
          markClass: 'is-alert',
          extra: this.pin('alertAreas', 'Alert areas'),
          checked: s.alertAreas,
          onChange: (on) => this.store.set({ alertAreas: on }),
        }),
        ...this.outlookRows(),
        ...this.tropicsRows(),
      ),
      h('p', { class: 'group-label' }, 'Fire and flood'),
      h(
        'div',
        { class: 'group' },
        this.layer('fires', 'Wildfires', fireMark, 'is-fire', 'Burning now, with their edges'),
        this.layer('rivers', 'River flooding', gaugeMark, 'is-precip', 'River gauges by flood stage'),
      ),
      h('p', { class: 'group-label' }, 'Aviation'),
      h(
        'div',
        { class: 'group' },
        this.layer('airports', 'Airport weather', planeMark, 'is-blue', 'METARs and TAFs · VFR green, MVFR blue, IFR red, LIFR magenta'),
        this.layer('advisories', 'SIGMETs and G-AIRMETs', advisoryMark, 'is-blue', 'Icing cyan, turbulence orange, IFR purple, storms red'),
        this.layer('pireps', 'Pilot reports', pirepMark, 'is-blue', 'PIREPs · worst of turbulence and icing, urgent ringed red'),
        this.layer('airspace', 'TFRs and airspace', airspaceMark, 'is-blue', 'TFRs in red; Class B, C, D from zoom 7'),
        switchRow({
          label: 'Pilot cards',
          sub: 'On the weather page: winds aloft and a sounding; flyability for paragliders, hang gliders, and drones',
          mark: windIcon,
          markClass: 'is-blue',
          checked: s.pilotCards,
          onChange: (on) => this.store.set({ pilotCards: on }),
        }),
      ),
    ];
    if (this.pins) rows.push(h('p', { class: 'group-note' }, svg(tackIcon), 'Pin a layer to keep its switch on the bar, right of the timeline.'));
    return rows;
  }

  /**
   * Map: what's under the weather. The base map (its style, lines, traffic) first, short; then the
   * weather map that colors it, one at a time, the long grid last.
   */
  private mapTab(s: AppState): HTMLElement[] {
    return [
      h('p', { class: 'group-label' }, 'Base map'),
      h(
        'div',
        { class: 'group' },
        segRow(
          'Style',
          segmented(
            'Map style',
            [
              { value: 'satellite', label: 'Satellite' },
              { value: 'standard', label: 'Standard' },
              { value: 'dark', label: 'Dark' },
            ],
            s.basemap,
            (v) => this.store.set({ basemap: v }),
          ),
        ),
        switchRow({ label: 'State lines', checked: s.stateLines, onChange: (on) => this.store.set({ stateLines: on }) }),
        switchRow({
          label: 'County lines',
          sub: 'Show once you zoom in to about a state',
          checked: s.countyLines,
          onChange: (on) => this.store.set({ countyLines: on }),
        }),
        trafficSwitch(s, (on) => this.store.set({ traffic: on })),
      ),
      h('p', { class: 'group-label' }, 'Weather map'),
      this.mapTiles(),
    ];
  }
}
