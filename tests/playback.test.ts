import { afterEach, describe, expect, it, vi } from 'vitest';
import { framesBetween, frameSource, makeTimeline, SUB_STEP_MS, tilePalette } from '../src/data/timeline';
import { createStore } from '../src/state';
import { alertUntil } from '../src/ui/areaCard';
import type { AlertAreaProps } from '../src/data/warnings';

const at = (iso: string) => Date.parse(iso);

describe('5-minute radar frames in the MRMS window', () => {
  const now = at('2026-10-09T11:24:00Z');
  const mrms: number[] = [];
  for (let t = at('2026-10-09T09:24:16Z'); t <= at('2026-10-09T11:22:12Z'); t += 2 * 60_000) mrms.push(t);
  const t = makeTimeline(now, at('2026-10-09T10:00:00Z'), at('2026-10-09T11:20:00Z'), null, mrms, []);

  it('plays the real frames about 5 minutes apart between two 15-minute marks', () => {
    const a = frameSource(t, -0.5);
    const b = frameSource(t, -0.25);
    const subs = framesBetween(t, a, b);
    expect(subs).toHaveLength(2);
    const times = [a.at, ...subs.map((f) => f.at), b.at];
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
      expect(Math.abs(times[i] - times[i - 1] - SUB_STEP_MS)).toBeLessThanOrEqual(2 * 60_000);
    }
    for (const f of subs) {
      expect(tilePalette(f.url)).toBe('mrms');
      expect(mrms).toContain(f.at);
    }
  });

  it('reaches into the newest frame from the last mark', () => {
    const subs = framesBetween(t, frameSource(t, -0.25), frameSource(t, 0));
    expect(subs.length).toBeGreaterThanOrEqual(3);
    expect(subs.every((f) => f.at < mrms[mrms.length - 1])).toBe(true);
  });

  it('leaves the archive, the forecast, and a single radar to the 15-minute frames', () => {
    expect(framesBetween(t, frameSource(t, -3.25), frameSource(t, -3))).toEqual([]);
    expect(framesBetween(t, frameSource(t, 0), frameSource(t, 0.25))).toEqual([]);
    const site = { id: 'MOB', product: 'N0B', scans: mrms } as unknown as Parameters<typeof makeTimeline>[3];
    const withSite = makeTimeline(now, null, null, site, mrms, []);
    expect(framesBetween(withSite, frameSource(t, -0.5), frameSource(t, -0.25))).toEqual([]);
  });
});

describe('the weather card pin', () => {
  const storage = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), dump: m };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('is pinned by default, even for someone who had the old follow setting saved', () => {
    vi.stubGlobal('localStorage', storage({}));
    expect(createStore({ lat: 0, lon: 0 }, false).get().followMap).toBe(false);
    vi.stubGlobal('localStorage', storage({ 'weather-map:prefs:v2': JSON.stringify({ followMap: true }) }));
    expect(createStore({ lat: 0, lon: 0 }, false).get().followMap).toBe(false);
  });

  it('remembers being unpinned', () => {
    const ls = storage({});
    vi.stubGlobal('localStorage', ls);
    createStore({ lat: 0, lon: 0 }, false).set({ followMap: true });
    expect(JSON.parse(ls.dump.get('weather-map:prefs:v2')!).pinned).toBe(false);
    expect(createStore({ lat: 0, lon: 0 }, false).get().followMap).toBe(true);
  });
});

describe('a tapped alert area', () => {
  const props = (p: Partial<AlertAreaProps>): AlertAreaProps => ({
    prod_type: 'Tornado Warning',
    sig: 'W',
    phenom: 'TO',
    url: '',
    expiration: '',
    ends: '',
    wfo: 'KMOB',
    cap_id: 'x',
    ...p,
  });

  it('says when it ends: a time today, a day and time later', () => {
    const now = new Date(2026, 9, 9, 15, 0).getTime();
    const today = new Date(2026, 9, 9, 21, 0).toISOString();
    const later = new Date(2026, 9, 10, 8, 0).toISOString();
    expect(alertUntil(props({ ends: today }), now)).toMatch(/^until 9:00\sPM$/);
    expect(alertUntil(props({ ends: later }), now)).toMatch(/^until \w{3},? 8:00\sAM$/);
    // No end given: the expiration stands in.
    expect(alertUntil(props({ expiration: today }), now)).toMatch(/^until 9:00\sPM$/);
  });

  it('runs until further notice for hurricane alerts and blank times', () => {
    expect(alertUntil(props({ phenom: 'HU', expiration: new Date().toISOString() }))).toBe('in effect');
    expect(alertUntil(props({}))).toBe('in effect');
  });
});
