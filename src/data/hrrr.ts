import { HRRR_META_URL } from '../config';
import { fetchJson } from '../util/http';

/** Init time of the latest HRRR run IEM has published, epoch ms. */
export async function getHrrrInit(signal?: AbortSignal): Promise<number> {
  const r = await fetchJson<{ model_init_utc: string }>(HRRR_META_URL, { signal, timeoutMs: 8000 });
  const t = Date.parse(r.model_init_utc);
  if (!Number.isFinite(t)) throw new Error('bad HRRR init time');
  return t;
}
