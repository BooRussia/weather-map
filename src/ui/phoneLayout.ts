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
/**
 * How wide the banner is when it lays out sideways (styles.css, @container head (min-width: 760px)):
 * from there, on computers, search lives in the banner.
 */
const SEARCH_UP_PX = 760;

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
  // The bar's buttons in one row: tools on the left, weather switches on the right (owner, 2026-10-26).
  timeline.prepend($('#dock-handle'), h('div', { class: 'ctrl-row' }, $('.controls'), $('#wx-btns')));
  const search = $('.top');
  timeline.append(search);
  cap.append(pills, $('#cap-handle'));
  head.append(cap);
  document.body.append(head);

  // Computers (owner, 2026-10-26: a search row in the banner was too bulky): once the banner lays out
  // sideways, search is a button in its corner that opens the field in the middle of the screen, and
  // the full panel shows the color keys instead. Narrower, and on phones, it stays at the panel's foot.
  pop = h('div', { class: 'search-pop', hidden: '' });
  const box = h('div', { class: 'search-pop-box' });
  pop.append(box);
  document.body.append(pop);
  // Picking a place, Escape, or a click anywhere else lets go of the field: the box goes with it.
  pop.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pop && !pop.contains(document.activeElement)) closeSearchPop();
    }, 0);
  });
  pop.addEventListener('pointerdown', (e) => {
    if (e.target === pop) closeSearchPop();
  });
  // And directly, not only through focus: Escape, a place picked from the list, or Enter.
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearchPop();
  });
  pop.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.result')) closeSearchPop();
  });
  pop.addEventListener('submit', () => setTimeout(closeSearchPop, 0));
  const place = () => {
    const up = head.clientWidth >= SEARCH_UP_PX;
    if (up === (search.parentElement === box)) return;
    const typing = search.contains(document.activeElement);
    if (up) box.append(search);
    else {
      closeSearchPop();
      timeline.append(search);
    }
    document.body.classList.toggle('search-up', up);
    if (typing && !up) search.querySelector('input')?.focus({ preventScroll: true });
  };
  new ResizeObserver(place).observe(head);
  place();

  // The full panel in one row: once it's too crowded for the color key beside the timeline (many
  // pinned switches, or a narrower window), the key drops to its own line under it.
  const fit = () => {
    timeline.classList.remove('is-tight');
    if (timeline.scrollWidth > timeline.clientWidth + 1) timeline.classList.add('is-tight');
  };
  new ResizeObserver(fit).observe(timeline);
  fitBar = fit;
}

/** The middle-of-the-screen search (computers). */
let pop: HTMLElement | null = null;
let fitBar: () => void = () => {};

/** Lay the bar out again (its switches changed). */
export function refitBar(): void {
  fitBar();
}

/** Computers: show the search field in the middle of the screen. False where it lives in the panel (phones). */
export function openSearchPop(): boolean {
  if (!pop || !document.body.classList.contains('search-up')) return false;
  pop.hidden = false;
  void pop.offsetWidth;
  pop.classList.add('open');
  return true;
}

function closeSearchPop(): void {
  if (!pop || pop.hidden) return;
  if (pop.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  pop.classList.remove('open');
  pop.hidden = true;
}

/** A press turns into a drag once it has moved this far, mostly up or down; till then it's a tap. A mouse is steadier than a finger. */
const DRAG_PX = { touch: 10, mouse: 4 } as const;
/** How far, or how fast (px/ms), a drag has to go to change a size: a short flick counts as much as a long pull. */
const FLING_PX = 16;
const FLING_SPEED = 0.35;

/**
 * Make `el` a drag grip: anywhere on it, a press that moves a few px mostly up or down becomes a drag
 * (`move` with how far, from where the drag took hold; `end` with how far, how fast, px/ms, and
 * whether it ended or was cancelled). Taps still reach the buttons inside; the click a drag ends with
 * is swallowed so it doesn't press whatever was under the pointer. Fields and sliders are left alone.
 *
 * Once pressed, the whole window is listened to, not just `el` (owner, 2026-10-26: on a computer the
 * handles didn't work first try): a mouse isn't held to what it pressed the way a finger is, so a quick
 * flick left the panel before it was heard, and a release outside it went unheard and left the grip
 * waiting, ignoring the next press. A press is never stuck now: a new one, or a mouse found with its
 * button up, ends the last.
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
  let slop: number = DRAG_PX.touch;

  const finish = (act: boolean, at: number) => {
    pointer = null;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', cancel, true);
    removeEventListener('blur', lost);
    document.body.classList.remove('is-gripping');
    if (!dragging) return;
    dragging = false;
    swallow = true;
    setTimeout(() => (swallow = false), 0);
    // A pause before letting go is no flick.
    on.end(dy, at - lastT > 90 ? 0 : speed, act);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    // A mouse whose button came up where we couldn't hear it (outside the window): it's over.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      finish(true, e.timeStamp);
      return;
    }
    const raw = e.clientY - y0;
    if (e.timeStamp > lastT) speed = (e.clientY - lastY) / (e.timeStamp - lastT);
    lastY = e.clientY;
    lastT = e.timeStamp;
    if (!dragging) {
      if (Math.abs(raw) < slop || Math.abs(raw) < Math.abs(e.clientX - x0)) return;
      dragging = true;
      document.body.classList.add('is-gripping');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Already released: the window listeners still follow it.
      }
      on.start?.();
    }
    e.preventDefault();
    // Measured from where it took hold, so nothing jumps by the threshold.
    dy = raw - Math.sign(raw) * slop;
    on.move(dy);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === pointer) finish(true, e.timeStamp);
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === pointer) finish(false, e.timeStamp);
  };
  const lost = () => {
    if (pointer != null) finish(false, performance.now());
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('input, select, textarea')) return;
    // A press we never heard end doesn't lock the grip: it ends here, and this one starts.
    if (pointer != null) finish(false, e.timeStamp);
    pointer = e.pointerId;
    slop = e.pointerType === 'mouse' ? DRAG_PX.mouse : DRAG_PX.touch;
    dragging = false;
    x0 = e.clientX;
    y0 = lastY = e.clientY;
    lastT = e.timeStamp;
    speed = 0;
    dy = 0;
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', cancel, true);
    addEventListener('blur', lost);
  });
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

/** How far a sideways swipe on the small banner goes before it swaps the row. */
const SWIPE_PX = 36;

/**
 * A sideways swipe on the small banner swaps its row, the graphs for the forecast and back (owner,
 * 2026-10-29). The row follows the finger a little and fades; a mouse drags the same way, and a
 * trackpad swipes sideways. Up and down stay the banner's own sizing drag.
 */
export function bannerSwipe(swap: () => void): void {
  const cap = $('.cap-wrap');
  let pointer: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let sideways = false;
  let swallow = false;
  const follow = (x: number, ease: boolean) => {
    for (const row of cap.querySelectorAll<HTMLElement>('#cap-sparks, #cap-trend, #cap-week')) {
      row.style.transition = ease ? 'transform 0.2s ease-out, opacity 0.2s ease-out' : 'none';
      row.style.transform = x ? `translateX(${x.toFixed(1)}px)` : '';
      row.style.opacity = x ? (1 - Math.min(0.6, Math.abs(x) / 100)).toFixed(2) : '';
    }
  };
  const finish = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', finish, true);
    removeEventListener('pointercancel', finish, true);
    follow(0, true);
    if (!sideways) return;
    swallow = true;
    setTimeout(() => (swallow = false), 0);
    if (e.type === 'pointerup' && Math.abs(dx) >= SWIPE_PX) swap();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    dx = e.clientX - x0;
    if (!sideways) {
      const dy = e.clientY - y0;
      // Mostly up or down is the sizing drag's, and once that has hold this lets go.
      if (document.body.classList.contains('is-gripping')) return finish(new PointerEvent('pointercancel', { pointerId: e.pointerId }));
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      sideways = true;
    }
    follow(Math.max(-60, Math.min(60, dx * 0.5)), false);
  };
  cap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !cap.classList.contains('is-compact')) return;
    if (pointer != null) return;
    pointer = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    sideways = false;
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', finish, true);
    addEventListener('pointercancel', finish, true);
  });
  // A swipe isn't a tap on the graph or day it started on.
  cap.addEventListener(
    'click',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  // Trackpads: one sideways swipe, one swap.
  let sum = 0;
  let rest = 0;
  cap.addEventListener(
    'wheel',
    (e) => {
      if (!cap.classList.contains('is-compact') || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (e.timeStamp < rest) return;
      sum += e.deltaX;
      if (Math.abs(sum) < 60) return;
      sum = 0;
      rest = e.timeStamp + 700;
      swap();
    },
    { passive: false },
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
/** What a sizing handle offers the rest of the app. */
export interface Sizer {
  /** Back to full size. */
  full(): void;
}

export function bannerHandle(weather: {
  isOpen: () => boolean;
  drag: (dy: number) => void;
  release: (dy: number, speed: number) => void;
  close: () => void;
  mapOnly: () => void;
}): Sizer {
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
      if (dy < -FLING_PX || speed < -FLING_SPEED) {
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
      } else if ((dy > FLING_PX || speed > FLING_SPEED) && compact) {
        set(false);
      }
    },
  });
  // A tap on the handle switches sizes (or puts the weather away).
  handle.addEventListener('click', () => {
    if (weather.isOpen()) weather.close();
    else set(!compact);
  });
  return {
    full: () => {
      if (compact) set(false);
    },
  };
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
export function dockHandle(): Sizer {
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
    end: (dy, speed, act) => {
      panel.style.transition = '';
      panel.style.transform = '';
      if (!act) return;
      if (dy > FLING_PX || speed > FLING_SPEED) set(size + 1);
      else if (dy < -FLING_PX || speed < -FLING_SPEED) set(size - 1);
    },
  });
  handle.addEventListener('click', () => set((size + 1) % DOCK_SIZES.length));
  return {
    full: () => {
      if (size) set(0);
    },
  };
}
