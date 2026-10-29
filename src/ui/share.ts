import type { LatLon } from '../config';
import { formatHashView } from '../data/view';
import { isNative } from '../util/position';

/** The website, for links made in the iPhone app (whose own pages aren't on the web). */
const SITE_URL = 'https://boorussia.github.io/weather-map/';

/** A link that opens the map at a place, with its weather (a shared link's view sets the point). */
export function placeLink(p: LatLon, zoom = 9): string {
  const base = isNative || !/^https?:$/.test(location.protocol) ? SITE_URL : `${location.origin}${location.pathname}`;
  return `${base}${formatHashView({ zoom, lat: p.lat, lon: p.lon })}`;
}

export type Shared = 'shared' | 'copied' | 'saved' | 'cancelled' | 'failed';

/**
 * Out through the system's share sheet (owner, 2026-10-29). Where there's none: a link is copied, a
 * file is saved to the device.
 */
export async function shareOut(d: { title: string; text: string; url?: string; file?: File }): Promise<Shared> {
  const data: ShareData = d.file ? { title: d.title, text: d.text, files: [d.file] } : { title: d.title, text: d.text, url: d.url };
  if (navigator.share && (!d.file || navigator.canShare?.(data))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  if (d.file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(d.file);
    a.download = d.file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    return 'saved';
  }
  try {
    await navigator.clipboard.writeText([d.text, d.url].filter(Boolean).join(' '));
    return 'copied';
  } catch {
    return 'failed';
  }
}
