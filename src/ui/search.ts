import type { LatLon } from '../config';
import { searchPlaces, type Place } from '../data/photon';
import type { Tag } from '../data/tags';
import { $, h, svg } from './dom';
import { closeIcon, searchIcon } from './icons';

export const PIN = `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>`;
export const HOUSE = `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20H4z" /><path d="M10 20v-5h4v5" /></svg>`;
const DEBOUNCE_MS = 280;

/** A place's weather as the list shows it: the temperature, the sky, and a line under the name. */
export interface PlaceWeather {
  temp: string;
  glyph: string;
  line: string;
}

/** My places, listed while the field is empty: where you are, then the places you've tagged. */
export interface SavedPlaces {
  list(): readonly Tag[];
  pick(t: Tag): void;
  remove(t: Tag): void;
  /** Where you are, first in the list, when it's known. */
  here(): { name: string; at: LatLon } | null;
  pickHere(): void;
  /** Each point's weather now, in order (null where it can't be had). */
  weather(points: readonly LatLon[]): Promise<(PlaceWeather | null)[]>;
  /** How to tag one, shown while there are none. */
  hint: string;
}

/**
 * The search field: city and street-address suggestions as you type
 * (Photon), nearest first. Arrow keys move, Enter picks, Escape closes.
 * Empty, it lists the places you've tagged.
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
    private readonly saved: SavedPlaces | null = null,
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
      else if (!this.input.value.trim()) this.renderSaved();
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
      if (!q && document.activeElement === this.input) this.renderSaved();
      else this.show(false);
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

  /**
   * My places (owner, 2026-10-29: Apple's list of your cities): where you are, then the tagged places,
   * newest first, each with its temperature, sky, condition and high and low (filled in once they
   * load, one request for all); tap one to go there, × to remove it. With none tagged, how to tag one.
   */
  private renderSaved(): void {
    if (!this.saved) return;
    const saved = this.saved;
    const tags = [...saved.list()].reverse();
    const here = saved.here();
    this.active = -1;
    const row = (title: string, sub: string | null, go: () => void, remove: (() => void) | null, label: string) => {
      const btn = h(
        'button',
        { type: 'button', class: 'result place-row', role: 'option', 'aria-selected': 'false', 'aria-label': label },
        h('span', { class: 'result-mark' }, svg(PIN)),
        h('span', { class: 'place-text' }, h('span', { class: 'result-title' }, title), h('span', { class: 'result-sub' }, sub ?? '')),
        h('span', { class: 'place-temp' }),
      );
      // pointerdown keeps focus in the field (the list stays put); click works for keys too.
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        this.input.value = '';
        this.show(false);
        this.input.blur();
        go();
      });
      const li = h('li', { class: 'result-saved' }, btn);
      if (remove) {
        const x = h('button', { type: 'button', class: 'result-remove', 'aria-label': `Remove ${title}` }, svg(closeIcon));
        x.addEventListener('pointerdown', (e) => e.preventDefault());
        x.addEventListener('click', () => {
          remove();
          this.renderSaved();
        });
        li.append(x);
      }
      return { li, btn };
    };
    const rows = [
      ...(here ? [{ at: here.at, ...row('My location', here.name, () => saved.pickHere(), null, `My location, ${here.name}`) }] : []),
      ...tags.map((t) => ({ at: { lat: t.lat, lon: t.lon }, ...row(t.name, null, () => saved.pick(t), () => saved.remove(t), t.name) })),
    ];
    this.list.replaceChildren(
      h('li', { class: 'result-head', role: 'presentation' }, 'My places'),
      ...rows.map((r) => r.li),
      ...(tags.length ? [] : [h('li', { class: 'result-empty' }, saved.hint)]),
    );
    this.show(true);
    const drawn = this.list.firstElementChild;
    void saved.weather(rows.map((r) => r.at)).then((found) => {
      // Still this list (not search results, or a newer list).
      if (this.list.firstElementChild !== drawn) return;
      found.forEach((w, i) => {
        if (!w) return;
        const b = rows[i].btn;
        b.querySelector('.result-mark')!.replaceChildren(svg(w.glyph));
        b.querySelector('.result-mark')!.classList.add('is-sky');
        b.querySelector('.place-temp')!.textContent = w.temp;
        const sub = b.querySelector('.result-sub')!;
        sub.textContent = sub.textContent ? `${sub.textContent} · ${w.line}` : w.line;
        b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, ${w.temp}, ${w.line}`);
      });
    });
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
