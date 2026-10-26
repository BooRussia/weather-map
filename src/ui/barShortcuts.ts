import type { AppState, Store } from '../state';
import { h, svg } from './dom';
import { alertMark, cloudMark, outlookMark, rainMark, stormTrackMark, windIcon } from './icons';

/** The weather switches that can sit on the bar, in the Layers drawer's order. */
export type ShortcutId = 'rain' | 'clouds' | 'thunder' | 'wind' | 'cells' | 'alertAreas' | 'outlook' | 'tropics';

/** The switches drawn here; the hurricane tracker and lightning only are buttons of their own (main.ts). */
const PLAIN: Partial<Record<ShortcutId, { label: string; icon: string }>> = {
  rain: { label: 'Radar', icon: rainMark },
  clouds: { label: 'Satellite clouds', icon: cloudMark },
  wind: { label: 'Wind', icon: windIcon },
  cells: { label: 'Storm tracks', icon: stormTrackMark },
  alertAreas: { label: 'Alert areas', icon: alertMark },
  outlook: { label: 'Storm outlook', icon: outlookMark },
};

const ORDER: ShortcutId[] = ['rain', 'clouds', 'thunder', 'wind', 'cells', 'alertAreas', 'outlook', 'tropics'];
const PINS_KEY = 'weather-map:bar-pins';
/** On the bar to start (owner, 2026-10-26): the hurricane tracker and lightning only. */
const DEFAULT_PINS: ShortcutId[] = ['tropics', 'thunder'];

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
 */
export class BarShortcuts {
  private pins = readPins();
  private readonly buttons = new Map<ShortcutId, HTMLButtonElement>();
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
    this.box.replaceChildren(...this.pins.map((id) => this.button(id)));
    this.box.hidden = !this.pins.length;
    this.pressed();
    this.onChange?.();
  }

  /** The plain switches show whether their layer is on (the other two keep their own state). */
  private pressed(): void {
    const s = this.store.get();
    for (const id of this.pins) if (PLAIN[id]) this.buttons.get(id)?.setAttribute('aria-pressed', String(isOn(s, id)));
  }
}
