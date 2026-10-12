import { describe, expect, it } from 'vitest';
import { labels, placeName, roadLine } from '../scripts/cameras.mjs';
import { camera, camerasGeoJSON, imageUrl, miles, nearby, type CameraData } from '../src/data/cameras';

describe('camera names from DOT labels', () => {
  const name = (label: string, road: string, dir: string) => labels(placeName(label) || 'Traffic camera', roadLine(road, dir));

  it('leaves the DOTs’ own codes off', () => {
    expect(name('0517N_75_Alligator_Alley_M052', 'I-75', 'Northbound')).toEqual(['Alligator Alley MM 52', 'I-75 · Northbound']);
    expect(name('ALPH-0050: Rucker Rd at Charlotte Dr (Alpharetta)', 'Rucker Rd', 'Eastbound')).toEqual([
      'Rucker Rd at Charlotte Dr (Alpharetta)',
      'Rucker Rd · Eastbound',
    ]);
    expect(name('CAM 147 Danbury I-84 WB Exit 7 - Rockwell Rd.', 'I-84', 'Westbound')[0]).toBe('Danbury I-84 WB Exit 7 - Rockwell Rd.');
  });

  it('keeps street numbers, spells out "@", and drops directions that say nothing', () => {
    expect(name('13400 S at Rosecrest Rd / 5600 W, HRR', '13400 S', 'Eastbound')[0]).toBe('13400 S at Rosecrest Rd / 5600 W, HRR');
    expect(name('SR-95 @SR-68 Laughlin Rd', 'SR-95', '')).toEqual(['SR-95 at SR-68 Laughlin Rd', 'SR-95']);
    expect(name('I-39/US 51 at County B', 'I-39/US 51', 'Unknown')).toEqual(['I-39/US 51 at County B', 'I-39/US 51']);
  });

  it('never says the same thing twice', () => {
    expect(name('US50 Little Antelope WP MM22', 'US50 Little Antelope WP MM22', '')).toEqual(['US50 Little Antelope WP MM22', '']);
    // The longer line wins the title.
    expect(name('I-10', 'I-10 at Terrace Ave.', '')).toEqual(['I-10 at Terrace Ave.', '']);
  });
});

describe('camera data', () => {
  const d: CameraData = {
    generated: '2026-10-12T09:23:00Z',
    sources: [
      { id: 'fl', name: 'FL511', agency: 'Florida DOT', site: 'https://fl511.com/', img: 'https://fl511.com/map/Cctv/{id}', refresh: 60 },
      { id: 'ca', name: 'Caltrans', agency: 'California DOT', site: 'https://quickmap.dot.ca.gov/', img: '{id}', refresh: 120 },
    ],
    cams: [
      [30.44, -84.28, 0, 'Monroe St at Tennessee St', 'US 27 · Northbound', [[42, 0]]],
      [30.45, -84.29, 0, 'Two views', '', [[43, 0], [44, 'https://cdn.example/a.m3u8']]],
      [34.06, -118.25, 1, '1st St', 'I-110 · South', [['https://cwwp2.dot.ca.gov/x.jpg', 'https://wzmedia.dot.ca.gov/x.m3u8']]],
      [30.9, -84.28, 0, 'Far north', '', [[45, 0]]],
    ],
  };

  it('builds each view’s image from its source, and its open stream or none', () => {
    expect(imageUrl(d.sources[0], 42)).toBe('https://fl511.com/map/Cctv/42');
    const fl = camera(d, 1);
    expect(fl.views).toEqual([
      { image: 'https://fl511.com/map/Cctv/43', video: null },
      { image: 'https://fl511.com/map/Cctv/44', video: 'https://cdn.example/a.m3u8' },
    ]);
    const ca = camera(d, 2);
    expect(ca.source.name).toBe('Caltrans');
    expect(ca.views[0]).toEqual({ image: 'https://cwwp2.dot.ca.gov/x.jpg', video: 'https://wzmedia.dot.ca.gov/x.m3u8' });
  });

  it('puts every camera on the map, lon before lat, marked when any view is live', () => {
    const fc = camerasGeoJSON(d);
    expect(fc.features).toHaveLength(4);
    expect(fc.features[0].geometry.coordinates).toEqual([-84.28, 30.44]);
    expect(fc.features.map((f) => f.properties.live)).toEqual([0, 1, 1, 0]);
    expect(fc.features[3].properties.i).toBe(3);
  });

  it('lists the nearest cameras within reach, nearest first', () => {
    expect(miles(30.44, -84.28, 30.45, -84.29)).toBeCloseTo(0.9, 1);
    const near = nearby(d, 0, 8, 25);
    expect(near.map((n) => n.i)).toEqual([1]);
    expect(nearby(d, 0, 8, 40).map((n) => n.i)).toEqual([1, 3]);
    // Across the country isn't nearby.
    expect(nearby(d, 2).length).toBe(0);
  });
});
