import type { AppState, Store } from '../state';
import { h, svg } from './dom';
import { alertMark, checkIcon, cloudMark, fireMark, gaugeMark, moreIcon, outlookMark, rainMark, stormTrackMark, windIcon } from './icons';

/** The weather switches that can sit on the bar, in the Layers drawer's order. */
export type ShortcutId = 'rain' | 'clouds' | 'thunder' | 'wind' | 'cells' | 'alertAreas' | 'outlook' | 'tropics' | 'fires' | 'rivers';

/** The switches drawn here; the hurricane tracker and lightning only are buttons of their own (main.ts). */
const PLAIN: Partial<Record<ShortcutId, { label: string; icon: string }>> = {
  rain: { label: 'Radar', icon: rainMark },
  clouds: { label: 'Satellite clouds', icon: cloudMark },
  wind: { label: 'Wind', icon: windIcon },
  cells: { label: 'Storm tracks', icon: stormTrackMark },
  alertAreas: { label: 'Alert areas', icon: alertMark },
  outlook: { label: 'Storm outlook', icon: outlookMark },
  fires: { label: 'Wildfires', icon: fireMark },
  rivers: { label: 'River flooding', icon: gaugeMark },
};

const ORDER: ShortcutId[] = ['rain', 'clouds', 'thunder', 'wind', 'cells', 'alertAreas', 'outlook', 'tropics', 'fires', 'rivers'];
const PINS_KEY = 'weather-map:bar-pins';
/** On the bar to start (owner, 2026-10-26): the hurricane tracker and lightning only. */
const DEFAULT_PINS: ShortcutId[] = ['tropics', 'thunder'];
/** On the one-row bar of wide screens, at most this many beside the timeline; the rest are under More. */
const WIDE_MAX = 4;

function readPins(): ShortcutId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PINS_KEY) ?? 'null') as unknown;
    if (Array.isArray(saved)) return saved.filter((id): id is ShortcutId => ORDER.includes(id as ShortcutId));
  } catch {
    // Storage blocked or garbled: the defaults.
  }
  return [...DEFAULT_PINS];
}

const isOn = (s: AppState, id: ShortcutId): boolean => (id === 'alertAreas' ? s.alertAreas : s.layers[id as keyof AppState['layers']]);

/**
 * The weather switches on the right of the bar (owner, 2026-10-26): tools on the left, weather on the
 * right. The hurricane tracker and lightning only are there to start; any weather layer can be pinned
 * beside them from Layers (the thumbtack on its row), and unpinned the same way. The pins are
 * remembered, in the order they were added.
 *
 * As many as fit stay on the bar, in that order; the rest go under a More button at the row's end, a
 * short labeled list (owner, 2026-10-29: more pins made the row scroll and look cluttered). More is in
 * the accent while something under it is on.
 */
export class BarShortcuts {
  private pins = readPins();
  private readonly buttons = new Map<ShortcutId, HTMLButtonElement>();
  private readonly more = h(
    'button',
    { type: 'button', class: 'ctrl wx-more', 'aria-label': 'More weather switches', title: 'More', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    svg(moreIcon),
  ) as HTMLButtonElement;
  private readonly tray = h('div', { class: 'wx-tray glass-thick', role: 'group', 'aria-label': 'More weather switches', hidden: true });
  /** The pins that didn't fit on the bar, under More. */
  private under: ShortcutId[] = [];
  /** Told after the switches change, so the bar can lay itself out again. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly box: HTMLElement,
    private readonly store: Store,
    /** Switches with behavior of their own: the hurricane tracker and lightning only. */
    own: Partial<Record<ShortcutId, HTMLButtonElement>>,
  ) {
    for (const [id, b] of Object.entries(own)) this.buttons.set(id as ShortcutId, b!);
    store.subscribe(() => this.pressed());
    document.body.append(this.tray);
    this.more.addEventListener('click', () => this.openTray(Boolean(this.tray.hidden)));
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.tray.hidden && !this.tray.contains(t) && !this.more.contains(t)) this.openTray(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.tray.hidden) {
        this.openTray(false);
        this.more.focus();
      }
    });
    // The room changes with the window, the panel's size, and the bar's own layout.
    new ResizeObserver(() => this.fit()).observe(box.parentElement ?? box);
    this.render();
  }

  has(id: ShortcutId): boolean {
    return this.pins.includes(id);
  }

  toggle(id: ShortcutId): void {
    this.pins = this.has(id) ? this.pins.filter((p) => p !== id) : [...this.pins, id];
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(this.pins));
    } catch {
      // Lasts for this visit.
    }
    this.render();
  }

  private button(id: ShortcutId): HTMLButtonElement {
    const made = this.buttons.get(id);
    if (made) return made;
    const { label, icon } = PLAIN[id]!;
    const b = h('button', { type: 'button', class: 'ctrl', 'data-shortcut': id, 'aria-label': label, title: label, 'aria-pressed': 'false' }, svg(icon)) as HTMLButtonElement;
    b.addEventListener('click', () => {
      const s = this.store.get();
      if (id === 'alertAreas') this.store.set({ alertAreas: !s.alertAreas });
      else this.store.set({ layers: { ...s.layers, [id]: !isOn(s, id) } });
    });
    this.buttons.set(id, b);
    return b;
  }

  private render(): void {
    this.box.replaceChildren(...this.pins.map((id) => this.button(id)), this.more);
    this.box.hidden = !this.pins.length;
    this.fit();
    this.pressed();
    this.onChange?.();
  }

  /**
   * Keep as many pins on the bar as fit, the rest under More. On a phone the row's room is what the
   * tools leave; on the wide one-row bar, at most WIDE_MAX, so the timeline keeps its length.
   */
  fit(): void {
    const row = this.box.parentElement;
    const buttons = this.pins.map((id) => this.button(id));
    for (const b of buttons) b.hidden = false;
    this.more.hidden = true;
    if (!row || !buttons.length || !buttons[0].offsetWidth) return;
    const slot = buttons[0].offsetWidth + (parseFloat(getComputedStyle(this.box).columnGap) || 0);
    let room: number;
    if (getComputedStyle(row).display === 'contents') room = WIDE_MAX;
    else {
      const tools = row.querySelector<HTMLElement>('.controls');
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      room = Math.floor((row.clientWidth - (tools?.offsetWidth ?? 0) - gap + 0.5) / slot);
    }
    const shown = buttons.length <= room ? buttons.length : Math.max(0, room - 1);
    this.under = this.pins.slice(shown);
    buttons.forEach((b, i) => (b.hidden = i >= shown));
    this.more.hidden = !this.under.length;
    if (!this.under.length) this.openTray(false);
    this.pressed();
  }

  private openTray(open: boolean): void {
    if (open && !this.under.length) return;
    this.more.setAttribute('aria-expanded', String(open));
    this.tray.hidden = !open;
    if (!open) return;
    this.drawTray();
    // Over the bar, its right edge under More's (the bar is at the foot of the screen).
    const r = this.more.getBoundingClientRect();
    this.tray.style.right = `${Math.max(8, innerWidth - r.right - 6)}px`;
    this.tray.style.bottom = `${innerHeight - r.top + 8}px`;
  }

  /** What's under More, each a row: its icon, its name, and a check while it's on. Then where to change them. */
  private drawTray(): void {
    const rows = this.under.map((id) => {
      const b = this.button(id);
      const on = b.getAttribute('aria-pressed') === 'true';
      const row = h(
        'button',
        { type: 'button', class: 'wx-tray-row', 'data-shortcut': id, role: 'switch', 'aria-checked': String(on) },
        h('span', { class: 'wx-tray-icon' }, (b.querySelector('svg')?.cloneNode(true) as SVGElement | undefined) ?? ''),
        h('span', { class: 'wx-tray-label' }, b.getAttribute('aria-label') ?? id),
        h('span', { class: 'wx-tray-check' }, svg(checkIcon)),
      );
      // The bar's own button does the work (the hurricane tracker and lightning only have more to them).
      row.addEventListener('click', () => {
        b.click();
        setTimeout(() => this.pressed(), 0);
      });
      return row;
    });
    const edit = h('button', { type: 'button', class: 'wx-tray-note' }, 'Pin or unpin them in Layers');
    edit.addEventListener('click', () => {
      this.openTray(false);
      document.getElementById('layers-btn')?.click();
    });
    this.tray.replaceChildren(...rows, edit);
  }

  /** The plain switches show whether their layer is on (the other two keep their own state); More, whether anything under it is. */
  private pressed(): void {
    const s = this.store.get();
    for (const id of this.pins) if (PLAIN[id]) this.buttons.get(id)?.setAttribute('aria-pressed', String(isOn(s, id)));
    this.more.classList.toggle('has-on', this.under.some((id) => this.button(id).getAttribute('aria-pressed') === 'true'));
    if (this.tray.hidden) return;
    for (const row of this.tray.querySelectorAll<HTMLElement>('.wx-tray-row')) {
      const b = this.button(row.dataset.shortcut as ShortcutId);
      row.setAttribute('aria-checked', String(b.getAttribute('aria-pressed') === 'true'));
    }
  }
}
