import { $, h } from './dom';

/** Phones get the one-panel layout; tablets and computers keep the classic one. */
const PHONE = '(max-width: 699px)';

/** The keyboard's height (--kb) and the visible height (--vvh), so the bottom panel can ride on the keyboard. */
function trackKeyboard(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
  root.style.setProperty('--kb', `${kb}px`);
  root.style.setProperty('--vvh', `${Math.round(vv?.height ?? innerHeight)}px`);
}

/**
 * Phones (owner, 2026-10-23): a header on top with the place, its temperature, and today's highest
 * wind and chance of rain, alerts and storms just under it; and one panel at the bottom, on the radar
 * timeline's glass: the map buttons in a row, the timeline, then search. Wider screens keep search on
 * top, the banner at the top left, and the buttons down the right. The elements move rather than
 * being copied, so their listeners come with them.
 */
export function phoneLayout(): void {
  trackKeyboard();
  addEventListener('resize', trackKeyboard);
  window.visualViewport?.addEventListener('resize', trackKeyboard);
  window.visualViewport?.addEventListener('scroll', trackKeyboard);

  const mq = matchMedia(PHONE);
  const timeline = $('#timeline');
  const controls = $('.controls');
  const cap = $('.cap-wrap');
  const search = $('.top');
  const alert = $('#alert-pill');
  const storm = $('#storm-pill');
  // A marker where each lives on wide screens, to put it back.
  const homes = [controls, cap, search, alert, storm].map((el) => {
    const mark = document.createComment(`home of ${el.id || el.className}`);
    el.before(mark);
    return [el, mark] as const;
  });
  const head = h('div', { class: 'phone-head' });
  const pills = h('div', { class: 'head-pills' });

  const apply = () => {
    const phone = mq.matches;
    document.body.classList.toggle('phone', phone);
    if (phone) {
      timeline.prepend(controls);
      timeline.append(search);
      pills.append(alert, storm);
      head.append(cap, pills);
      document.body.append(head);
    } else {
      for (const [el, mark] of homes) mark.after(el);
      head.remove();
    }
  };
  apply();
  mq.addEventListener('change', apply);
}
