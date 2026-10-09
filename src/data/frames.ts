/** Picking frames out of a sorted list of frame times (epoch ms). */

/** Index of the first time ≥ `at`. */
function lowerBound(times: readonly number[], at: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The frame nearest `at`, if one is within `tolerance` ms. */
export function nearestFrame(times: readonly number[], at: number, tolerance: number): number | null {
  const i = lowerBound(times, at);
  let best: number | null = null;
  for (const t of [times[i - 1], times[i]]) {
    if (t != null && Math.abs(t - at) <= tolerance && (best == null || Math.abs(t - at) < Math.abs(best - at))) best = t;
  }
  return best;
}

/** The newest frame at or before `at` (a minute's grace), if it's at most `maxAge` ms older. */
export function frameBefore(times: readonly number[], at: number, maxAge: number): number | null {
  const i = lowerBound(times, at + 60_000 + 1);
  const t = times[i - 1];
  return t != null && at - t <= maxAge ? t : null;
}
