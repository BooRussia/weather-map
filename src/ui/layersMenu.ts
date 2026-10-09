import { WEATHER_MAPS, type WeatherMapId } from '../maps/catalog';
import type { AppState, Store } from '../state';
import { $, h, svg } from './dom';
import { alertMark, boltMark, chevronIcon, closeIcon, cloudMark, gearIcon, hurricaneMark, layersIcon, rainMark, windIcon } from './icons';
import { mapThumb } from './mapThumbs';

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
    input,
  );
}

export function segRow(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), control);
}

/**
 * The layers drawer, on the right like Windy's menu: the weather map (one
 * colored variable at a time, picked from thumbnails), the switches for
 * what's drawn over it, the map style and radar options, and Settings.
 */
export class LayersMenu {
  private readonly el = $('#layers-menu');
  private readonly btn = $('#layers-btn');
  /** Hurricanes' options list is open (kept while the menu re-renders). */
  private tropicsOpen = false;
  /** Storm outlook's options are open. */
  private outlookOpen = false;
  private cellsOpen = false;

  constructor(
    private readonly store: Store,
    private readonly onSettings: () => void,
    private readonly onLayer: (layer: LayerKey, on: boolean) => void,
    /** Weather maps that have data right now (others are left out of the picker). */
    private readonly mapAvailable: (id: WeatherMapId) => boolean = () => true,
  ) {
    this.btn.append(svg(layersIcon));
    this.btn.addEventListener('click', () => this.toggle());
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
    if (on) this.render();
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
      waves: 0.3, swell: 0.28, currents: 0.3, sst: 0.6, aqi: 0.22, snowDepth: 0.36, newSnow: 0.32, infrared: 0.6,
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

  private layer(key: LayerKey, label: string, mark: string, markClass: string, sub?: string): HTMLElement {
    return switchRow({
      label,
      sub,
      mark,
      markClass,
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
    const kmh = s.windUnit === 'kmh';
    const odds = segmented<'0' | '34' | '50' | '64'>(
      'Wind-speed odds',
      [
        { value: '0', label: 'Off' },
        { value: '34', label: kmh ? '63+' : '39+' },
        { value: '50', label: kmh ? '93+' : '58+' },
        { value: '64', label: kmh ? '119+' : '74+' },
      ],
      String(t.windProb) as '0' | '34' | '50' | '64',
      (v) => set({ windProb: Number(v) as typeof t.windProb }),
    );
    odds.classList.add('seg-compact');
    const oddsRow = h(
      'div',
      { class: 'row row-stack' },
      h('span', { class: 'row-label' }, 'Wind-speed odds', h('span', { class: 'row-sub' }, `Chance of winds this strong (${kmh ? 'km/h' : 'mph'}), 5 days`)),
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
        opt('surge', 'Storm surge', 'When NHC issues a flooding map'),
        opt('outlook', 'Possible storms', 'NHC’s 7-day outlook'),
        opt('sst', 'Sea temperature', '80 °F (26.5 °C) and warmer fuels storms'),
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
      h('span', { class: 'row-mark is-precip' }, svg(rainMark)),
      h('span', { class: 'row-label' }, 'Storm tracks', h('span', { class: 'row-sub' }, 'Strong storms and where they’re headed')),
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
      h('span', { class: 'row-mark is-bolt' }, svg(boltMark)),
      h('span', { class: 'row-label' }, 'Storm outlook', h('span', { class: 'row-sub' }, `${kindLabel} · ${dayLabel}`)),
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

  private render(): void {
    const s = this.store.get();
    const settings = h(
      'button',
      { type: 'button', class: 'row' },
      h('span', { class: 'row-mark is-blue' }, svg(gearIcon)),
      h('span', { class: 'row-label' }, 'Units, sound & appearance'),
      svg(chevronIcon),
    );
    settings.addEventListener('click', () => {
      this.toggle(false);
      this.onSettings();
    });

    // The list scrolls inside the panel, so the glass edge stays put; keep the place across re-renders.
    const scroll = this.el.querySelector('.popover-body')?.scrollTop ?? 0;
    const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close map layers' }, svg(closeIcon));
    close.addEventListener('click', () => {
      this.toggle(false);
      this.btn.focus();
    });
    const head = h('div', { class: 'drawer-head' }, h('p', { class: 'pop-title' }, 'Map layers'), close);
    const body = h(
      'div',
      { class: 'popover-body' },
      // What's happening now, then the storm hazards; hurricanes last, since its options run long.
      h('p', { class: 'group-label' }, 'On the map'),
      h(
        'div',
        { class: 'group' },
        this.layer('rain', 'Radar', rainMark, 'is-precip'),
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
          checked: s.alertAreas,
          onChange: (on) => this.store.set({ alertAreas: on }),
        }),
        ...this.outlookRows(),
        ...this.tropicsRows(),
      ),
      h('p', { class: 'group-label' }, 'Weather map'),
      this.mapTiles(),
      h('p', { class: 'group-label' }, 'Map and radar'),
      h(
        'div',
        { class: 'group' },
        segRow(
          'Style',
          segmented('Map style', [{ value: 'satellite', label: 'Satellite' }, { value: 'dark', label: 'Dark' }], s.basemap, (v) =>
            this.store.set({ basemap: v }),
          ),
        ),
        segRow(
          'Radar colors',
          segmented('Radar colors', [{ value: 'color', label: 'Color' }, { value: 'mono', label: 'Mono' }], s.colorMode, (v) =>
            this.store.set({ colorMode: v }),
          ),
        ),
        switchRow({
          label: 'Snow, mix & ice',
          sub: 'Radar colored by what’s falling',
          checked: s.precipType,
          onChange: (on) => this.store.set({ precipType: on }),
        }),
        switchRow({ label: 'Falling rain', checked: s.rainStreaks, onChange: (on) => this.store.set({ rainStreaks: on }) }),
      ),
      h('div', { class: 'group' }, settings),
    );
    this.el.replaceChildren(head, body);
    body.scrollTop = scroll;
  }
}
