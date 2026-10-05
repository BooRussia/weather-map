import type { ColorMode } from '../config';
import type { LoopFrame } from '../map/radarLoop';
import { $, h, svg } from './dom';
import { pauseIcon, playIcon } from './icons';

/**
 * NWS reflectivity scale, light → heavy, sampled from the live mosaic. Only
 * the legend uses it (DESIGN.md imagery exception), only in Color mode.
 */
export const RADAR_SCALE = ['#4666a4', '#5eadcf', '#48d68f', '#42d810', '#ffc100', '#ff9800', '#ff2f00'];

export interface RadarBarState {
  rainOn: boolean;
  colorMode: ColorMode;
  playing: boolean;
  frame: LoopFrame | null;
}

const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Build the legend gradient once. */
export function initRadarBar(): void {
  const bar = $('#radar-legend-bar');
  bar.style.background = `linear-gradient(to right, ${RADAR_SCALE.join(', ')})`;
}

export function renderRadarBar(s: RadarBarState): void {
  $('#radar-bar').hidden = !s.rainOn;
  if (!s.rainOn) return;

  const play = $('#radar-play');
  play.replaceChildren(svg(s.playing ? pauseIcon : playIcon));
  play.setAttribute('aria-label', s.playing ? 'Pause radar loop' : 'Play the last hour of radar');
  play.setAttribute('aria-pressed', String(s.playing));

  $('#radar-time').textContent = s.frame ? timeLabel(s.frame.time) : 'Radar now';

  const ticks = $('#radar-ticks');
  if (s.frame) {
    const f = s.frame;
    ticks.replaceChildren(
      ...Array.from({ length: f.count }, (_, i) => h('i', { class: i === f.index ? 'on' : undefined })),
    );
  } else {
    ticks.replaceChildren();
  }

  $('#radar-legend').hidden = s.colorMode !== 'color';
}
