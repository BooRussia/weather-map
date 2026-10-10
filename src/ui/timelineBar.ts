import type { ColorMode } from '../config';
import { offsetTime, relativeLabel, STEP_H, type Timeline } from '../data/timeline';
import { PTYPE_LEGEND, RADAR_LEGEND, VELOCITY_LEGEND, type PrecipType } from '../map/radarPalette';
import { $, h, svg } from './dom';
import { pauseIcon, playIcon } from './icons';

/** Playback speed in frames per second (15-minute frames: one hour per second). */
const FRAMES_PER_SECOND = 4;
/** The short autoplay loop runs at half speed, so two hours take four seconds, not two. */
const AUTO_FRAMES_PER_SECOND = 2;
/** Frames requested ahead of the playhead. */
const PREFETCH = 8;
/** After a stall, resume once this many frames ahead have loaded, so playback doesn't stutter. */
const RESUME_FRAMES = 3;
/** Stop waiting on a frame after this long (a hung tile) and show what has loaded, seconds. */
const MAX_WAIT_S = 6;
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
  /** The weather map shown, for the label when the radar is off ("Temperature · +2 h"). */
  mapLabel: string | null;
  /** A single radar is shown ("KMOB"), and whether it's velocity. */
  site: string | null;
  velocity: boolean;
  /** Rain, snow, mix, and ice colored apart (Color mode): the legend shows all four. */
  precipType: boolean;
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
  /** Autoplay's loop, in frames; null for ordinary playback (to the end, back to where it started). */
  private loopWindow: { from: number; to: number } | null = null;
  private state: TimelineBarState = { colorMode: 'color', radarOn: true, mapLabel: null, site: null, velocity: false, precipType: true };
  /** The playhead, continuously (hours from now), for layers that blend in time themselves. */
  onPlayhead: ((offsetH: number) => void) | null = null;

  constructor(
    timeline: Timeline,
    private readonly frames: Frames,
    private readonly onTime: (offset: number) => void,
  ) {
    $('#tl-play').addEventListener('click', () => this.toggle());
    this.range.step = 'any';
    this.range.addEventListener('input', () => {
      // Read the drag first: pausing redraws the slider at the playhead.
      const q = Math.round(Number(this.range.value) / STEP_H);
      this.pause();
      this.goTo(q);
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
    const clamp = (q: number) => Math.max(this.minQ, Math.min(this.maxQ, q));
    if (this.pos !== 0) this.pos = clamp(this.pos - shift);
    if (!this.loopWindow) this.loopFrom = clamp(this.loopFrom - shift);
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
    this.loopWindow = null;
    // Scrubbed and pressed play before that frame loaded: play from there.
    if (this.pending != null) this.pos = this.pending;
    this.pending = null;
    // From the end, start over from the oldest frame; otherwise loop from here.
    if (Math.round(this.pos) >= this.maxQ) this.pos = this.minQ;
    this.pos = Math.round(this.pos);
    this.loopFrom = this.pos;
    this.start();
  }

  /**
   * Loop from `fromH` to `toH` hours (the end clamps to the forecast available,
   * and grows if more arrives) until the person uses the timeline.
   */
  autoplay(fromH: number, toH: number): void {
    if (this.playing) return;
    this.pending = null;
    const from = Math.max(this.minQ, Math.round(fromH / STEP_H));
    this.loopWindow = { from, to: Math.round(toH / STEP_H) };
    this.pos = from;
    this.loopFrom = from;
    this.start();
  }

  private start(): void {
    this.hold = 0;
    this.waited = 0;
    this.playing = true;
    this.drawPlay();
    this.last = performance.now();
    this.loop();
  }

  /** Stop playing. Also ends autoplay: any use of the timeline does. */
  pause(): void {
    this.loopWindow = null;
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

  /** Show the frame nearest `offsetH` hours from the current 15-minute mark (clamped to the timeline). */
  show(offsetH: number): void {
    this.pause();
    this.goTo(Math.round(offsetH / STEP_H));
  }

  render(s: TimelineBarState): void {
    this.state = s;
    // Velocity always shows its scale (toward green, away red); reflectivity in Color mode.
    const legend = $('#radar-legend');
    legend.hidden = !(s.radarOn && (s.velocity || s.colorMode === 'color'));
    const bar = (colors: string[]) => {
      const i = h('i');
      i.style.background = `linear-gradient(to right, ${colors.join(', ')})`;
      return i;
    };
    const typed = s.precipType && !s.velocity && s.colorMode === 'color';
    legend.classList.toggle('is-types', typed);
    if (typed) {
      // The Weather Channel's way: each type its own little scale.
      const types: [PrecipType, string][] = [
        ['rain', 'Rain'],
        ['snow', 'Snow'],
        ['mix', 'Mix'],
        ['ice', 'Ice'],
      ];
      legend.replaceChildren(...types.map(([t, label]) => h('span', { class: 'legend-type' }, h('span', {}, label), bar(PTYPE_LEGEND[t]))));
      legend.setAttribute('aria-label', 'Radar scales: rain green to red, snow light to dark blue, mix pink, ice purple; darker is heavier');
    } else {
      legend.replaceChildren(
        h('span', {}, s.velocity ? 'Toward' : 'Light'),
        bar(s.velocity ? VELOCITY_LEGEND : RADAR_LEGEND),
        h('span', {}, s.velocity ? 'Away' : 'Heavy'),
      );
      legend.setAttribute(
        'aria-label',
        s.velocity ? 'Velocity scale: green toward the radar, red away, brighter is faster' : 'Radar intensity scale: green light, yellow and orange moderate, red heavy',
      );
    }
    this.label(Math.round(this.pos), false);
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
    this.shownQ = Number.NaN; // the label no longer matches the frame on screen
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

    const end = this.loopWindow ? Math.min(this.loopWindow.to, this.maxQ) : this.maxQ;
    const a = Math.floor(this.pos + 1e-6);
    const next = a + 1;
    if (next > end) {
      this.pos = end;
      this.apply();
      this.hold = HOLD_S;
      return;
    }
    this.frames.prefetch(next * STEP_H, 1, PREFETCH);
    if (!this.loadedAhead(next, this.waited > 0 ? RESUME_FRAMES : 1) && this.waited < MAX_WAIT_S) {
      // Wait for the network rather than fade into a half-loaded frame.
      this.waited += dt;
      if (this.waited > BUFFER_NOTE_S) $('#tl-kind').textContent = this.state.radarOn ? 'Loading radar' : 'Loading';
      return;
    }
    if (this.waited > BUFFER_NOTE_S) this.shownQ = Number.NaN; // restore the label
    this.waited = 0;
    // Run on past a frame into the next when it's loaded, keeping the time left over (stopping on
    // every frame would cost a sliver of motion four times a second: a faint, steady hitch).
    let pos = this.pos + dt * (this.loopWindow ? AUTO_FRAMES_PER_SECOND : FRAMES_PER_SECOND);
    if (pos > next && !(next + 1 <= end && this.frames.ready((next + 1) * STEP_H))) pos = next;
    this.pos = Math.min(pos, next + 1);
    this.apply();
  };

  /** The `count` frames from `q` (stopping at the end) have loaded. */
  private loadedAhead(q: number, count: number): boolean {
    for (let k = q; k < q + count && k <= this.maxQ; k++) if (!this.frames.ready(k * STEP_H)) return false;
    return true;
  }

  /** Push the playhead to the map (crossfade), the slider, and the label. */
  private apply(): void {
    const a = Math.floor(this.pos + 1e-6);
    const f = this.pos - a;
    this.frames.blend(a * STEP_H, (a + 1) * STEP_H, f < 1e-3 ? 0 : f);
    this.range.value = String(this.pos * STEP_H);
    this.onPlayhead?.(this.pos * STEP_H);
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
    const radar = this.state.radarOn;
    // Radar off: name what the timeline is moving (the weather map, or the wind).
    // One radar chosen: its call sign for the past and now (the forecast is still the model's).
    const site = this.state.site;
    const kind = radar
      ? offset > 0
        ? 'Forecast radar'
        : site
          ? `${site} ${this.state.velocity ? 'velocity' : 'reflectivity'}`
          : offset === 0
            ? 'Live radar'
            : 'Radar'
      : (this.state.mapLabel ?? 'Wind');
    $('#tl-time').textContent = offset === 0 ? 'Now' : clock(at);
    $('#tl-kind').textContent = loading ? (radar ? 'Loading radar' : 'Loading') : offset === 0 ? kind : `${kind} · ${relativeLabel(offset)}`;
    this.range.setAttribute(
      'aria-valuetext',
      offset === 0 ? `Now, ${kind.toLowerCase()}` : `${clock(at)}, ${kind.toLowerCase()}, ${relativeLabel(offset)}`,
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
