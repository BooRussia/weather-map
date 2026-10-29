import { FLOOD_COLOR, FLOOD_WORD, type Fire, type Gauge } from '../data/hazards';
import type { AppState } from '../state';
import { h } from './dom';

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'storm-stat' }, h('span', { class: 'storm-stat-label' }, label), h('span', { class: 'storm-stat-value' }, value));
}

const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
const area = (acres: number, s: AppState) =>
  s.tempUnit === 'F' ? `${Math.round(acres).toLocaleString()} acres` : `${Math.round(acres * 0.404686).toLocaleString()} ha`;

/** One wildfire: how big, how contained, since when, why, and who's on it. */
export function firePanel(f: Fire, s: AppState): HTMLElement {
  return h(
    'div',
    {},
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: 'background:#ff6b2c' }), f.contained != null ? `${Math.round(f.contained)}% contained` : 'Containment not reported'),
    h(
      'div',
      { class: 'storm-stats' },
      stat('Size', f.acres != null ? area(f.acres, s) : 'Not reported'),
      stat('Found', f.found ? day(f.found) : '—'),
      stat('Cause', f.cause || 'Under investigation'),
      stat('Crews', f.personnel ? `${f.personnel.toLocaleString()} people` : '—'),
    ),
    h('p', { class: 'pop-note' }, `From the National Interagency Fire Center${f.updated ? `, updated ${day(f.updated)}` : ''}. The orange outline is the fire's last mapped edge.`),
  );
}

/** One river gauge: the river now against its flood stages, and the NWS page with its forecast. */
export function gaugePanel(g: Gauge): HTMLElement {
  const v = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} ${g.units}`);
  return h(
    'div',
    {},
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${FLOOD_COLOR[g.status]}` }), FLOOD_WORD[g.status]),
    h(
      'div',
      { class: 'storm-stats' },
      stat('River now', v(g.observed)),
      stat('Flood stage', v(g.flood)),
      stat('Moderate', v(g.moderate)),
      stat('Major', v(g.major)),
    ),
    g.url ? h('p', { class: 'pop-note' }, h('a', { href: g.url, target: '_blank', rel: 'noopener' }, 'Forecast and history at water.noaa.gov')) : null,
    h('p', { class: 'pop-note' }, `National Water Prediction Service${g.observedAt ? `, observed ${g.observedAt.slice(5, 16).replace(' ', ' at ')} UTC` : ''}.`),
  );
}
