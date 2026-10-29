import { ago, ceilingFt, CATEGORY_COLOR, CATEGORY_WORD, METAR_OLD_MIN, RELAY_LATE_MIN, tafLines, windText, zulu, type Metar, type Taf } from '../data/aviation';
import { h } from './dom';

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'storm-stat' }, h('span', { class: 'storm-stat-label' }, label), h('span', { class: 'storm-stat-value' }, value));
}

/** "18:49Z · 2:49 PM": the time pilots use, and the device's own. */
const when = (ms: number) => `${zulu(ms)} · ${new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

/** The legal line on every aviation view (owner, 2026-10-29: it matters, legally and for trust). */
export const BRIEFING_NOTE =
  'For situational awareness only. It supplements, and doesn’t replace, an official preflight briefing: 1800wxbrief.com, or Flight Service at 1-800-WX-BRIEF.';

export const airportTitle = (m: Metar) => (m.name ? `${m.id} · ${m.name}` : m.id);

/**
 * One airport: its flight category, the METAR decoded and raw, then its TAF a change group a line;
 * every time in Zulu and local with its age, the source, and a warning when anything is old.
 * `taf`: undefined while TAFs load, null when the airport has none.
 */
export function airportPanel(m: Metar, taf: Taf | null | undefined, relayed: number, now = Date.now()): HTMLElement {
  const ceiling = ceilingFt(m.sky, m.vertVisFt);
  const warnings = [
    now - m.obs > METAR_OLD_MIN * 60_000 ? `This report is ${ago(m.obs, now).replace(' ago', '')} old; the station may have stopped reporting.` : null,
    now - relayed > RELAY_LATE_MIN * 60_000 ? `The relay last ran ${ago(relayed, now)}; newer reports may exist.` : null,
  ].filter(Boolean) as string[];
  return h(
    'div',
    { class: 'airport' },
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${CATEGORY_COLOR[m.category]}` }), CATEGORY_WORD[m.category]),
    ...warnings.map((w) => h('p', { class: 'airport-warn' }, w)),
    h(
      'div',
      { class: 'storm-stats' },
      stat('Wind', windText(m)),
      stat('Visibility', m.visSM ? `${m.visSM} SM` : 'Not reported'),
      stat('Ceiling', ceiling != null ? `${ceiling.toLocaleString()} ft` : 'None'),
      stat('Clouds', m.sky || (m.raw.includes('CLR') || m.raw.includes('SKC') ? 'Clear' : 'Not reported')),
      stat('Temp / dew', m.tempC != null ? `${Math.round(m.tempC)}° / ${m.dewC != null ? Math.round(m.dewC) : '–'}°C (${cToF(m.tempC)}° / ${m.dewC != null ? cToF(m.dewC) : '–'}°F)` : 'Not reported'),
      stat('Altimeter', m.altimInHg != null ? `${m.altimInHg.toFixed(2)} inHg (${Math.round(m.altimInHg * 33.8639)} hPa)` : 'Not reported'),
      ...(m.wx ? [stat('Weather', m.wx)] : []),
    ),
    h('p', { class: 'airport-head' }, `METAR · observed ${when(m.obs)}, ${ago(m.obs, now)}`),
    h('pre', { class: 'airport-raw' }, m.raw),
    h('p', { class: 'airport-head' }, taf ? `TAF · issued ${when(taf.issued)}` : 'TAF'),
    taf === undefined
      ? h('p', { class: 'pop-note' }, 'Loading the forecast')
      : taf
        ? h('pre', { class: 'airport-raw' }, tafLines(taf.raw).join('\n'))
        : h('p', { class: 'pop-note' }, 'This airport doesn’t issue a TAF.'),
    h('p', { class: 'pop-note' }, `Source: NWS Aviation Weather Center (aviationweather.gov), relayed every 10 min; last relay ${when(relayed)}.`),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}
