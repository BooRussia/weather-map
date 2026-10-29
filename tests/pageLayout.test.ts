import { describe, expect, it } from 'vitest';
import { arrange } from '../src/ui/pageLayout';

const cards = ['nextRain', 'hourly', 'week', 'tides', 'aloft', 'fly'].map((id) => ({ id }));

describe('arranging the weather page', () => {
  it('keeps the default order with nothing saved', () => {
    expect(arrange(cards, { order: [], hidden: [] }).shown.map((c) => c.id)).toEqual(['nextRain', 'hourly', 'week', 'tides', 'aloft', 'fly']);
  });

  it('puts saved cards first in their order, the rest after, and sets hidden ones aside', () => {
    const got = arrange(cards, { order: ['fly', 'aloft', 'nextRain', 'gone'], hidden: ['tides'] });
    expect(got.shown.map((c) => c.id)).toEqual(['fly', 'aloft', 'nextRain', 'hourly', 'week']);
    expect(got.hidden.map((c) => c.id)).toEqual(['tides']);
  });
});
