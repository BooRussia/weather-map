import { COMPOSITE_META_URL, HRRR_META_URL } from '../config';
import { fetchJson } from '../util/http';

/** Init time of the latest HRRR run IEM has published, epoch ms. */
export async function getHrrrInit(signal?: AbortSignal): Promise<number> {
  const r = await fetchJson<{ model_init_utc: string }>(HRRR_META_URL, { signal, timeoutMs: 8000 });
  const t = Date.parse(r.model_init_utc);
  if (!Number.isFinite(t)) throw new Error('bad HRRR init time');
  return t;
}

/** Valid time of IEM's newest NEXRAD composite (every 5 minutes, ~2 minutes behind), epoch ms. */
export async function getLatestComposite(signal?: AbortSignal): Promise<number> {
  const r = await fetchJson<{ meta: { valid: string } }>(COMPOSITE_META_URL, { signal, timeoutMs: 8000 });
  const t = Date.parse(r.meta.valid);
  if (!Number.isFinite(t)) throw new Error('bad composite time');
  return t;
}
