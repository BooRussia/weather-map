import type { Aloft } from '../data/aloft';
import { cloudbaseFt } from '../data/aloft';
import { assess, civilTwilight, kpAt, PROFILES, type Activity, type KpBlock, type Level } from '../data/flyability';
import { clockLabel } from '../data/outlook';
import type { PointForecast } from '../data/openmeteo';
import { compass8, fToC, mphToKt } from '../util/units';
import { BRIEFING_NOTE } from './airportPanel';
import { h, svg } from './dom';
import { pgMark } from './icons';
import { segmented } from './layersMenu';

const SPOTS_KEY = 'weather-map:launch-spots';
/** Hours ahead the strip runs. */
const HOURS = 12;
const FACINGS: [string, number | null][] = [
  ['Any', null],
  ['N', 0],
  ['NE', 45],
  ['E', 90],
  ['SE', 135],
  ['S', 180],
  ['SW', 225],
  ['W', 270],
  ['NW', 315],
];
const LEVEL_WORD: Record<Level, string> = { go: 'Good', marginal: 'Marginal', no: 'No' };

/** What's been chosen for a place: the activity, and the way its launch faces. Kept on the device. */
export interface Spot {
  activity: Activity;
  facing: number | null;
}

const spotKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export function readSpot(lat: number, lon: number): Spot {
  try {
    const all = JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') as Record<string, Spot>;
    return all[spotKey(lat, lon)] ?? all.last ?? { activity: 'paraglider', facing: null };
  } catch {
    return { activity: 'paraglider', facing: null };
  }
}

function saveSpot(lat: number, lon: number, spot: Spot): void {
  try {
    const all = JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') as Record<string, Spot>;
    all[spotKey(lat, lon)] = spot;
    // The activity carries over to new places; the launch's direction doesn't.
    all.last = { activity: spot.activity, facing: null };
    localStorage.setItem(SPOTS_KEY, JSON.stringify(all));
  } catch {
    // Lasts for this visit.
  }
}

/**
 * Flyability (owner, 2026-10-29: pilot features), on the weather page with the pilot cards: pick the
 * activity and which way the launch faces, and the next 12 hours read go, marginal, or no, each with its
 * reasons (tap an hour for them); civil twilight; and for drones the clouds, visibility, wind at 400 ft,
 * and Kp. `aloft`, `kp`: undefined while loading. `chosen`: the hour tapped. `redraw`: after a change.
 */
export function flyCard(
  om: PointForecast,
  at: { lat: number; lon: number },
  aloft: Aloft | null | undefined,
  kp: KpBlock[] | null | undefined,
  chosen: number,
  choose: (i: number) => void,
  redraw: () => void,
): HTMLElement {
  const spot = readSpot(at.lat, at.lon);
  const profile = PROFILES[spot.activity];
  const drone = spot.activity === 'drone';
  const start = Math.max(0, om.week.findIndex((x) => x.time.slice(0, 13) >= om.current.time.slice(0, 13)));
  const hours = om.week.slice(start, start + HOURS);
  const nowMs = Date.now();
  const rows = hours.map((x, i) => {
    // The hour's UTC instant, from the place's clock and its offset.
    const ms = Date.parse(`${x.time}:00Z`) - om.utcOffsetSeconds * 1000;
    const up = drone ? aloft?.hours.find((a) => a.time === x.time)?.wind120 : null;
    const windKt = up ? up.kt : mphToKt(x.windMph);
    const fromDeg = up ? up.dir : x.windFromDeg;
    const verdict = assess(
      {
        windKt,
        gustKt: Math.max(windKt, mphToKt(x.gustMph)),
        fromDeg,
        rainPct: x.precipProbability,
        visSM: drone ? x.visibilityM / 1609.344 : null,
        cloudbaseFt: drone ? cloudbaseFt(fToC(x.tempF), fToC(x.dewF)) : null,
        kp: drone && kp ? kpAt(kp, Math.max(ms, nowMs)) : null,
      },
      profile,
      spot.facing,
    );
    return { x, i, windKt, gustKt: mphToKt(x.gustMph), fromDeg, verdict };
  });
  const pick = rows[Math.max(0, Math.min(rows.length - 1, chosen))];

  const set = (patch: Partial<Spot>) => {
    saveSpot(at.lat, at.lon, { ...spot, ...patch });
    redraw();
  };
  const activities = segmented<Activity>(
    'Activity',
    (Object.keys(PROFILES) as Activity[]).map((a) => ({ value: a, label: PROFILES[a].name })),
    spot.activity,
    (a) => set({ activity: a }),
  );
  activities.classList.add('fly-seg');
  const facing = drone
    ? null
    : h(
        'div',
        { class: 'fly-facing', role: 'group', 'aria-label': 'Which way the launch faces' },
        h('span', { class: 'fly-facing-label' }, 'Launch faces'),
        ...FACINGS.map(([name, deg]) => {
          const b = h('button', { type: 'button', 'aria-pressed': String(deg === spot.facing) }, name);
          b.addEventListener('click', () => set({ facing: deg }));
          return b;
        }),
      );

  const strip = h(
    'div',
    { class: 'fly-strip', role: 'list' },
    ...rows.map((r) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: `fly-hour is-${r.verdict.level}`,
          role: 'listitem',
          'aria-pressed': String(r === pick),
          'aria-label': `${r.i ? clockLabel(r.x.time, false) : 'Now'}: ${LEVEL_WORD[r.verdict.level]}. ${r.verdict.reasons.join('. ')}`,
        },
        h('span', { class: 'fly-time' }, r.i ? clockLabel(r.x.time, false).replace(' ', '') : 'Now'),
        h('span', { class: 'fly-dot' }),
        h('span', { class: 'fly-wind' }, `${Math.round(r.windKt)}`, h('small', {}, r.gustKt - r.windKt >= 3 ? `G${Math.round(r.gustKt)}` : '')),
        h('span', { class: 'fly-dir' }, compass8(r.fromDeg)),
      );
      b.addEventListener('click', () => choose(r.i));
      return b;
    }),
  );

  const day = Date.parse(`${om.current.time.slice(0, 10)}T12:00:00Z`) - om.utcOffsetSeconds * 1000;
  const tw = civilTwilight(at.lat, at.lon, day);
  const local = (ms: number) => clockLabel(new Date(ms + om.utcOffsetSeconds * 1000).toISOString().slice(0, 16));
  const today = om.daily[0];
  const kpNow = kp ? kpAt(kp, nowMs) : null;
  const kpMax = kp ? Math.max(...kp.filter((b) => b.at > nowMs - 3 * 3_600_000 && b.at < nowMs + 24 * 3_600_000).map((b) => b.kp)) : null;
  const facts: [string, string][] = [
    ['Civil twilight', tw.dawn && tw.dusk ? `${local(tw.dawn)} – ${local(tw.dusk)}` : '–'],
    ['Sunrise, sunset', today ? `${clockLabel(today.sunrise)}, ${clockLabel(today.sunset)}` : '–'],
  ];
  if (drone) {
    const x = pick.x;
    facts.push(
      ['Wind at 400 ft', aloft === undefined ? 'Loading' : `${Math.round(pick.windKt)} kt from ${compass8(pick.fromDeg)}`],
      ['Cloudbase', `≈ ${(Math.round(cloudbaseFt(fToC(x.tempF), fToC(x.dewF)) / 100) * 100).toLocaleString()} ft above ground`],
      // As METARs write it: 10+ past ten miles.
      ['Visibility', x.visibilityM / 1609.344 >= 10 ? '10+ SM' : `${(x.visibilityM / 1609.344).toFixed(1)} SM`],
      ['Kp (GPS)', kp === undefined ? 'Loading' : kpNow != null ? `${kpNow.toFixed(1)} now, up to ${kpMax?.toFixed(1)} in the next day${(kpMax ?? 0) >= 5 ? ': GPS may wander' : ''}` : '–'],
    );
  }
  return h(
    'section',
    { class: 'card glass fly' },
    h('h3', { class: 'card-head' }, svg(pgMark), 'Flyability'),
    activities,
    facing,
    strip,
    h(
      'div',
      { class: `fly-why is-${pick.verdict.level}` },
      h('strong', {}, `${pick.i ? clockLabel(pick.x.time, false) : 'Now'}: ${LEVEL_WORD[pick.verdict.level]}`),
      pick.verdict.reasons.length ? h('ul', {}, ...pick.verdict.reasons.map((r) => h('li', {}, r))) : h('p', {}, `Within ${profile.name.toLowerCase()} rules of thumb${spot.facing == null && !drone ? ' (set the launch’s direction to check crosswind)' : ''}.`),
    ),
    h('dl', { class: 'long-rows aloft-stats' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h(
      'p',
      { class: 'pop-note' },
      `Rules of thumb for a ${profile.name.toLowerCase()}: wind ${profile.minKt}–${profile.maxKt} kt, gusts to ${profile.gustKt}${profile.crossDeg != null ? `, within ${profile.crossDeg}° of the launch` : ', at 400 ft; 3 SM and clouds 900 ft up (Part 107)'}. Not limits for your wing, aircraft, or skill; you decide. Wind and gusts: Open-Meteo, hourly${drone ? '; Kp: NOAA SWPC' : ''}.`,
    ),
    h('p', { class: 'pop-note airport-legal' }, BRIEFING_NOTE),
  );
}
