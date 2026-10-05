import type { ColorMode } from '../config';
import { offsetTime, relativeLabel, type Timeline } from '../data/timeline';
import { $, h, svg } from './dom';
import { pauseIcon, playIcon } from './icons';

/**
 * NWS reflectivity scale, light → heavy, sampled from the live mosaic. Only
 * the legend uses it (DESIGN.md imagery exception), only in Color mode.
 */
export const RADAR_SCALE = ['#4666a4', '#5eadcf', '#48d68f', '#42d810', '#ffc100', '#ff9800', '#ff2f00'];

const PLAY_MS = 650;
/** Ticks to hold on the last frame before looping. */
const HOLD_TICKS = 3;

export interface TimelineBarState {
  colorMode: ColorMode;
  radarOn: boolean;
}

/** "Tue 3 PM" in the viewer's time zone. */
function clock(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric' });
}

/**
 * The play bar: scrub or play from 24 hours ago into the HRRR forecast.
 * Owns the range input and playback; tells the app which offset to show.
 */
export class TimelineBar {
  private readonly range = $<HTMLInputElement>('#tl-range');
  private timeline: Timeline;
  private timer = 0;
  private hold = 0;
  private loopFrom = 0;

  constructor(
    timeline: Timeline,
    private readonly onOffset: (offset: number, direction: 1 | -1) => void,
  ) {
    this.timeline = timeline;
    $('#radar-legend-bar').style.background = `linear-gradient(to right, ${RADAR_SCALE.join(', ')})`;
    $('#tl-play').addEventListener('click', () => this.toggle());
    this.range.addEventListener('input', () => {
      this.pause();
      this.apply(Number(this.range.value), 1);
    });
    this.setTimeline(timeline);
  }

  get offset(): number {
    return Number(this.range.value);
  }

  get playing(): boolean {
    return this.timer !== 0;
  }

  /** New hour or new HRRR run: keep the same absolute time on screen when possible. */
  setTimeline(t: Timeline): void {
    const shift = this.timeline ? (t.base - this.timeline.base) / 3_600_000 : 0;
    const keep = Math.max(t.minOffset, Math.min(t.maxOffset, this.offset - shift));
    this.timeline = t;
    this.range.min = String(t.minOffset);
    this.range.max = String(t.maxOffset);
    this.range.value = String(this.offset === 0 ? 0 : keep);
    this.drawScale();
    this.apply(this.offset, 1);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.playing) return;
    // Loop from wherever playback starts to the end; from the end, start over from the oldest hour.
    if (this.offset >= this.timeline.maxOffset) this.apply(this.timeline.minOffset, 1);
    this.loopFrom = this.offset;
    this.hold = 0;
    this.timer = window.setInterval(() => this.tick(), PLAY_MS);
    this.drawPlay();
  }

  pause(): void {
    if (!this.playing) return;
    clearInterval(this.timer);
    this.timer = 0;
    this.drawPlay();
  }

  /** Step one hour (keyboard). */
  step(direction: 1 | -1): void {
    this.pause();
    const next = Math.max(this.timeline.minOffset, Math.min(this.timeline.maxOffset, this.offset + direction));
    this.apply(next, direction);
  }

  now(): void {
    this.pause();
    this.apply(0, 1);
  }

  render(s: TimelineBarState): void {
    $('#radar-legend').hidden = !(s.colorMode === 'color' && s.radarOn);
  }

  private tick(): void {
    if (this.offset >= this.timeline.maxOffset) {
      if (this.hold++ < HOLD_TICKS) return;
      this.hold = 0;
      this.apply(this.loopFrom, 1);
      return;
    }
    this.apply(this.offset + 1, 1);
  }

  private apply(offset: number, direction: 1 | -1): void {
    this.range.value = String(offset);
    const t = this.timeline;
    const at = offsetTime(t, offset);
    const kind = offset === 0 ? 'Live radar' : offset < 0 ? 'Radar' : 'Forecast radar';
    $('#tl-time').textContent = offset === 0 ? 'Now' : clock(at);
    $('#tl-kind').textContent = offset === 0 ? kind : `${kind} · ${relativeLabel(offset)}`;
    this.range.setAttribute('aria-valuetext', offset === 0 ? 'Now, live radar' : `${clock(at)}, ${kind.toLowerCase()}, ${relativeLabel(offset)}`);
    // Past track vs forecast track, split at "now".
    const span = t.maxOffset - t.minOffset || 1;
    const nowPct = ((0 - t.minOffset) / span) * 100;
    this.range.style.setProperty('--now', `${nowPct}%`);
    this.onOffset(offset, direction);
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
        const el = h('span', { class: m === 0 ? 'is-now' : undefined }, m === 0 ? 'Now' : relativeLabel(m));
        el.style.left = `${((m - t.minOffset) / span) * 100}%`;
        return el;
      }),
    );
    this.drawPlay();
  }
}
