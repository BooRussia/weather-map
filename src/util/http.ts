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
