import type { ColorMode } from '../config';
import { offsetTime, relativeLabel, STEP_H, type Timeline } from '../data/timeline';
import { $, h, svg } from './dom';
import { pauseIcon, playIcon } from './icons';

/**
 * NWS reflectivity scale, light → heavy, sampled from the live mosaic. Only
 * the legend uses it (DESIGN.md imagery exception), only in Color mode.
 */
export const RADAR_SCALE = ['#4666a4', '#5eadcf', '#48d68f', '#42d810', '#ffc100', '#ff9800', '#ff2f00'];

/** Playback speed in frames per second (15-minute frames: one hour per second). */
const FRAMES_PER_SECOND = 4;
/** Frames requested ahead of the playhead. */
const PREFETCH = 6;
/** Pause on the last frame before looping, seconds. */
const HOLD_S = 1.2;
/** Say "Loading radar" if playback waits on the network longer than this, seconds. */
const BUFFER_NOTE_S = 0.5;
/** A scrubbed-to frame shows when loaded, or after this long regardless, ms. */
const SCRUB_WAIT_MS = 2500;

/** What the bar needs from the map: readiness, preloading, and a crossfade. */
export interface Frames {
  ready(offset: number): boolean;
  prefetch(offset: number, direction: 1 | -1, count: number): void;
  blend(a: number, b: number, f: number): void;
}

export interface TimelineBarState {
  colorMode: ColorMode;
  radarOn: boolean;
}

/** "Tue 3:15 PM" in the viewer's time zone. */
function clock(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * The play bar. Playback runs on requestAnimationFrame: the playhead moves
 * continuously between 15-minute frames and the map crossfades them, so
 * storms glide instead of jumping. It never advances onto a frame that
 * hasn't loaded, so there are no gaps; on a slow network it waits instead.
 */
export class TimelineBar {
  private readonly range = $<HTMLInputElement>('#tl-range');
  private timeline!: Timeline;
  /** Playhead in frames (15-minute units) from now; fractional while crossfading. */
  private pos = 0;
  private minQ = 0;
  private maxQ = 0;
  private raf = 0;
  private playing = false;
  private last = 0;
  private hold = 0;
  private waited = 0;
  private loopFrom = 0;
  private shownQ = Number.NaN;
  private pending: number | null = null;
  private pendingSince = 0;

  constructor(
    timeline: Timeline,
    private readonly frames: Frames,
    private readonly onTime: (offset: number) => void,
  ) {
    $('#radar-legend-bar').style.background = `linear-gradient(to right, ${RADAR_SCALE.join(', ')})`;
    $('#tl-play').addEventListener('click', () => this.toggle());
    this.range.step = 'any';
    this.range.addEventListener('input', () => {
      this.pause();
      this.goTo(Math.round(Number(this.range.value) / STEP_H));
    });
    this.setTimeline(timeline);
    this.drawPlay();
  }

  /** Current frame offset in hours (whole frames). */
  get offset(): number {
    return Math.round(this.pos) * STEP_H;
  }

  setTimeline(t: Timeline): void {
    const shift = this.timeline ? Math.round((t.base - this.timeline.base) / (STEP_H * 3_600_000)) : 0;
    this.timeline = t;
    this.minQ = Math.round(t.minOffset / STEP_H);
    this.maxQ = Math.round(t.maxOffset / STEP_H);
    // Keep the same moment on screen; "now" stays now.
    if (this.pos !== 0) this.pos = Math.max(this.minQ, Math.min(this.maxQ, this.pos - shift));
    this.range.min = String(t.minOffset);
    this.range.max = String(t.maxOffset);
    const span = t.maxOffset - t.minOffset || 1;
    this.range.style.setProperty('--now', `${((0 - t.minOffset) / span) * 100}%`);
    this.drawScale();
    this.shownQ = Number.NaN;
    this.apply();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.playing) return;
    this.pending = null;
    // From the end, start over from the oldest frame; otherwise loop from here.
    if (Math.round(this.pos) >= this.maxQ) this.pos = this.minQ;
    this.pos = Math.round(this.pos);
    this.loopFrom = this.pos;
    this.hold = 0;
    this.waited = 0;
    this.playing = true;
    this.drawPlay();
    this.last = performance.now();
    this.loop();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    // Settle on a whole frame. Playback only advances toward loaded frames, so it's ready.
    this.pos = Math.round(this.pos);
    this.apply();
    this.drawPlay();
  }

  /** Step one hour (keyboard). */
  step(direction: 1 | -1): void {
    this.pause();
    this.goTo(Math.round(this.pos) + direction / STEP_H);
  }

  now(): void {
    this.pause();
    this.goTo(0);
  }

  render(s: TimelineBarState): void {
    $('#radar-legend').hidden = !(s.colorMode === 'color' && s.radarOn);
  }

  /** Jump to a frame; the current frame stays on screen until the new one has loaded. */
  private goTo(q: number): void {
    q = Math.max(this.minQ, Math.min(this.maxQ, q));
    this.frames.prefetch(q * STEP_H, 1, 2);
    if (this.frames.ready(q * STEP_H)) {
      this.pending = null;
      this.pos = q;
      this.apply();
      return;
    }
    // Show where we're going right away; swap the picture when it's loaded.
    this.pending = q;
    this.pendingSince = performance.now();
    this.range.value = String(q * STEP_H);
    this.label(q, true);
    this.loop();
  }

  private loop(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    if (this.pending != null) {
      if (this.frames.ready(this.pending * STEP_H) || now - this.pendingSince > SCRUB_WAIT_MS) {
        this.pos = this.pending;
        this.pending = null;
        this.apply();
      } else {
        this.loop();
      }
      return;
    }
    if (!this.playing) return;
    this.loop();

    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.pos = this.loopFrom;
        this.apply();
      }
      return;
    }

    const a = Math.floor(this.pos + 1e-6);
    const next = a + 1;
    if (next > this.maxQ) {
      this.pos = this.maxQ;
      this.apply();
      this.hold = HOLD_S;
      return;
    }
    this.frames.prefetch(next * STEP_H, 1, PREFETCH);
    if (!this.frames.ready(next * STEP_H)) {
      // Wait for the network rather than fade into a half-loaded frame.
      this.waited += dt;
      if (this.waited > BUFFER_NOTE_S) $('#tl-kind').textContent = 'Loading radar';
      return;
    }
    if (this.waited > BUFFER_NOTE_S) this.shownQ = Number.NaN; // restore the label
    this.waited = 0;
    this.pos = Math.min(this.pos + dt * FRAMES_PER_SECOND, next);
    this.apply();
  };

  /** Push the playhead to the map (crossfade), the slider, and the label. */
  private apply(): void {
    const a = Math.floor(this.pos + 1e-6);
    const f = this.pos - a;
    this.frames.blend(a * STEP_H, (a + 1) * STEP_H, f < 1e-3 ? 0 : f);
    this.range.value = String(this.pos * STEP_H);
    const q = Math.round(this.pos);
    if (q !== this.shownQ) {
      this.shownQ = q;
      this.label(q, false);
      this.onTime(q * STEP_H);
    }
  }

  private label(q: number, loading: boolean): void {
    const offset = q * STEP_H;
    const at = offsetTime(this.timeline, offset);
    const kind = offset === 0 ? 'Live radar' : offset < 0 ? 'Radar' : 'Forecast radar';
    $('#tl-time').textContent = offset === 0 ? 'Now' : clock(at);
    $('#tl-kind').textContent = loading ? 'Loading radar' : offset === 0 ? kind : `${kind} · ${relativeLabel(offset)}`;
    this.range.setAttribute(
      'aria-valuetext',
      offset === 0 ? 'Now, live radar' : `${clock(at)}, ${kind.toLowerCase()}, ${relativeLabel(offset)}`,
    );
  }

  private drawPlay(): void {
    const btn = $('#tl-play');
    btn.replaceChildren(svg(this.playing ? pauseIcon : playIcon));
    btn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play radar timeline');
    btn.setAttribute('aria-pressed', String(this.playing));
  }

  private drawScale(): void {
    const t = this.timeline;
    const span = t.maxOffset - t.minOffset || 1;
    const marks = [t.minOffset, Math.round(t.minOffset / 2), 0, t.maxOffset > 0 ? t.maxOffset : null].filter(
      (m): m is number => m != null,
    );
    $('#tl-scale').replaceChildren(
      ...marks.map((m) => {
        // Scale labels round to whole hours; the slider itself is exact.
        const el = h('span', { class: m === 0 ? 'is-now' : undefined }, m === 0 ? 'Now' : relativeLabel(Math.round(m)));
        el.style.left = `${((m - t.minOffset) / span) * 100}%`;
        return el;
      }),
    );
  }
}
