export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Sent as a POST (form-encoded bodies need no CORS preflight). */
  body?: URLSearchParams;
}

/** fetch + JSON with a timeout. Throws HttpError on non-2xx. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      body: opts.body,
      headers: opts.headers,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** fetch with a timeout, for responses that aren't JSON (XML, binary rasters). Throws HttpError on non-2xx. */
async function fetchWith<T>(url: string, read: (res: Response) => Promise<T>, opts: FetchJsonOptions = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { headers: opts.headers, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return await read(res);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export const fetchText = (url: string, opts?: FetchJsonOptions) => fetchWith(url, (r) => r.text(), opts);
export const fetchBuffer = (url: string, opts?: FetchJsonOptions) => fetchWith(url, (r) => r.arrayBuffer(), opts);

/* ---------- the last briefing, kept for offline (owner, 2026-10-29: pilot features) ---------- */

const BRIEFING_CACHE = 'weather-map-briefing';
/** Saved answers kept at most (a forecast per place adds up); the oldest go first. */
const BRIEFING_KEPT = 40;
/** Told when a saved copy stands in for the network: what, and when it was saved. */
let onStale: ((what: string, savedAt: number) => void) | null = null;

export function whenServedFromSaved(fn: (what: string, savedAt: number) => void): void {
  onStale = fn;
}

/**
 * fetchJson, keeping the last good answer on the device under `key` (the Cache API), and handing that
 * back, said so, when the network fails, so the last briefing is there offline. Without the Cache API
 * it's plain fetchJson. Aborts aren't failures and aren't covered.
 */
export async function fetchJsonSaved<T>(url: string, key: string, what: string, opts: FetchJsonOptions = {}): Promise<T> {
  const store = typeof caches !== 'undefined' ? caches.open(BRIEFING_CACHE).catch(() => null) : Promise.resolve(null);
  const name = `https://saved.local/${encodeURIComponent(key)}`;
  try {
    const data = await fetchJson<T>(url, opts);
    void store
      .then(async (c) => {
        if (!c) return;
        await c.delete(name);
        await c.put(name, new Response(JSON.stringify(data), { headers: { 'x-saved-at': String(Date.now()) } }));
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - BRIEFING_KEPT))) await c.delete(k);
      })
      .catch(() => {});
    return data;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const res = await (await store)?.match(name).catch(() => undefined);
    if (!res) throw err;
    onStale?.(what, Number(res.headers.get('x-saved-at')) || 0);
    return (await res.json()) as T;
  }
}
