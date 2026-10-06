import { describe, expect, it } from 'vitest';
import { frameSource, makeTimeline, offsetTime, relativeLabel, snap, tileMirrors, utcHourKey, utcStamp } from '../src/data/timeline';

const at = (iso: string) => Date.parse(iso);

describe('radar timeline', () => {
  it('starts 24 hours back from the current 15-minute mark', () => {
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), null);
    expect(new Date(t.base).toISOString()).toBe('2026-10-05T22:30:00.000Z');
    expect(t.minOffset).toBe(-24);
  });

  it('runs into the forecast only as far as the HRRR run reaches, in 15-minute frames', () => {
    // A 20Z run covers 18 hours, to 14Z tomorrow: 15 h 30 min past 22:30.
    expect(makeTimeline(at('2026-10-05T22:37:00Z'), at('2026-10-05T20:00:00Z')).maxOffset).toBe(15.5);
    expect(makeTimeline(at('2026-10-05T22:37:00Z'), null).maxOffset).toBe(0);
  });

  it('uses live radar now, the archive for the past, HRRR for the future', () => {
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), at('2026-10-05T20:00:00Z'));
    expect(frameSource(t, 0)).toEqual({ kind: 'live' });

    const past = frameSource(t, -0.25);
    expect(past.kind !== 'live' && past.url).toContain('ridge::USCOMP-N0Q-202610052215/');

    const future = frameSource(t, 2);
    // 22:30 + 2 h = 00:30, 4.5 hours after the 20Z init.
    expect(future.kind !== 'live' && future.url).toContain('hrrr::REFD-F0270-202610052000/');
  });

  it('snaps offsets to frames', () => {
    expect(snap(1.1)).toBe(1);
    expect(snap(-2.38)).toBe(-2.5);
  });

  it('formats keys and labels', () => {
    expect(utcStamp(at('2026-10-05T09:05:00Z'))).toBe('202610050905');
    const t = makeTimeline(at('2026-10-05T22:37:00Z'), null);
    // 21:30 rounds to the 22:00 hour for the wind grid.
    expect(utcHourKey(offsetTime(t, -1))).toBe('2026-10-05T22:00');
    expect(relativeLabel(0)).toBe('Now');
    expect(relativeLabel(-0.75)).toBe('−45 min');
    expect(relativeLabel(-3)).toBe('−3 h');
    expect(relativeLabel(2.25)).toBe('+2 h 15 min');
  });

  it('spreads IEM tiles across its four hostnames', () => {
    const url = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202610052215/{z}/{x}/{y}.png';
    const urls = tileMirrors(url);
    expect(urls.map((u) => u.split('/')[2])).toEqual([
      'mesonet.agron.iastate.edu',
      'mesonet1.agron.iastate.edu',
      'mesonet2.agron.iastate.edu',
      'mesonet3.agron.iastate.edu',
    ]);
    expect(urls[3]).toContain('/ridge::USCOMP-N0Q-202610052215/{z}/{x}/{y}.png');
  });
});
