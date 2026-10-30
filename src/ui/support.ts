import { SUPPORT_URL } from '../config';
import { isNative } from '../util/position';
import { h, svg } from './dom';
import { chevronIcon, coffeeMark } from './icons';

/**
 * Whether there's a way to buy the devs a coffee here. The website links to the owner's page; the
 * iPhone app waits for an In-App Purchase tip jar, since App Review wants tips to go through that.
 */
export const canSupport = Boolean(SUPPORT_URL) && !isNative;

const OPENS_KEY = 'weather-map:opens';
const ASKED_KEY = 'weather-map:support-asked';

/**
 * The one time Wethr asks for support (owner, 2026-10-30): on the third open, once people know they
 * like it, never before they've used it. A small card over the map that closes right away; Settings
 * keeps the coffee after that. Counts this open.
 */
export function supportOnOpen(): void {
  try {
    const opens = Number(localStorage.getItem(OPENS_KEY) ?? 0) + 1;
    localStorage.setItem(OPENS_KEY, String(opens));
    if (opens < 3 || !canSupport || localStorage.getItem(ASKED_KEY)) return;
  } catch {
    return;
  }
  // After the map and the weather are up.
  window.setTimeout(showCard, 4000);
}

function showCard(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    return;
  }
  const later = h('button', { type: 'button', class: 'support-later' }, 'Maybe later');
  const go = h('a', { class: 'support-go', href: SUPPORT_URL, target: '_blank', rel: 'noopener' }, 'Buy the devs a coffee');
  const card = h(
    'section',
    { class: 'support glass-thick', role: 'dialog', 'aria-labelledby': 'support-title', 'aria-describedby': 'support-text' },
    h('span', { class: 'support-cup is-steaming' }, svg(coffeeMark)),
    h('h2', { id: 'support-title', class: 'support-title' }, 'Wethr is free, for good'),
    h('p', { id: 'support-text', class: 'support-text' }, 'No ads, no account, no subscription, ever. If you like it, a coffee helps keep it that way.'),
    go,
    later,
  );
  const close = () => {
    card.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    window.setTimeout(() => card.remove(), 400);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  later.addEventListener('click', close);
  go.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(card);
  // Laid out closed first, so it fades and rises in.
  void card.offsetWidth;
  card.classList.add('open');
  later.focus({ preventScroll: true });
}

/** Settings' coffee row: the cup steams for a moment when Settings opens. */
export function supportRow(steaming: boolean): HTMLElement {
  return h(
    'a',
    { class: 'row row-link row-support', href: SUPPORT_URL, target: '_blank', rel: 'noopener' },
    h('span', { class: `row-mark is-coffee${steaming ? ' is-steaming' : ''}` }, svg(coffeeMark)),
    h('span', { class: 'row-label' }, 'Support the devs', h('span', { class: 'row-sub' }, 'Free with no ads. Buy us a coffee.')),
    svg(chevronIcon),
  );
}
