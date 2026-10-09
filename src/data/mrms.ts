import { MRMS_WMS_URL } from '../config';
import { fetchText } from '../util/http';

/** The frame times in a WMS capabilities document's time dimension (a list of ISO times), epoch ms, oldest first. */
export function parseMrmsTimes(xml: string): number[] {
  const dim = /<Dimension[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/.exec(xml);
  if (!dim) return [];
  return dim[1]
    .split(',')
    .map((s) => Date.parse(s.trim()))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/** MRMS frames on the server now: every ~2 minutes over the last 2 hours. */
export async function getMrmsTimes(signal?: AbortSignal): Promise<number[]> {
  // Capabilities change every 2 minutes: a cache-buster per minute keeps proxies from serving a stale list.
  const v = Math.floor(Date.now() / 60_000);
  const xml = await fetchText(`${MRMS_WMS_URL}?service=WMS&version=1.3.0&request=GetCapabilities&v=${v}`, { signal, timeoutMs: 8000 });
  const times = parseMrmsTimes(xml);
  if (!times.length) throw new Error('no MRMS frames');
  return times;
}
