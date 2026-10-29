import { h, svg } from './dom';
import { closeIcon, gripIcon } from './icons';

/**
 * The weather page's cards, arranged your way (owner, 2026-10-29: "pin stuff exactly where you want to
 * see it", pilots' flight data on top). Each card has an id and a size; Customize shows a handle to
 * drag each one where you want it (or move it with the arrow keys), and a button to hide it; hidden
 * cards wait under the others to come back. On wide screens the cards pack into as many columns as
 * fit, each fitting its height, so nothing leaves a hole; on a phone, one column, tiles two across.
 * Weather alerts always stay at the top.
 */

/** How much of a row a card takes: a tile is one column, wide two, full the whole row. */
export type CardSize = 'tile' | 'wide' | 'full';

export interface PageLayout {
  order: string[];
  hidden: string[];
}

const LAYOUT_KEY = 'weather-map:page-layout';
/** Wide screens: the grid's row unit and the gap between cards, px (styles.css matches). */
const ROW_PX = 4;
const GAP_PX = 12;
const WIDE = '(min-width: 900px)';

/** What each card is called where it's listed (hidden, or in the handle's label). */
const NAMES: Record<string, string> = {
  nextRain: 'Next 2 hours',
  hourly: 'Hourly forecast',
  week: '10-day forecast',
  air: 'Air quality',
  wind: 'Wind',
  moon: 'Moon',
  feels: 'Feels like',
  averages: 'Averages',
  uv: 'UV index',
  humidity: 'Humidity',
  sun: 'Sunrise and sunset',
  visibility: 'Visibility',
  pressure: 'Pressure',
  precip: 'Precipitation',
  clouds: 'Cloud cover',
  pollen: 'Pollen',
  tides: 'Tides',
  models: 'Forecast models',
  aloft: 'Winds aloft',
  fly: 'Flyability',
};

export const cardName = (id: string) => NAMES[id] ?? id;

export function readLayout(): PageLayout {
  try {
    const l = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as PageLayout | null;
    if (l && Array.isArray(l.order) && Array.isArray(l.hidden)) return l;
  } catch {
    // Garbled: the default.
  }
  return { order: [], hidden: [] };
}

function saveLayout(l: PageLayout): void {
  try {
    if (!l.order.length && !l.hidden.length) localStorage.removeItem(LAYOUT_KEY);
    else localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    // Lasts for this visit.
  }
}

/**
 * The cards in the saved order, then any the order doesn't know (new kinds, or ones that only show
 * sometimes, like tides) in their own order; split into those shown and those hidden.
 */
export function arrange<T extends { id: string }>(cards: T[], layout: PageLayout): { shown: T[]; hidden: T[] } {
  const known = new Map(cards.map((c) => [c.id, c]));
  const ordered = [...layout.order.filter((id) => known.has(id)).map((id) => known.get(id)!), ...cards.filter((c) => !layout.order.includes(c.id))];
  return { shown: ordered.filter((c) => !layout.hidden.includes(c.id)), hidden: ordered.filter((c) => layout.hidden.includes(c.id)) };
}

export class Arranger {
  /** Customize is on: handles and hide buttons, the hidden list, details don't open. */
  editing = false;
  /** A card is being dragged: the page holds off redrawing until it's dropped. */
  dragging = false;
  /** Told when a card is dropped (the page catches up on anything that came in meanwhile). */
  onDropped: (() => void) | null = null;
  private readonly sizes = new ResizeObserver(() => this.pack());

  constructor(
    private readonly body: HTMLElement,
    private readonly scroller: HTMLElement,
    /** Draw the page again (after a card is hidden, shown, or the layout reset). */
    private readonly redraw: () => void,
  ) {
    body.addEventListener('pointerdown', (e) => this.lift(e));
    body.addEventListener('keydown', (e) => this.nudge(e));
    matchMedia(WIDE).addEventListener('change', () => this.pack());
  }

  /** Lays the page out: alerts first, then the cards in your order, the hidden ones (while customizing), the footnote. */
  place(alerts: HTMLElement[], cards: HTMLElement[], foot: HTMLElement): void {
    const { shown, hidden } = arrange(
      cards.map((el) => ({ id: el.dataset.card ?? '', el })),
      readLayout(),
    );
    if (this.editing) for (const { id, el } of shown) el.prepend(this.tools(id));
    this.body.classList.toggle('is-editing', this.editing);
    this.body.replaceChildren(...alerts, ...shown.map((c) => c.el), ...(this.editing ? [this.hiddenList(hidden.map((c) => c.id))] : []), foot);
    this.sizes.disconnect();
    for (const el of this.body.children) this.sizes.observe(el);
    this.pack();
  }

  /** Wide screens: each card spans rows to its height, so the columns pack with no holes. */
  pack(): void {
    const wide = matchMedia(WIDE).matches;
    for (const el of this.body.children as HTMLCollectionOf<HTMLElement>) {
      if (el.classList.contains('is-lifted')) continue;
      el.style.gridRowEnd = wide ? `span ${Math.max(1, Math.ceil((el.getBoundingClientRect().height + GAP_PX) / ROW_PX))}` : '';
    }
  }

  private tools(id: string): HTMLElement {
    const grip = h('button', { type: 'button', class: 'card-grip', 'aria-label': `Move ${cardName(id)} (drag, or use the arrow keys)` }, svg(gripIcon));
    const hide = h('button', { type: 'button', class: 'card-hide', 'aria-label': `Hide ${cardName(id)}` }, svg(closeIcon));
    hide.addEventListener('click', (e) => {
      e.stopPropagation();
      const l = this.current();
      saveLayout({ order: l.order, hidden: [...l.hidden, id] });
      this.redraw();
    });
    return h('div', { class: 'card-tools' }, grip, hide);
  }

  /** The hidden cards, each with Show; and Reset, back to the original order with everything shown. */
  private hiddenList(ids: string[]): HTMLElement {
    const reset = h('button', { type: 'button', class: 'page-reset' }, 'Reset to the original layout');
    reset.addEventListener('click', () => {
      saveLayout({ order: [], hidden: [] });
      this.redraw();
    });
    return h(
      'section',
      { class: 'card glass page-hidden', 'data-size': 'full' },
      h('h3', { class: 'card-head' }, ids.length ? 'Hidden cards' : 'No hidden cards'),
      ...ids.map((id) => {
        const show = h('button', { type: 'button', class: 'page-show' }, 'Show');
        show.addEventListener('click', () => {
          const l = this.current();
          saveLayout({ order: l.order, hidden: l.hidden.filter((x) => x !== id) });
          this.redraw();
        });
        return h('div', { class: 'page-hidden-row' }, h('span', {}, cardName(id)), show);
      }),
      h('p', { class: 'pop-note' }, 'Drag a card by its handle to move it; on a computer, the arrow keys move it too. Weather alerts stay at the top.'),
      reset,
    );
  }

  /** The layout as it stands: the cards' order on the page now, and what's hidden. */
  private current(): PageLayout {
    const order = [...this.body.querySelectorAll<HTMLElement>(':scope > [data-card]')].map((el) => el.dataset.card!);
    const saved = readLayout();
    return { order: [...order, ...saved.order.filter((id) => !order.includes(id))], hidden: saved.hidden };
  }

  /** Arrow keys on a handle move its card a place earlier or later. */
  private nudge(e: KeyboardEvent): void {
    const grip = (e.target as Element).closest?.('.card-grip');
    if (!grip || !['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const card = grip.closest<HTMLElement>('[data-card]')!;
    const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    const next = back ? card.previousElementSibling : card.nextElementSibling;
    if (!next || !(next as HTMLElement).dataset.card) return;
    if (back) next.before(card);
    else next.after(card);
    saveLayout(this.current());
    this.pack();
    card.querySelector<HTMLElement>('.card-grip')?.focus();
  }

  /** Drag by the handle: the card follows the pointer, a placeholder shows where it'll land, the page scrolls at its edges. */
  private lift(e: PointerEvent): void {
    const grip = (e.target as Element).closest('.card-grip');
    if (!this.editing || !grip || e.button !== 0) return;
    const card = grip.closest<HTMLElement>('[data-card]')!;
    e.preventDefault();
    const box = this.body.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const offset = { x: e.clientX - r.left, y: e.clientY - r.top };
    const hole = h('div', { class: 'card-placeholder', 'data-size': card.dataset.size ?? 'wide' });
    hole.style.height = `${r.height}px`;
    hole.style.gridRowEnd = card.style.gridRowEnd;
    card.before(hole);
    // Out of the grid's flow, over the page, where it was.
    Object.assign(card.style, { position: 'absolute', left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, gridRowEnd: '' });
    card.classList.add('is-lifted');
    this.dragging = true;
    let at = { x: e.clientX, y: e.clientY };
    const follow = () => {
      const b = this.body.getBoundingClientRect();
      card.style.left = `${at.x - offset.x - b.left}px`;
      card.style.top = `${at.y - offset.y - b.top}px`;
    };
    // Near the scroller's top or bottom, it scrolls, a little faster the closer.
    let edge = 0;
    const scroll = () => {
      if (!this.dragging) return;
      const s = this.scroller.getBoundingClientRect();
      const d = at.y < s.top + 70 ? -(s.top + 70 - at.y) : at.y > s.bottom - 70 ? at.y - (s.bottom - 70) : 0;
      if (d) {
        this.scroller.scrollTop += Math.max(-18, Math.min(18, d / 3));
        follow();
      }
      edge = requestAnimationFrame(scroll);
    };
    edge = requestAnimationFrame(scroll);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      at = { x: ev.clientX, y: ev.clientY };
      follow();
      const over = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-card], .card-placeholder');
      if (!over || over === hole || over === card || over.parentElement !== this.body) return;
      const o = over.getBoundingClientRect();
      // Beside it (a narrow card in a row) or above and below it (a full-width one).
      const before = o.width < this.body.clientWidth * 0.75 ? at.x < o.left + o.width / 2 : at.y < o.top + o.height / 2;
      if (before && over.previousElementSibling !== hole) over.before(hole);
      else if (!before && over.nextElementSibling !== hole) over.after(hole);
      this.pack();
    };
    const drop = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', drop, true);
      removeEventListener('pointercancel', drop, true);
      cancelAnimationFrame(edge);
      card.classList.remove('is-lifted');
      Object.assign(card.style, { position: '', left: '', top: '', width: '' });
      hole.replaceWith(card);
      this.dragging = false;
      saveLayout(this.current());
      this.pack();
      this.onDropped?.();
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', drop, true);
    addEventListener('pointercancel', drop, true);
  }
}
