import { $, svg } from './dom';
import { expandIcon, shrinkIcon } from './icons';

/** The exit button fades after this long without a touch or mouse move. */
const IDLE_MS = 2500;

/**
 * "Map only": every control hides so the map and its layers (radar, wind,
 * the weather map, storms) fill the screen, in browser fullscreen too where
 * the page may ask for it (not iPhone Safari). One small button brings the
 * controls back; it fades while you just look and returns on any touch or
 * mouse move. Escape (or leaving browser fullscreen) also exits.
 */
export class MapOnly {
  private readonly btn = $<HTMLButtonElement>('#full-btn');
  private readonly exitBtn = $<HTMLButtonElement>('#full-exit');
  private timer = 0;
  private active = false;

  constructor(private readonly onChange: (on: boolean) => void) {
    this.btn.append(svg(expandIcon));
    this.exitBtn.append(svg(shrinkIcon));
    this.btn.addEventListener('click', () => this.set(true));
    this.exitBtn.addEventListener('click', () => this.set(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.set(false);
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.active) this.set(false);
    });
    const wake = () => {
      if (this.active) this.wake();
    };
    document.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'mouse') wake();
      },
      { passive: true },
    );
  }

  get on(): boolean {
    return this.active;
  }

  toggle(): void {
    this.set(!this.active);
  }

  set(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('map-only', on);
    this.exitBtn.hidden = !on;
    this.btn.setAttribute('aria-pressed', String(on));
    if (on) {
      // Browser fullscreen hides the address bar too; refused or unsupported is fine.
      if (document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
      this.wake();
      this.exitBtn.focus({ preventScroll: true });
    } else {
      clearTimeout(this.timer);
      this.exitBtn.classList.remove('idle');
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      this.btn.focus({ preventScroll: true });
    }
    this.onChange(on);
  }

  private wake(): void {
    this.exitBtn.classList.remove('idle');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.exitBtn.classList.add('idle'), IDLE_MS);
  }
}
