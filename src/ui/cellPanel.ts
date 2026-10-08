import type { StormCell, StormReport } from '../data/stormCells';
import { REPORT_COLOR, THREAT_COLOR } from '../map/stormLayer';
import type { AppState } from '../state';
import { compass16 } from '../util/units';
import { h } from './dom';

const ago = (ms: number) => {
  const min = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};
const feet = (kft: number, s: AppState) => (s.tempUnit === 'F' ? `${Math.round(kft).toLocaleString()},000 ft` : `${(kft * 0.3048).toFixed(1)} km`);
const speed = (mph: number, s: AppState) => (s.windUnit === 'kmh' ? `${Math.round(mph * 1.609344)} km/h` : `${Math.round(mph)} mph`);
const hail = (inches: number, s: AppState) => (s.tempUnit === 'F' ? `${inches.toFixed(2).replace(/0$/, '')} in` : `${Math.round(inches * 25.4)} mm`);

const THREAT_TITLE = {
  tornado: 'Tornado signature',
  rotation: 'Rotating storm',
  hail: 'Large hail likely',
  storm: 'Strong storm',
} as const;

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'storm-stat' }, h('span', { class: 'storm-stat-label' }, label), h('span', { class: 'storm-stat-value' }, value));
}

export const cellTitle = (c: StormCell) => THREAT_TITLE[c.threat];

/** One storm cell: what it is, where it's going, and what the radar measured. */
export function cellPanel(c: StormCell, s: AppState): HTMLElement {
  const moving = !c.moving ? 'Unknown' : c.speedMph < 3 ? 'Nearly still' :`${compass16(c.heading)} at ${speed(c.speedMph, s)}`;
  const notes: string[] = [];
  if (c.tvs) notes.push('The radar sees a tornado vortex signature: strong, tight rotation. Follow any tornado warning for this area.');
  else if (c.meso) notes.push(`The radar sees rotation in this storm (mesocyclone, strength ${c.meso} of 25).`);
  if (c.poh > 0) notes.push(`Hail: ${c.poh}% chance${c.posh ? `, ${c.posh}% chance of severe hail` : ''}${c.hailIn > 0 ? `, up to ${hail(c.hailIn, s)}` : ''}.`);
  return h(
    'div',
    {},
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${THREAT_COLOR[c.threat]}` }), THREAT_TITLE[c.threat]),
    h(
      'div',
      { class: 'storm-stats' },
      stat('Moving', moving),
      stat('Strongest echo', `${Math.round(c.maxDbz)} dBZ`),
      stat('Storm top', feet(c.topKft, s)),
      stat('Hail', c.hailIn > 0 ? hail(c.hailIn, s) : c.poh > 0 ? `${c.poh}% chance` : 'None seen'),
    ),
    ...notes.map((n) => h('p', { class: 'alert-text cell-note' }, n)),
    h('p', { class: 'pop-note' }, `Storm ${c.id} on radar ${c.radar}, ${ago(c.at)}. The dashed line is where it's headed if it keeps its course: half an hour ahead, or an hour with a tick every 15 minutes for storms with hail or rotation.`),
  );
}

export const reportTitle = (r: StormReport) => ({ tornado: 'Tornado report', hail: 'Hail report', wind: 'Wind report', flood: 'Flood report', other: 'Storm report' })[r.kind];

/** One storm report: what was seen, how big, where, when, and by whom. */
export function reportPanel(r: StormReport, s: AppState): HTMLElement {
  const size =
    r.kind === 'hail' && r.magnitude
      ? hail(Number(r.magnitude), s)
      : r.kind === 'wind' && r.magnitude && /MPH|KT/i.test(r.unit)
        ? speed(Number(r.magnitude) * (/KT/i.test(r.unit) ? 1.15078 : 1), s)
        : r.magnitude
          ? `${r.magnitude} ${r.unit}`.trim()
          : '';
  const when = new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return h(
    'div',
    {},
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${REPORT_COLOR[r.kind]}` }), r.type.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())),
    h('div', { class: 'storm-stats' }, stat('Where', r.place || '—'), stat('When', `${when} (${ago(r.at)})`), ...(size ? [stat('Size', size)] : []), stat('Reported by', r.source || 'NWS')),
    r.remark ? h('p', { class: 'alert-text cell-note' }, r.remark) : null,
    h('p', { class: 'pop-note' }, 'A local storm report collected by the National Weather Service.'),
  );
}
