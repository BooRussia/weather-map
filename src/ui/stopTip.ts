import { h } from './dom';

/** Gap between the dot and the card, px. */
const GAP = 14;
/** Keep clear of the screen edges, and of the search bar at the top. */
const GUTTER = 16;
const TOP_CLEAR = 72;

/**
 * A small card anchored to a point on the map (a trip stop's dot). It grows
 * out of the point, its rows settle in one after another, and moving to
 * another point glides the same card there instead of closing and reopening.
 */
export class StopTip {
  private readonly el = h('div', { class: 'stop-tip glass-thick', role: 'tooltip', 'aria-hidden': 'true' });
  private key: number | null = null;
  private pinnedFlag = false;

  /** `avoid`: on-screen controls the card must not cover (it keeps to their left). */
  constructor(private readonly avoid: () => (Element | null)[] = () => []) {
    document.body.append(this.el);
  }

  /** Which point it's showing (null: closed). */
  get shown(): number | null {
    return this.key;
  }

  /** Opened by a tap (stays until dismissed) rather than a hover. */
  get pinned(): boolean {
    return this.pinnedFlag;
  }

  /** Show point `key`'s card at (x, y) in the viewport. */
  show(key: number, content: HTMLElement, x: number, y: number, pinned: boolean): void {
    const fresh = this.key == null;
    this.pinnedFlag = pinned;
    // A tapped card can be used (its rows open things); a hover card lets the pointer through.
    this.el.classList.toggle('is-pinned', pinned);
    this.el.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    if (key !== this.key) {
      content.querySelectorAll(':scope > *').forEach((row, i) => (row as HTMLElement).style.setProperty('--i', String(i)));
      this.el.replaceChildren(content);
      this.key = key;
    }
    this.el.setAttribute('aria-hidden', 'false');
    if (fresh) {
      // Open where it belongs (no glide from wherever it last closed), then grow in.
      this.el.classList.add('is-placing');
      this.place(x, y);
      void this.el.offsetWidth;
      this.el.classList.remove('is-placing');
      this.el.classList.add('is-open');
    } else {
      this.place(x, y);
    }
  }

  /** Follow the point (the map moved). */
  follow(x: number, y: number): void {
    if (this.key == null) return;
    this.el.classList.add('is-placing');
    this.place(x, y);
    void this.el.offsetWidth;
    this.el.classList.remove('is-placing');
  }

  hide(): void {
    if (this.key == null) return;
    this.key = null;
    this.pinnedFlag = false;
    this.el.classList.remove('is-open');
    this.el.setAttribute('aria-hidden', 'true');
  }

  /** Above the point, centered, kept on screen; below it when there's no room above. */
  private place(x: number, y: number): void {
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const above = y - GAP - hgt >= TOP_CLEAR;
    const top = above ? y - GAP - hgt : Math.min(window.innerHeight - GUTTER - hgt, y + GAP);
    // Keep left of any control column the card would overlap.
    let right = window.innerWidth - GUTTER;
    for (const el of this.avoid()) {
      const r = el?.getBoundingClientRect();
      if (r && r.width && top < r.bottom && top + hgt > r.top && r.left > window.innerWidth / 2) right = Math.min(right, r.left - 8);
    }
    const left = Math.max(GUTTER, Math.min(right - w, x - w / 2));
    this.el.style.setProperty('--tx', `${Math.round(left)}px`);
    this.el.style.setProperty('--ty', `${Math.round(top)}px`);
    // Grow out of the point itself.
    this.el.style.transformOrigin = `${Math.round(x - left)}px ${above ? hgt + GAP : -GAP}px`;
  }
}
