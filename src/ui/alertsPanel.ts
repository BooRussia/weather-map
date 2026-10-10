import { alertColor } from '../data/alertColors';
import type { Alert } from '../data/nws';
import type { AlertItem } from '../map/alertAreas';
import { alertUntil } from './areaCard';
import { h, svg } from './dom';
import { chevronIcon } from './icons';

export interface AlertsHooks {
  /** Frame these alerts on the map. */
  frame(items: AlertItem[]): void;
  /** Show one type's alerts. */
  openType(type: string): void;
  /** Show one alert's full text. */
  openAlert(item: AlertItem): void;
  back(): void;
  /** The alert's full record (cached), for its area names. */
  describe(item: AlertItem): Promise<Alert>;
}

/** Most dangerous first: life-threatening, fast-moving hazards lead the list. */
const DANGER = ['TO', 'EW', 'SV', 'FF', 'SS', 'HU', 'TY', 'TR', 'BZ', 'IS', 'WS', 'FA', 'FL', 'XH', 'EH', 'HT', 'HW', 'FW', 'DS'];
const danger = (phenom: string) => {
  const i = DANGER.indexOf(phenom);
  return i < 0 ? DANGER.length : i;
};

/** "KTBW" → "NWS Tampa Bay" would need a table; the office code is what NWS prints, so keep it. */
const office = (wfo: string) => (wfo ? `NWS ${wfo.replace(/^K/, '')}` : 'NWS');

function swatch(item: AlertItem): HTMLElement {
  return h('span', { class: 'alert-swatch', style: `background:${alertColor(item.props.phenom, item.props.sig)}` });
}

function row(label: string, sub: string, mark: HTMLElement, onClick: () => void): HTMLElement {
  const b = h('button', { type: 'button', class: 'row alert-row' }, mark, h('span', { class: 'row-label' }, h('span', { class: 'alert-name' }, label), h('span', { class: 'row-sub' }, sub)), svg(chevronIcon));
  b.addEventListener('click', onClick);
  return b;
}

/** Every alert type in view: warnings first, then watches; each row is one type with its count. */
export function alertsList(items: AlertItem[], hooks: AlertsHooks): HTMLElement {
  if (!items.length) return h('p', { class: 'pop-note' }, 'No warnings or watches in view. Move or zoom out the map to see more.');
  const types = new Map<string, AlertItem[]>();
  for (const a of items) {
    const list = types.get(a.props.prod_type) ?? [];
    list.push(a);
    types.set(a.props.prod_type, list);
  }
  const section = (sig: 'W' | 'A', title: string) => {
    const rows = [...types.entries()]
      .filter(([, list]) => list[0].props.sig === sig)
      .sort(([, a], [, b]) => danger(a[0].props.phenom) - danger(b[0].props.phenom));
    if (!rows.length) return [];
    const count = rows.reduce((n, [, list]) => n + list.length, 0);
    return [
      h('p', { class: 'group-label' }, `${title} · ${count}`),
      h(
        'div',
        { class: 'group' },
        ...rows.map(([type, list]) => {
          const soonest = list.reduce((a, b) => (Date.parse(b.props.expiration) < Date.parse(a.props.expiration) ? b : a));
          // Hurricane alerts run until NWS ends them: no "first ends" to give.
          const ends = alertUntil(soonest.props);
          const sub =
            list.length > 1
              ? `${list.length} in view${ends.startsWith('until ') ? ` · first ends ${ends.slice('until '.length)}` : ''}`
              : `${office(list[0].props.wfo)} · ${alertUntil(list[0].props)}`;
          return row(type, sub, swatch(list[0]), () => {
            hooks.frame(list);
            if (list.length === 1) hooks.openAlert(list[0]);
            else hooks.openType(type);
          });
        }),
      ),
    ];
  };
  return h('div', {}, ...section('W', 'Warnings'), ...section('A', 'Watches'), h('p', { class: 'pop-note' }, 'From the National Weather Service. Tap one to see it on the map.'));
}

function backRow(label: string, hooks: AlertsHooks): HTMLElement {
  const b = h('button', { type: 'button', class: 'alert-back' }, svg(chevronIcon), label);
  b.addEventListener('click', () => hooks.back());
  return b;
}

/** Rows that would look alike get their area names as they load (only the first few: each is a request). */
const DESCRIBE_ROWS = 15;

/** One type's alerts (e.g. eight flood warnings), each opening its text. */
export function alertsOfType(type: string, items: AlertItem[], hooks: AlertsHooks): HTMLElement {
  const list = items.filter((a) => a.props.prod_type === type).sort((a, b) => Date.parse(a.props.expiration) - Date.parse(b.props.expiration));
  return h(
    'div',
    {},
    backRow('All alerts', hooks),
    h(
      'div',
      { class: 'group' },
      ...list.map((a, i) => {
        const r = row(office(a.props.wfo), alertUntil(a.props), swatch(a), () => {
          hooks.frame([a]);
          hooks.openAlert(a);
        });
        if (i < DESCRIBE_ROWS) {
          void hooks
            .describe(a)
            .then((full) => {
              if (!full.areaDesc) return;
              r.querySelector('.alert-name')!.textContent = full.areaDesc;
              r.querySelector('.row-sub')!.textContent = `${office(a.props.wfo)} · ${alertUntil(a.props)}`;
            })
            .catch(() => {});
        }
        return r;
      }),
    ),
  );
}

/** One alert: its headline, where, until when, and the full NWS text (loaded on open). */
export function alertDetail(item: AlertItem, alert: Alert | null, failed: boolean, hooks: AlertsHooks): HTMLElement {
  const p = item.props;
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map((t) => h('p', { class: 'alert-text' }, t.replace(/\s*\n\s*/g, ' ').trim()));
  const show = h('button', { type: 'button', class: 'trip-go alert-show' }, 'Show on map');
  show.addEventListener('click', () => hooks.frame([item]));
  return h(
    'div',
    {},
    backRow('All alerts', hooks),
    h('p', { class: 'alert-title' }, swatch(item), alert?.headline ?? p.prod_type),
    h('p', { class: 'pop-note' }, `${office(p.wfo)} · ${alertUntil(p)}`),
    alert?.areaDesc ? h('p', { class: 'alert-area' }, alert.areaDesc) : null,
    alert
      ? h('div', {}, ...paragraphs(alert.description), ...(alert.instruction ? [h('p', { class: 'group-label' }, 'What to do'), ...paragraphs(alert.instruction)] : []))
      : h('p', { class: 'pop-note' }, failed ? 'The full text couldn’t load. It’s on weather.gov.' : 'Loading the full text…'),
    show,
  );
}
