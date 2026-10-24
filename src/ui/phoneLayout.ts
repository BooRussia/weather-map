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
      timeline.prepend($('#dock-handle'), controls);
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

/** A touch turns into a drag once it has moved this far, mostly up or down; till then it's a tap. */
const DRAG_PX = 10;

/**
 * Make `el` a drag grip: anywhere on it, a touch that moves DRAG_PX mostly up or down becomes a drag
 * (`move` with how far, from where the drag took hold; `end` with how far, how fast, px/ms, and
 * whether it ended or was cancelled). Taps still reach the buttons inside; the click a drag ends with
 * is swallowed so it doesn't press whatever was under the finger. Fields and sliders are left alone.
 */
function grip(
  el: HTMLElement,
  on: { start?: () => void; move: (dy: number) => void; end: (dy: number, speed: number, act: boolean) => void },
): void {
  let pointer: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dy = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  let dragging = false;
  let swallow = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointer != null || (e.target as Element).closest('input, select, textarea')) return;
    pointer = e.pointerId;
    dragging = false;
    x0 = e.clientX;
    y0 = lastY = e.clientY;
    lastT = e.timeStamp;
    speed = 0;
    dy = 0;
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    const raw = e.clientY - y0;
    if (e.timeStamp > lastT) speed = (e.clientY - lastY) / (e.timeStamp - lastT);
    lastY = e.clientY;
    lastT = e.timeStamp;
    if (!dragging) {
      if (Math.abs(raw) < DRAG_PX || Math.abs(raw) < Math.abs(e.clientX - x0)) return;
      dragging = true;
      el.setPointerCapture(e.pointerId);
      on.start?.();
    }
    // Measured from where it took hold, so nothing jumps by the threshold.
    dy = raw - Math.sign(raw) * DRAG_PX;
    on.move(dy);
  });
  const release = (e: PointerEvent, act: boolean) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (!dragging) return;
    dragging = false;
    swallow = true;
    setTimeout(() => (swallow = false), 0);
    on.end(dy, speed, act);
  };
  el.addEventListener('pointerup', (e) => release(e, true));
  el.addEventListener('pointercancel', (e) => release(e, false));
  el.addEventListener(
    'click',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}

const COMPACT_KEY = 'weather-map:banner-compact';

/**
 * The phone banner's handle, and the banner itself as its grip (owner, 2026-10-23). Push it up: the banner tightens to the place, the
 * temperature, the day's peaks as small numbers, and a triangle with the alert count, to show more
 * map. Pull it down from there: back to the full banner. Pull it down again: the whole weather comes
 * down with it, the banner as the page's foot, one drawer following the finger; with it open, push the
 * banner back up (or tap the handle) to close it. Push up on the small banner and it slides away
 * into map only, every control hidden (owner, 2026-10-23). A tap otherwise switches sizes, which are
 * remembered.
 */
export function bannerHandle(weather: {
  isOpen: () => boolean;
  drag: (dy: number) => void;
  release: (dy: number, speed: number) => void;
  close: () => void;
  mapOnly: () => void;
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
    handle.setAttribute('aria-label', on ? 'Show the week and alerts' : 'Make the banner smaller');
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

  // The whole banner is the grip (owner, 2026-10-23: drag from anywhere on it, not just the handle).
  /** Pulling the whole weather down from the full banner. */
  let pullingPage = false;
  grip(cap, {
    start: () => {
      pullingPage = false;
      cap.style.transition = 'none';
    },
    move: (dy) => {
      // With the weather out, the banner is its foot: it all moves with the finger, either way. From the
      // full banner, pulling down brings it all down from the top.
      if (pullingPage || weather.isOpen() || (!compact && dy > 0)) {
        pullingPage = true;
        cap.style.transform = '';
        weather.drag(weather.isOpen() ? dy : Math.max(0, dy));
        return;
      }
      // Otherwise the banner follows the finger a little, so the pull feels connected.
      cap.style.transform = `translateY(${Math.max(-36, Math.min(36, dy * 0.35)).toFixed(1)}px)`;
    },
    end: (dy, speed, act) => {
      cap.style.transition = '';
      cap.style.transform = '';
      if (pullingPage) {
        pullingPage = false;
        // Opens or closes by how far it went and which way it was moving (a cancel puts it back).
        weather.release(act ? dy : 0, act ? speed : 0);
        return;
      }
      if (!act) return;
      if (dy < -20) {
        if (!compact) {
          set(true);
        } else {
          // Already small: up and off the top, and the map takes the whole screen.
          cap.style.transform = 'translateY(-160%)';
          setTimeout(() => {
            weather.mapOnly();
            cap.style.transition = 'none';
            cap.style.transform = '';
            void cap.offsetHeight;
            cap.style.transition = '';
          }, 220);
        }
      } else if (dy > 20 && compact) {
        set(false);
      }
    },
  });
  // A tap on the handle switches sizes (or puts the weather away).
  handle.addEventListener('click', () => {
    if (weather.isOpen()) weather.close();
    else set(!compact);
  });
}

const DOCK_KEY = 'weather-map:dock-minimal';

/**
 * The bottom panel's handle, and the panel itself as its grip (owner, 2026-10-23: make the chin smaller). Pull it down: the panel shrinks
 * to one line, play, the time, and the timeline, with the buttons and search tucked away. Push it up:
 * the full panel again. A tap switches; the size is remembered.
 */
export function dockHandle(): void {
  const panel = $('#timeline');
  const handle = $('#dock-handle');
  let minimal = false;
  try {
    minimal = localStorage.getItem(DOCK_KEY) === '1';
  } catch {
    // Storage blocked: starts full.
  }
  const set = (on: boolean, save = true) => {
    minimal = on;
    panel.classList.toggle('is-minimal', on);
    handle.setAttribute('aria-label', on ? 'Show the map buttons and search' : 'Make the panel smaller');
    handle.setAttribute('aria-expanded', String(!on));
    if (save) {
      try {
        localStorage.setItem(DOCK_KEY, on ? '1' : '0');
      } catch {
        // Lasts for this visit.
      }
    }
    // A chart hung above the panel finds its new edge.
    window.dispatchEvent(new Event('resize'));
  };
  set(minimal, false);

  // The whole panel is the grip too (owner, 2026-10-23), the slider and search aside.
  grip(panel, {
    start: () => {
      panel.style.transition = 'none';
    },
    move: (dy) => {
      // The panel follows the finger a little, so the pull feels connected.
      panel.style.transform = `translateY(${Math.max(-30, Math.min(30, dy * 0.35)).toFixed(1)}px)`;
    },
    end: (dy, _speed, act) => {
      panel.style.transition = '';
      panel.style.transform = '';
      if (!act) return;
      if (dy > 20 && !minimal) set(true);
      else if (dy < -20 && minimal) set(false);
    },
  });
  handle.addEventListener('click', () => set(!minimal));
}
