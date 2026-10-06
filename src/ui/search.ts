import type { LatLon } from '../config';
import { searchPlaces, type Place } from '../data/photon';
import { $, h, svg } from './dom';
import { searchIcon } from './icons';

const PIN = `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>`;
const HOUSE = `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20H4z" /><path d="M10 20v-5h4v5" /></svg>`;
const DEBOUNCE_MS = 280;

/**
 * The search field: city and street-address suggestions as you type
 * (Photon), nearest first. Arrow keys move, Enter picks, Escape closes.
 */
export class SearchBox {
  private readonly input = $<HTMLInputElement>('#search');
  private readonly list = $<HTMLUListElement>('#search-results');
  private results: Place[] = [];
  private active = -1;
  private timer = 0;
  private ctrl: AbortController | null = null;

  constructor(
    private readonly near: () => LatLon | null,
    private readonly onPick: (p: Place) => void,
  ) {
    $('#search-icon').append(svg(searchIcon));
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.pickActive();
    });
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.run(), DEBOUNCE_MS);
    });
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('focus', () => {
      if (this.results.length) this.show(true);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('.top')) this.show(false);
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  private async run(): Promise<void> {
    const q = this.input.value.trim();
    this.ctrl?.abort();
    if (q.length < 2) {
      this.results = [];
      this.show(false);
      return;
    }
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const found = await searchPlaces(q, this.near(), ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.results = found;
      this.active = found.length ? 0 : -1;
      this.render(found.length ? null : 'No matches');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.results = [];
      this.render('Search is unavailable right now');
    }
  }

  private render(empty: string | null): void {
    this.list.replaceChildren(
      ...(empty
        ? [h('li', { class: 'result-empty' }, empty)]
        : this.results.map((p, i) => {
            const btn = h(
              'button',
              { type: 'button', class: 'result', role: 'option', 'aria-selected': String(i === this.active), id: `result-${i}` },
              h('span', { class: 'result-mark' }, svg(p.kind === 'address' ? HOUSE : PIN)),
              h('span', {}, h('span', { class: 'result-title' }, p.title), p.subtitle ? h('span', { class: 'result-sub' }, p.subtitle) : null),
            );
            // pointerdown, not click: picks before the field loses focus on touch.
            btn.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              this.pick(p);
            });
            return h('li', {}, btn);
          })),
    );
    this.show(true);
  }

  private show(on: boolean): void {
    this.list.hidden = !on;
    this.input.setAttribute('aria-expanded', String(on));
    if (on && this.active >= 0) this.input.setAttribute('aria-activedescendant', `result-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.show(false);
      this.input.blur();
      return;
    }
    if (!this.results.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const n = this.results.length;
    this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    this.list.querySelectorAll('.result').forEach((el, i) => el.setAttribute('aria-selected', String(i === this.active)));
    this.show(true);
  }

  private async pickActive(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.results.length) await this.run();
    const p = this.results[Math.max(0, this.active)];
    if (p) this.pick(p);
  }

  private pick(p: Place): void {
    this.input.value = p.subtitle ? `${p.title}, ${p.subtitle}` : p.title;
    this.show(false);
    // Drops the phone keyboard so the map is visible again.
    this.input.blur();
    this.onPick(p);
  }
}
