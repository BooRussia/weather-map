import { $, h } from './dom';

/** The keyboard's height (--kb) and the visible height (--vvh), so the bottom panel can ride on the keyboard. */
function trackKeyboard(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
  root.style.setProperty('--kb', `${kb}px`);
  root.style.setProperty('--vvh', `${Math.round(vv?.height ?? innerHeight)}px`);
}

/**
 * The one-panel layout (owner, 2026-10-23 on phones; every screen size since 2026-10-25: "make desktop
 * the exact same"): a header on top with the place and its weather, the forecast or little graphs of
 * the day, and any alerts and storms; and one panel at the bottom, on the radar timeline's glass: the
 * map buttons in a row, the timeline, then search. Wider screens get the same two, phone-width and
 * centered. body.phone marks it (the name is older than the layout's reach). The elements move rather
 * than being copied, so their listeners come with them.
 */
export function phoneLayout(): void {
  trackKeyboard();
  addEventListener('resize', trackKeyboard);
  window.visualViewport?.addEventListener('resize', trackKeyboard);
  window.visualViewport?.addEventListener('scroll', trackKeyboard);

  const timeline = $('#timeline');
  const cap = $('.cap-wrap');
  const head = h('div', { class: 'phone-head' });
  // Alerts and storms along the banner's foot (owner, 2026-10-23: "all in one clean forehead").
  const pills = h('div', { class: 'head-pills' }, $('#alert-pill'), $('#storm-pill'));
  document.body.classList.add('phone');
  timeline.prepend($('#dock-handle'), $('.controls'));
  timeline.append($('.top'));
  cap.append(pills, $('#cap-handle'));
  head.append(cap);
  document.body.append(head);
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
/** The bottom panel's sizes, biggest first; stored as these words ('1' and '0' from before 2026-10-24). */
const DOCK_SIZES = ['full', 'mid', 'min'] as const;

/**
 * The bottom panel's handle, and the panel itself as its grip (owner, 2026-10-23: make the chin
 * smaller). Three sizes (owner, 2026-10-24): full; pull it down once and search and the legend tuck
 * away, leaving the map buttons over one line of play, the time, and the timeline; pull it down again
 * and the buttons go too. Push it up a size at a time. A tap steps it smaller, and from the smallest
 * back to full; the size is remembered.
 */
export function dockHandle(): void {
  const panel = $('#timeline');
  const handle = $('#dock-handle');
  let size = 0;
  try {
    const saved = localStorage.getItem(DOCK_KEY);
    size = saved === '1' ? 2 : Math.max(0, DOCK_SIZES.indexOf(saved as (typeof DOCK_SIZES)[number]));
  } catch {
    // Storage blocked: starts full.
  }
  const set = (to: number, save = true) => {
    size = Math.max(0, Math.min(DOCK_SIZES.length - 1, to));
    panel.classList.toggle('is-mid', size === 1);
    panel.classList.toggle('is-minimal', size === 2);
    handle.setAttribute('aria-label', size === 2 ? 'Show the map buttons and search' : 'Make the panel smaller');
    handle.setAttribute('aria-expanded', String(size === 0));
    if (save) {
      try {
        localStorage.setItem(DOCK_KEY, DOCK_SIZES[size]);
      } catch {
        // Lasts for this visit.
      }
    }
    // A chart hung above the panel finds its new edge.
    window.dispatchEvent(new Event('resize'));
  };
  set(size, false);

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
      if (dy > 20) set(size + 1);
      else if (dy < -20) set(size - 1);
    },
  });
  handle.addEventListener('click', () => set((size + 1) % DOCK_SIZES.length));
}
