import { $, h } from './dom';

/** Phones get the one-panel layout; tablets and computers keep the classic one. */
const PHONE = '(max-width: 699px)';

/**
 * Size the page to the screen. An iPhone home-screen app with the see-through status bar lays the page
 * out a status bar short of the screen (a WebKit bug), which left a black strip at the bottom (owner,
 * 2026-10-23). When that gap is there, the page reaches down over it (--app-gap) and the bottom panel
 * sits on the real bottom; with the keyboard up, the panel rides on top of it (--kb).
 */
function fitScreen(): void {
  const root = document.documentElement;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let gap = 0;
  if (standalone) {
    // Screen sizes are the portrait ones on iOS, whichever way the phone is held.
    const landscape = innerWidth > innerHeight;
    const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const g = full - innerHeight;
    if (g > 0 && g <= 80) gap = g;
  }
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
  root.style.setProperty('--app-gap', `${gap}px`);
  root.style.setProperty('--kb', `${kb}px`);
  root.style.setProperty('--vvh', `${Math.round(vv?.height ?? innerHeight)}px`);
}

/**
 * Phones (owner, 2026-10-23): everything in one panel at the bottom, on the radar timeline's glass:
 * the map buttons in a row on top, then the place with its temperature and today's highest wind and
 * chance of rain, then the timeline, then search. Alerts and storms ride just above it. Wider screens
 * keep search on top, the banner at the top left, and the buttons down the right. The elements move
 * rather than being copied, so their listeners come with them.
 */
export function phoneLayout(): void {
  fitScreen();
  addEventListener('resize', fitScreen);
  window.visualViewport?.addEventListener('resize', fitScreen);
  window.visualViewport?.addEventListener('scroll', fitScreen);

  const mq = matchMedia(PHONE);
  const timeline = $('#timeline');
  const dock = $('.dock');
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
  const pills = h('div', { class: 'dock-pills' });

  const apply = () => {
    const phone = mq.matches;
    document.body.classList.toggle('phone', phone);
    if (phone) {
      timeline.prepend(controls, cap);
      timeline.append(search);
      pills.append(alert, storm);
      dock.insertBefore(pills, timeline);
    } else {
      for (const [el, mark] of homes) mark.after(el);
      pills.remove();
    }
  };
  apply();
  mq.addEventListener('change', apply);
}
