import type { AppState, Store } from '../state';
import { $, h, svg } from './dom';
import { alertMark, boltMark, chevronIcon, cloudMark, gearIcon, hurricaneMark, layersIcon, rainMark, windIcon } from './icons';

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
 * The layers popover (Apple Maps' "Choose Map"): map style, the layer
 * switches, radar options, and a way into Settings.
 */
export class LayersMenu {
  private readonly el = $('#layers-menu');
  private readonly btn = $('#layers-btn');
  /** Hurricanes' options list is open (kept while the menu re-renders). */
  private tropicsOpen = false;

  constructor(
    private readonly store: Store,
    private readonly onSettings: () => void,
    private readonly onLayer: (layer: LayerKey, on: boolean) => void,
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
    return !this.el.hidden;
  }

  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    if (on) this.render();
    this.el.hidden = !on;
    this.btn.setAttribute('aria-expanded', String(on));
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
    const body = h(
      'div',
      { class: 'popover-body' },
      h('p', { class: 'pop-title' }, 'Map'),
      h(
        'div',
        { class: 'group' },
        segRow(
          'Style',
          segmented('Map style', [{ value: 'satellite', label: 'Satellite' }, { value: 'dark', label: 'Dark' }], s.basemap, (v) =>
            this.store.set({ basemap: v }),
          ),
        ),
      ),
      h('p', { class: 'group-label' }, 'Layers'),
      h(
        'div',
        { class: 'group' },
        this.layer('rain', 'Radar', rainMark, 'is-precip'),
        this.layer('wind', 'Wind', windIcon, ''),
        this.layer('thunder', 'Lightning', boltMark, 'is-bolt', 'Approximate'),
        this.layer('clouds', 'Clouds', cloudMark, '', 'Live satellite'),
        ...this.tropicsRows(),
        switchRow({
          label: 'Alert areas',
          mark: alertMark,
          markClass: 'is-alert',
          checked: s.alertAreas,
          onChange: (on) => this.store.set({ alertAreas: on }),
        }),
      ),
      h('p', { class: 'group-label' }, 'Radar'),
      h(
        'div',
        { class: 'group' },
        segRow(
          'Colors',
          segmented('Radar colors', [{ value: 'color', label: 'Color' }, { value: 'mono', label: 'Mono' }], s.colorMode, (v) =>
            this.store.set({ colorMode: v }),
          ),
        ),
        switchRow({ label: 'Falling rain', checked: s.rainStreaks, onChange: (on) => this.store.set({ rainStreaks: on }) }),
      ),
      h('div', { class: 'group' }, settings),
    );
    this.el.replaceChildren(body);
    body.scrollTop = scroll;
  }
}
