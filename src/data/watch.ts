import type { Alert } from './nws';

/** What the watch on your location has already told you, kept between visits. */
export interface WatchMemory {
  /** Alerts already notified (their ids). */
  seen: string[];
  /** Rain already announced; cleared once it's dry again. */
  rainTold: boolean;
}

export interface Note {
  title: string;
  body: string;
  tag: string;
}

/** Rain this close (minutes) is worth a notification. */
export const RAIN_NOTICE_MIN = 30;
/** At most this many alerts at once (the rest are in the app). */
const MAX_ALERTS = 3;
/** Ids remembered, newest last. */
const SEEN_KEPT = 100;

/** Warnings and watches, and anything NWS rates severe or extreme: advisories and statements stay in the app. */
const worthTelling = (a: Alert) => /warning|watch/i.test(a.event) || a.severity === 'Severe' || a.severity === 'Extreme';

/**
 * What to tell you now (owner, 2026-10-29: Apple's and Carrot's alerts for where you are): each new
 * warning or watch once, and rain once when it's about to start (again only after it has dried out).
 */
export function whatToTell(
  alerts: Alert[] | null,
  rain: { text: string; wet: boolean; minutes: number } | null | undefined,
  memory: WatchMemory,
): { notes: Note[]; memory: WatchMemory } {
  const notes: Note[] = [];
  const seen = new Set(memory.seen);
  for (const a of (alerts ?? []).filter((x) => worthTelling(x) && !seen.has(x.id)).slice(0, MAX_ALERTS)) {
    notes.push({ title: a.event, body: a.headline !== a.event ? a.headline : a.areaDesc, tag: a.id });
  }
  for (const a of alerts ?? []) seen.add(a.id);
  let rainTold = memory.rainTold;
  // Undefined: the rain couldn't be checked this time, so nothing changes.
  if (rain === null) rainTold = false;
  else if (rain && !rain.wet && rain.minutes <= RAIN_NOTICE_MIN && !rainTold) {
    notes.push({ title: 'Rain soon', body: rain.text, tag: 'rain-soon' });
    rainTold = true;
  } else if (rain?.wet) rainTold = true;
  return { notes, memory: { seen: [...seen].slice(-SEEN_KEPT), rainTold } };
}
