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
 * Phones (owner, 2026-10-23): a header on top with the place and its temperature, little graphs of
 * today's temperature, wind, rain, and humidity, and any alerts and storms; and one panel at the bottom, on the radar
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
      // Alerts and storms along the banner's foot (owner, 2026-10-23: "all in one clean forehead").
      pills.append(alert, storm);
      cap.append(pills, $('#cap-handle'));
      head.append(cap);
      document.body.append(head);
    } else {
      for (const [el, mark] of homes) mark.after(el);
      pills.remove();
      head.remove();
    }
  };
  apply();
  mq.addEventListener('change', apply);
}

const COMPACT_KEY = 'weather-map:banner-compact';

/**
 * The phone banner's handle (owner, 2026-10-23). Push it up: the banner tightens to the place, the
 * temperature, the day's peaks as small numbers, and a triangle with the alert count, to show more
 * map. Pull it down from there: back to the full banner. Pull it down again: the whole weather comes
 * down with it, the banner as the page's foot, one drawer following the finger; with it open, push the
 * banner back up (or tap the handle) to close it. A tap otherwise switches sizes, which are remembered.
 */
export function bannerHandle(weather: {
  isOpen: () => boolean;
  drag: (dy: number) => void;
  release: (dy: number, speed: number) => void;
  close: () => void;
}): void {
  const cap = $('.cap-wrap');
  const handle = $('#cap-handle');
  let compact = false;
  try {
    compact = localStorage.getItem(COMPACT_KEY) === '1';
  } catch {
    // Storage blocked: starts full.
  }
  const set = (on: boolean, save = true) => {
    compact = on;
    cap.classList.toggle('is-compact', on);
    handle.setAttribute('aria-label', on ? 'Show the day’s graphs and alerts' : 'Make the banner smaller');
    handle.setAttribute('aria-expanded', String(!on));
    if (save) {
      try {
        localStorage.setItem(COMPACT_KEY, on ? '1' : '0');
      } catch {
        // Lasts for this visit.
      }
    }
    // Anything hung under the banner (a chart) finds its new edge.
    window.dispatchEvent(new Event('resize'));
  };
  set(compact, false);

  let startY = 0;
  let dy = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  let dragging = false;
  let moved = false;
  /** Pulling the whole weather down from the full banner. */
  let pullingPage = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    pullingPage = false;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    speed = 0;
    dy = 0;
    handle.setPointerCapture(e.pointerId);
    cap.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    if (e.timeStamp > lastT) speed = (e.clientY - lastY) / (e.timeStamp - lastT);
    lastY = e.clientY;
    lastT = e.timeStamp;
    if (Math.abs(dy) > 6) moved = true;
    // With the weather out, the banner is its foot: it all moves with the finger, either way. From the
    // full banner, pulling down brings it all down from the top.
    if (pullingPage || weather.isOpen() || (!compact && dy > 6)) {
      pullingPage = true;
      cap.style.transform = '';
      weather.drag(weather.isOpen() ? dy : Math.max(0, dy - 6));
      return;
    }
    // Otherwise the banner follows the finger a little, so the pull feels connected.
    cap.style.transform = `translateY(${Math.max(-36, Math.min(36, dy * 0.35)).toFixed(1)}px)`;
  });
  const release = (act: boolean) => {
    if (!dragging) return;
    dragging = false;
    cap.style.transition = '';
    cap.style.transform = '';
    if (pullingPage) {
      pullingPage = false;
      // Opens or closes by how far it went and which way it was moving (a cancel puts it back).
      weather.release(act ? dy : 0, act ? speed : 0);
      return;
    }
    if (!act || !moved) return;
    if (dy < -24) {
      if (!compact) set(true);
    } else if (dy > 24 && compact) {
      set(false);
    }
  };
  handle.addEventListener('pointerup', () => release(true));
  handle.addEventListener('pointercancel', () => release(false));
  handle.addEventListener('click', () => {
    // A drag ends in a click too; only a tap switches the size.
    if (moved) {
      moved = false;
      return;
    }
    if (weather.isOpen()) weather.close();
    else set(!compact);
  });
}
