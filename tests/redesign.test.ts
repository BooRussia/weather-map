import { describe, expect, it } from 'vitest';
import { toPlace } from '../src/data/photon';
import { sceneFor } from '../src/ui/sky';
import { codeFromText, tempColor } from '../src/ui/page';
import { hiLoLine, amountText } from '../src/ui/format';
import type { Conditions } from '../src/data/conditions';
import type { AppState } from '../src/state';

describe('search results', () => {
  it('names a landmark and puts its street address underneath', () => {
    const p = toPlace(
      { name: 'White House', housenumber: '1600', street: 'Pennsylvania Avenue Northwest', city: 'Washington', state: 'District of Columbia', countrycode: 'US', type: 'house' },
      -77.03,
      38.89,
    );
    expect(p.title).toBe('White House');
    expect(p.subtitle).toBe('1600 Pennsylvania Avenue Northwest, Washington, DC');
  });

  it('uses the street address as the title when there is no name', () => {
    const p = toPlace({ housenumber: '12', street: 'Main Street', city: 'Ocala', state: 'Florida', countrycode: 'US', type: 'house' }, 0, 0);
    expect(p.title).toBe('12 Main Street');
    expect(p.subtitle).toBe('Ocala, FL');
    expect(p.kind).toBe('address');
  });

  it('abbreviates US states and keeps the country elsewhere', () => {
    expect(toPlace({ name: 'Ocala', state: 'Florida', countrycode: 'US', type: 'city' }, 0, 0)).toMatchObject({
      subtitle: 'FL',
      kind: 'area',
    });
    expect(toPlace({ name: 'Lyon', state: 'Auvergne-Rhône-Alpes', country: 'France', countrycode: 'FR', type: 'city' }, 0, 0).subtitle).toBe(
      'Auvergne-Rhône-Alpes, France',
    );
  });
});

describe('weather page sky', () => {
  it('reads NWS observation wording', () => {
    expect(codeFromText('Rain and Fog/Mist')).toBe(63);
    expect(codeFromText('Heavy Rain')).toBe(65);
    expect(codeFromText('Thunderstorms and Rain')).toBe(95);
    expect(codeFromText('Fog/Mist')).toBe(45);
    expect(codeFromText('Mostly Cloudy')).toBe(2);
    expect(codeFromText('Clear')).toBe(0);
    expect(codeFromText('')).toBeNull();
  });

  it('picks a scene for the weather and time of day', () => {
    expect(sceneFor(0, true).scene).toBe('clear-day');
    expect(sceneFor(0, false).scene).toBe('clear-night');
    expect(sceneFor(3, false).scene).toBe('cloudy-night');
    expect(sceneFor(65, true)).toMatchObject({ scene: 'rain', intensity: 1 });
    expect(sceneFor(95, true).scene).toBe('storm');
    expect(sceneFor(73, true).scene).toBe('snow');
    expect(sceneFor(45, true).scene).toBe('fog');
  });

  it('colors temperatures along the ramp', () => {
    expect(tempColor(20)).toBe('#5e5cf0');
    expect(tempColor(66)).toBe('#30d158');
    expect(tempColor(100)).toBe('#ff453a');
  });
});

describe('Apple-style text', () => {
  const s = { tempUnit: 'F' } as AppState;

  it('formats the high/low line like Apple', () => {
    const c = { om: { daily: [{ hiF: 87.2, loF: 75.6 }] } } as unknown as Conditions;
    expect(hiLoLine(c, s)).toBe('H:87°  L:76°');
  });

  it('formats rain totals', () => {
    expect(amountText(16.5, s)).toBe('.65″');
    expect(amountText(0, s)).toBe('0″');
    expect(amountText(40, s)).toBe('1.6″');
  });
});
