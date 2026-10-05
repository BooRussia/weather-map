import { $ } from './dom';

let timer = 0;

/** A short muted status line above the layer buttons. */
export function showNote(text: string, ms = 3200): void {
  const el = $('#note');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('show'), ms);
}
