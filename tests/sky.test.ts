import { describe, expect, it } from 'vitest';
import { moonPhase, paramsFor, type SkyState } from '../src/ui/skyGL';

const state = (patch: Partial<SkyState>): SkyState => ({ scene: 'clear-day', clouds: 0, intensity: 0, mono: false, sunPhase: 0.5, ...patch });

describe('sky', () => {
  it('follows the lunar cycle', () => {
    const newMoon = Date.UTC(2000, 0, 6, 18, 14);
    // Phase is a circle: 0.9999 is as new as 0.0001.
    const fromNew = (p: number) => Math.min(p, 1 - p);
    expect(fromNew(moonPhase(newMoon))).toBeCloseTo(0, 3);
    expect(moonPhase(newMoon + 14.765 * 86_400_000)).toBeCloseTo(0.5, 2);
    expect(fromNew(moonPhase(newMoon + 10 * 29.530588853 * 86_400_000))).toBeCloseTo(0, 2);
  });

  it('is day between sunrise and sunset, night outside, with stars and moon only at night', () => {
    const noon = paramsFor(state({ sunPhase: 0.5 }));
    const night = paramsFor(state({ scene: 'clear-night', sunPhase: 1.6 }));
    expect(noon.night).toBeCloseTo(0);
    expect(noon.sunVis).toBeGreaterThan(0.9);
    expect(night.night).toBeCloseTo(1);
    expect(night.moonVis).toBeGreaterThan(0.9);
    expect(night.sunVis).toBeCloseTo(0);
  });

  it('warms the horizon at golden hour', () => {
    const noon = paramsFor(state({ sunPhase: 0.5 }));
    const late = paramsFor(state({ sunPhase: 0.98 }));
    expect(noon.bottom[2]).toBeGreaterThan(noon.bottom[0]); // blue horizon
    expect(late.bottom[0]).toBeGreaterThan(late.bottom[2]); // orange horizon
  });

  it('keeps a partly cloudy sky blue and only overcast gray', () => {
    const partly = paramsFor(state({ scene: 'cloudy-day', clouds: 0.5 }));
    const overcast = paramsFor(state({ scene: 'cloudy-day', clouds: 1 }));
    const blueness = (c: number[]) => c[2] - c[0];
    expect(blueness(partly.top)).toBeGreaterThan(blueness(overcast.top) + 0.2);
    expect(partly.cloud).toBe(0.5);
    expect(overcast.cloud).toBe(1);
  });

  it('shows no clouds in a clear sky, rain only when wet, snow only when snowing', () => {
    expect(paramsFor(state({ clouds: 0 })).cloud).toBeLessThan(0);
    expect(paramsFor(state({ scene: 'rain', intensity: 1 })).rain).toBe(1);
    expect(paramsFor(state({ scene: 'snow' })).rain).toBe(0);
    expect(paramsFor(state({ scene: 'snow', intensity: 1 })).snow).toBe(1);
  });
});
