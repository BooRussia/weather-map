import { describe, expect, it } from 'vitest';
import { frameSource, makeTimeline, offsetTime, relativeLabel, utcHourKey, utcStamp } from '../src/data/timeline';

const at = (iso: string) => Date.parse(iso);

describe('radar timeline', () => {
  it('starts 24 hours back from the top of the current hour', () => {
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), null);
    expect(new Date(t.base).toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(t.minOffset).toBe(-24);
  });

  it('runs into the forecast only as far as the HRRR run reaches', () => {
    // A 20Z run covers 18 hours, to 14Z tomorrow: 16 hours past 22Z.
    expect(makeTimeline(at('2026-10-05T22:37:00Z'), at('2026-10-05T20:00:00Z')).maxOffset).toBe(16);
    // No run known: no future stops.
    expect(makeTimeline(at('2026-10-05T22:37:00Z'), null).maxOffset).toBe(0);
  });

  it('uses live radar now, the archive for the past, HRRR for the future', () => {
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), at('2026-10-05T20:00:00Z'));
    expect(frameSource(t, 0)).toEqual({ kind: 'live' });

    const past = frameSource(t, -3);
    expect(past.kind).toBe('past');
    expect(past.kind !== 'live' && past.url).toContain('ridge::USCOMP-N0Q-202610051900/');

    const future = frameSource(t, 2);
    // 22Z + 2 h = 00Z, 4 hours after the 20Z init.
    expect(future.kind !== 'live' && future.url).toContain('hrrr::REFD-F0240-202610052000/');
  });

  it('formats keys and labels', () => {
    expect(utcStamp(at('2026-10-05T09:05:00Z'))).toBe('202610050905');
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), null);
    expect(utcHourKey(offsetTime(t, -1))).toBe('2026-10-05T21:00');
    expect(relativeLabel(0)).toBe('Now');
    expect(relativeLabel(-3)).toBe('−3 h');
    expect(relativeLabel(5)).toBe('+5 h');
  });
});
