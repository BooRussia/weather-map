import type { LatLon } from '../config';

/** A place someone tagged: a name and a spot, kept on the device. */
export interface Tag {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Tags kept at most; past this the oldest drops off. */
export const MAX_TAGS = 50;
/** Names are one short line. */
export const MAX_NAME = 40;
/** A tag stands for a point this close to it, km (a tag's own pin selects its exact spot). */
const SAME_PLACE_KM = 0.25;

/** Ground distance, km (flat-earth: fine at these distances). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  let dLon = Math.abs(a.lon - b.lon);
  if (dLon > 180) dLon = 360 - dLon;
  return Math.hypot(dLon * kx, (a.lat - b.lat) * 110.57);
}

/** The tag at (or right by) a point, if any. */
export function tagAt(tags: readonly Tag[], p: LatLon): Tag | null {
  let best: Tag | null = null;
  let bestKm = SAME_PLACE_KM;
  for (const t of tags) {
    const d = distanceKm(t, p);
    if (d <= bestKm) {
      best = t;
      bestKm = d;
    }
  }
  return best;
}

/** A tag's name: one trimmed line, at most MAX_NAME characters; `fallback` when blank. */
export function tagName(raw: string, fallback: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return name || fallback.trim().slice(0, MAX_NAME) || 'Tagged place';
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Tag a spot. A tag already there is renamed instead of doubled. */
export function addTag(tags: readonly Tag[], p: LatLon, name: string): Tag[] {
  const there = tagAt(tags, p);
  if (there) return renameTag(tags, there.id, name);
  const next = [...tags, { id: newId(), name, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) }];
  return next.slice(Math.max(0, next.length - MAX_TAGS));
}

export function renameTag(tags: readonly Tag[], id: string, name: string): Tag[] {
  return tags.map((t) => (t.id === id ? { ...t, name } : t));
}

export function removeTag(tags: readonly Tag[], id: string): Tag[] {
  return tags.filter((t) => t.id !== id);
}

/** Saved tags as read back from storage: anything malformed is dropped. */
export function readTags(v: unknown): Tag[] {
  if (!Array.isArray(v)) return [];
  const ok = (t: unknown): t is Tag => {
    const o = t as Partial<Tag> | null;
    return (
      !!o &&
      typeof o.id === 'string' &&
      typeof o.name === 'string' &&
      Number.isFinite(o.lat) &&
      Number.isFinite(o.lon) &&
      Math.abs(o.lat as number) <= 90 &&
      Math.abs(o.lon as number) <= 180
    );
  };
  return v.filter(ok).slice(-MAX_TAGS);
}
