import type { AirspaceProps } from '../data/airspace';
import {
  ago,
  ceilingFt,
  CATEGORY_COLOR,
  CATEGORY_WORD,
  HAZARD,
  levelText,
  METAR_OLD_MIN,
  pirepColor,
  RELAY_LATE_MIN,
  SIGMET_COLOR,
  tafLines,
  tfrLink,
  windText,
  zulu,
  type AirSigmet,
  type Gairmet,
  type Metar,
  type Pirep,
  type Taf,
  type Tfr,
} from '../data/aviation';
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

/* ---------- advisories, pilot reports, TFRs, airspace (step 3) ---------- */

const relayNote = (relayed: number) => h('p', { class: 'pop-note' }, `Source: NWS Aviation Weather Center and the FAA, relayed every 10 min; last relay ${when(relayed)}.`);

/** Every SIGMET and G-AIRMET over the spot tapped: what, how bad, from and to what altitude, until when; a SIGMET's text as issued. */
export function advisoryPanel(items: (AirSigmet | Gairmet)[], relayed: number): HTMLElement {
  return h(
    'div',
    { class: 'airport' },
    ...items.map((x) => {
      if ('raw' in x) {
        const name = x.hazard === 'CONVECTIVE' ? HAZARD.CONVECTIVE.name : `SIGMET: ${x.hazard.toLowerCase()}`;
        return h(
          'div',
          { class: 'adv-item' },
          h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${x.hazard === 'CONVECTIVE' ? HAZARD.CONVECTIVE.color : SIGMET_COLOR}` }), name),
          h('p', { class: 'pop-note' }, `${x.lo != null ? `From ${levelText(x.lo)}` : 'From the surface'} to ${levelText(x.hi)}${x.to ? `, until ${when(x.to * 1000)}` : ''}.`),
          h('pre', { class: 'airport-raw' }, x.raw),
        );
      }
      const hz = HAZARD[x.hazard];
      const icing = x.hazard === 'ICE' && (x.fzlBase || x.fzlTop) ? ` (freezing level ${levelText(x.fzlBase)}${x.fzlTop && x.fzlTop !== x.fzlBase ? `–${levelText(x.fzlTop)}` : ''})` : '';
      return h(
        'div',
        { class: 'adv-item' },
        h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${hz?.color ?? SIGMET_COLOR}` }), `G-AIRMET: ${(hz?.name ?? x.hazard).toLowerCase()}${x.severity ? `, ${x.severity.toLowerCase()}` : ''}`),
        h(
          'p',
          { class: 'pop-note' },
          `${x.base || x.top ? `From ${levelText(x.base)} to ${levelText(x.top)}${icing}. ` : ''}${x.dueTo ? `Due to ${x.dueTo.toLowerCase().replace(/_/g, ' ')}. ` : ''}Valid ${when(x.valid * 1000)}${x.expires ? `, until ${when(x.expires * 1000)}` : ''}.`,
        ),
      );
    }),
    relayNote(relayed),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}

export const pirepTitle = (p: Pirep) => `${p.urgent ? 'Urgent pilot report' : 'Pilot report'}${p.aircraft ? ` · ${p.aircraft}` : ''}`;

/** One pilot report: when, how high, what aircraft, turbulence and icing, then the report as filed. */
export function pirepPanel(p: Pirep, relayed: number, now = Date.now()): HTMLElement {
  return h(
    'div',
    { class: 'airport' },
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: `background:${pirepColor(p)}` }), p.urgent ? 'Urgent (UUA)' : 'Routine (UA)'),
    h(
      'div',
      { class: 'storm-stats' },
      stat('Reported', `${when(p.time)}, ${ago(p.time, now)}`),
      stat('Altitude', p.altFt ? `${levelText(p.altFt)} MSL` : 'Not given'),
      stat('Turbulence', p.turbulence || 'Not reported'),
      stat('Icing', p.icing || 'Not reported'),
    ),
    h('pre', { class: 'airport-raw' }, p.raw),
    relayNote(relayed),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}

/** A TFR: what kind, where and when (the FAA's own words), and its NOTAM page for the details that bind. */
export function tfrPanel(t: Tfr, relayed: number): HTMLElement {
  return h(
    'div',
    { class: 'airport' },
    h('p', { class: 'storm-cat' }, h('span', { class: 'storm-cat-dot', style: 'background:#ff453a' }), `Temporary flight restriction · ${t.kind.toLowerCase()}`),
    h('p', { class: 'card-text' }, t.title),
    h('p', { class: 'pop-note' }, h('a', { href: tfrLink(t.id), target: '_blank', rel: 'noopener' }, `NOTAM ${t.id} at tfr.faa.gov`), ': altitudes, times, and who it applies to.'),
    relayNote(relayed),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}

/** The class airspace over a spot, shelf by shelf, lowest first. */
export function airspacePanel(list: AirspaceProps[]): HTMLElement {
  const word = (v: number, ref: string) => (ref === 'SFC' || v === 0 ? 'the surface' : `${v.toLocaleString()} ft ${ref === 'AGL' ? 'AGL' : 'MSL'}`);
  return h(
    'div',
    { class: 'airport' },
    ...list.map((a) =>
      h(
        'p',
        { class: 'storm-cat' },
        h('span', { class: 'storm-cat-dot', style: `background:${a.cls === 'B' ? '#0a84ff' : a.cls === 'C' ? '#e040fb' : '#5ac8fa'}` }),
        `${a.name.replace(/\b(\w)(\w*)/g, (_, f: string, r: string) => f + r.toLowerCase()).replace(/Class (\w)/i, 'Class $1')}: ${word(a.lo, a.loRef)} to ${word(a.hi, a.hiRef)}`,
      ),
    ),
    h('p', { class: 'pop-note' }, 'Source: FAA class airspace. Check the current sectional chart for what applies.'),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}

