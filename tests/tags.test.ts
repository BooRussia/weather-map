import { afterEach, describe, expect, it, vi } from 'vitest';
import { addTag, distanceKm, MAX_NAME, MAX_TAGS, readTags, removeTag, renameTag, tagAt, tagName } from '../src/data/tags';
import { createStore } from '../src/state';

const ocala = { lat: 29.1872, lon: -82.1401 };
const gainesville = { lat: 29.6516, lon: -82.3248 };

describe('tagged places', () => {
  it('tags a spot, and tagging the same spot again renames it instead of doubling it', () => {
    let tags = addTag([], ocala, 'Ocala, FL');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: 'Ocala, FL', lat: 29.1872, lon: -82.1401 });
    tags = addTag(tags, { lat: ocala.lat + 0.001, lon: ocala.lon }, 'Home');
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('Home');
    tags = addTag(tags, gainesville, 'Gainesville, FL');
    expect(tags.map((t) => t.name)).toEqual(['Home', 'Gainesville, FL']);
    expect(new Set(tags.map((t) => t.id)).size).toBe(2);
  });

  it('finds the tag at a point, the nearest within a few hundred meters', () => {
    const tags = addTag(addTag([], ocala, 'A'), { lat: ocala.lat + 0.0015, lon: ocala.lon }, 'B');
    // 0.0015° of latitude is ~170 m: close enough to be the same place as A, so it renamed A.
    expect(tags).toHaveLength(1);
    expect(tagAt(tags, { lat: ocala.lat + 0.001, lon: ocala.lon })?.name).toBe('B');
    expect(tagAt(tags, gainesville)).toBeNull();
    expect(distanceKm(ocala, gainesville)).toBeGreaterThan(50);
    expect(distanceKm(ocala, gainesville)).toBeLessThan(60);
    // Across the date line.
    expect(distanceKm({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 })).toBeLessThan(1);
  });

  it('keeps names to one short line, with the place name when left blank', () => {
    expect(tagName('  Mom’s \n house  ', 'Ocala, FL')).toBe('Mom’s house');
    expect(tagName('   ', 'Ocala, FL')).toBe('Ocala, FL');
    expect(tagName('', '')).toBe('Tagged place');
    expect(tagName('x'.repeat(80), 'Ocala, FL')).toHaveLength(MAX_NAME);
  });

  it('renames and removes by id, and drops the oldest past the limit', () => {
    let tags = addTag(addTag([], ocala, 'A'), gainesville, 'B');
    tags = renameTag(tags, tags[0].id, 'Home');
    expect(tags.map((t) => t.name)).toEqual(['Home', 'B']);
    tags = removeTag(tags, tags[0].id);
    expect(tags.map((t) => t.name)).toEqual(['B']);
    let many: ReturnType<typeof addTag> = [];
    for (let i = 0; i < MAX_TAGS + 3; i++) many = addTag(many, { lat: 10 + i, lon: 10 }, `T${i}`);
    expect(many).toHaveLength(MAX_TAGS);
    expect(many[0].name).toBe('T3');
  });

  it('reads back only well-formed saved tags', () => {
    expect(readTags(null)).toEqual([]);
    expect(readTags('x')).toEqual([]);
    const good = { id: 'a', name: 'Home', lat: 29, lon: -82 };
    expect(readTags([good, { id: 'b', name: 'Bad', lat: 'x', lon: 0 }, { id: 'c', name: 'Far', lat: 95, lon: 0 }, null])).toEqual([good]);
  });
});

describe('tagged places are remembered', () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), dump: m };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('saves tags with the other choices and loads them next visit', () => {
    vi.stubGlobal('localStorage', storage());
    const store = createStore({ lat: 0, lon: 0 }, false);
    expect(store.get().tags).toEqual([]);
    store.set({ tags: addTag([], ocala, 'Home') });
    expect(createStore({ lat: 0, lon: 0 }, false).get().tags.map((t) => t.name)).toEqual(['Home']);
  });
});
