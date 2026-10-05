import { $, h, svg } from './dom';
import { closeIcon } from './icons';

/**
 * One sheet for settings, forecast, and alerts. Bottom sheet on phones,
 * right-side panel on wide screens. Escape, the close button, or the scrim
 * close it; focus returns to whatever opened it.
 */
export class Sheet {
  private readonly root = $('#sheet');
  private readonly scrim = $('#scrim');
  private readonly title = $('#sheet-title');
  private readonly body = $('#sheet-body');
  private opener: HTMLElement | null = null;
  private onCloseCb: (() => void) | null = null;

  constructor() {
    const close = h('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close' }, svg(closeIcon));
    close.addEventListener('click', () => this.close());
    $('#sheet-head').append(close);
    this.scrim.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.setInert(true);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Name of the panel currently shown, so live data can re-render it. */
  current: string | null = null;

  open(name: string, title: string, content: Node, opener: HTMLElement | null, onClose?: () => void): void {
    this.current = name;
    this.title.textContent = title;
    this.body.replaceChildren(content);
    this.body.scrollTop = 0;
    if (!this.isOpen) this.opener = opener;
    this.onCloseCb = onClose ?? null;
    this.root.classList.add('open');
    this.scrim.classList.add('open');
    this.setInert(false);
    requestAnimationFrame(() => $('#sheet .sheet-close').focus({ preventScroll: true }));
  }

  /** Replace the body in place (keeps the sheet open). */
  update(title: string, content: Node): void {
    this.title.textContent = title;
    this.body.replaceChildren(content);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    this.scrim.classList.remove('open');
    this.setInert(true);
    this.current = null;
    this.onCloseCb?.();
    this.opener?.focus({ preventScroll: true });
    this.opener = null;
  }

  private setInert(inert: boolean): void {
    this.root.toggleAttribute('inert', inert);
    this.root.setAttribute('aria-hidden', String(inert));
  }
}
