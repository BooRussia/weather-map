import { alertColor } from '../data/alertColors';
import type { OutlookDay, OutlookKind } from '../data/outlooks';
import type { AlertItem } from '../map/alertAreas';
import { h, svg } from './dom';
import { chevronIcon } from './icons';

/** An outlook area under a tap: its risk, and which outlook and day. */
export interface OutlookHit {
  name: string;
  rank: number;
  fill: string;
  kind: OutlookKind;
  day: OutlookDay;
}

const DAY: Record<OutlookDay, string> = { 1: 'Today', 2: 'Tomorrow', 3: 'Day 3' };
/** Tropical alerts run until further notice (no end time). */
const TROPICAL = new Set(['TR', 'HU', 'SS', 'TY']);

/** "until 9:00 PM", "until Sat 8:00 AM", or "in effect" when there's no end. */
export function alertUntil(p: AlertItem['props'], now = Date.now()): string {
  const end = Date.parse(p.ends?.trim() || '') || (TROPICAL.has(p.phenom) ? NaN : Date.parse(p.expiration?.trim() || ''));
  if (!Number.isFinite(end)) return 'in effect';
  const sameDay = new Date(end).toDateString() === new Date(now).toDateString();
  return `until ${new Date(end).toLocaleString([], { weekday: sameDay ? undefined : 'short', hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * The card for a tap on a watch, warning, or outlook area: every alert there
 * (warnings first), each in its NWS color with when it ends and a way into
 * its full text, then the outlook risk for that day.
 */
export function areaCard(alerts: AlertItem[], outlook: OutlookHit | null, open: (a: AlertItem) => void): HTMLElement {
  const rows: HTMLElement[] = alerts.map((a) => {
    const row = h(
      'button',
      { type: 'button', class: 'tip-row' },
      h('span', { class: 'tip-swatch', style: `background:${alertColor(a.props.phenom, a.props.sig)}` }),
      h('span', { class: 'tip-row-text' }, h('span', { class: 'tip-alert-name' }, a.props.prod_type), h('span', { class: 'tip-row-sub' }, alertUntil(a.props))),
      svg(chevronIcon),
    );
    row.addEventListener('click', () => open(a));
    return row;
  });
  if (outlook) {
    const what = outlook.kind === 'severe' ? (outlook.name === 'Thunderstorms' ? 'Thunderstorms possible' : `${outlook.name} of severe storms`) : `${outlook.name} of flash flooding`;
    rows.push(
      h(
        'div',
        { class: 'tip-row is-static' },
        h('span', { class: 'tip-swatch', style: `background:${outlook.fill}` }),
        h(
          'span',
          { class: 'tip-row-text' },
          h('span', { class: 'tip-alert-name' }, what),
          h('span', { class: 'tip-row-sub' }, `${DAY[outlook.day]} · ${outlook.kind === 'severe' ? 'SPC' : 'WPC'} outlook`),
        ),
      ),
    );
  }
  // Rows straight under the body, so each settles in on its own beat.
  return h('div', { class: 'tip-body tip-list' }, ...rows);
}
