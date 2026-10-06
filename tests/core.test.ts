import { describe, expect, it } from 'vitest';
import { latFromMercY, mercY, uvToWind, windToUV, wrapLon } from '../src/util/geo';
import { countWords, limitWords, sentenceCase, formatCoord } from '../src/util/text';
import { compass16, compass8, formatTemp, formatWind } from '../src/util/units';
import { planGrid, rainIntensity, WeatherGrid, type FieldSample } from '../src/field/grid';
import type { GridSample } from '../src/data/openmeteo';
import { placeLabel, rankAlerts, type Alert, type NwsPoint } from '../src/data/nws';
import { parseColor, toGray, desaturateStyle } from '../src/map/style';
import { conditionLine } from '../src/ui/format';
import { reflow, shortPeriodName } from '../src/ui/format';
import { makeStrike } from '../src/layers/thunder';

describe('wind vectors', () => {
  it('wind FROM the north blows south (v < 0)', () => {
    const { u, v } = windToUV(10, 0);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-10);
  });

  it('wind FROM the west blows east (u > 0)', () => {
    const { u, v } = windToUV(10, 270);
    expect(u).toBeCloseTo(10);
    expect(v).toBeCloseTo(0);
  });

  it('round-trips speed and direction', () => {
    for (const deg of [0, 45, 135, 200, 315]) {
      const { u, v } = windToUV(7, deg);
      const back = uvToWind(u, v);
      expect(back.speed).toBeCloseTo(7);
      expect(back.fromDeg).toBeCloseTo(deg);
    }
  });
});

describe('geo', () => {
  it('wraps longitudes into [-180, 180)', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(-82.46)).toBeCloseTo(-82.46);
  });

  it('mercator y round-trips', () => {
    for (const lat of [-60, 0, 29.05, 70]) expect(latFromMercY(mercY(lat))).toBeCloseTo(lat);
  });
});

describe('text', () => {
  it('counts words, ignoring lone separators', () => {
    expect(countWords('Partly cloudy · Wind SE 9 mph')).toBe(6);
  });

  it('limits to N words and drops a dangling separator', () => {
    expect(limitWords('one two three · four', 3)).toBe('one two three');
    expect(limitWords('a b c', 12)).toBe('a b c');
  });

  it('sentence-cases NWS title case', () => {
    expect(sentenceCase('Chance Showers And Thunderstorms')).toBe('Chance showers and thunderstorms');
  });

  it('formats coordinates with hemispheres', () => {
    expect(formatCoord(51.5072, -0.1276)).toBe('51.51°N 0.13°W');
  });
});

describe('units', () => {
  it('formats temperature in both units', () => {
    expect(formatTemp(72, 'F')).toBe('72°');
    expect(formatTemp(212, 'C')).toBe('100°');
  });

  it('formats wind in both units', () => {
    expect(formatWind(10, 'mph')).toBe('10 mph');
    expect(formatWind(10, 'kmh')).toBe('16 km/h');
  });

  it('labels compass points', () => {
    expect(compass16(110)).toBe('ESE');
    expect(compass8(350)).toBe('N');
    expect(compass8(135)).toBe('SE');
  });
});

describe('condition line', () => {
  it('stays at 12 words or fewer', () => {
    const line = conditionLine(
      {
        condition: 'Severe thunderstorms with hail and very heavy rain and frequent lightning nearby',
        windMph: 30,
        windFromDeg: 225,
        gustMph: 55,
      },
      'mph',
    );
    expect(countWords(line)).toBeLessThanOrEqual(12);
  });

  it('includes gusts only when they stand out', () => {
    expect(conditionLine({ condition: 'Clear', windMph: 9, windFromDeg: 135, gustMph: 12 }, 'mph')).toBe(
      'Clear · Wind SE 9 mph',
    );
    expect(conditionLine({ condition: 'Clear', windMph: 9, windFromDeg: 135, gustMph: 21 }, 'mph')).toBe(
      'Clear · Wind SE 9 mph, gusts 21',
    );
  });

  it('says calm under 1 mph', () => {
    expect(conditionLine({ condition: 'Partly cloudy', windMph: 0.4, windFromDeg: 90, gustMph: null }, 'mph')).toBe(
      'Partly cloudy · Calm',
    );
  });
});

describe('grid', () => {
  const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

  it('picks the finest anchored lattice within the point budget, shaped to the view', () => {
    // A phone at zoom 7 over Florida: tall and narrow.
    const phone = planGrid({ west: -83.5, east: -81.4, south: 27.1, north: 31 }, 100);
    expect(phone.points.length).toBeLessThanOrEqual(100);
    expect(phone.points).toHaveLength(phone.spec.cols * phone.spec.rows);
    expect(phone.spec.rows).toBeGreaterThan(phone.spec.cols);
    expect((phone.spec.east - phone.spec.west) / (phone.spec.cols - 1)).toBe(0.5);
    expect((phone.spec.north - phone.spec.south) / (phone.spec.rows - 1)).toBe(0.5);
    // Every point sits on the 0.5° lattice anchored at 0°.
    expect(phone.points.every((p) => Number.isInteger(p.lat / 0.5) && Number.isInteger(p.lon / 0.5))).toBe(true);
  });

  it('samples the same points when panning, and keeps them when zooming in', () => {
    const a = planGrid({ west: -84, east: -80, south: 27, north: 31 }, 100);
    const panned = planGrid({ west: -83.8, east: -79.8, south: 27.1, north: 31.1 }, 100);
    const step = (g: typeof a) => (g.spec.east - g.spec.west) / (g.spec.cols - 1);
    expect(step(panned)).toBe(step(a));
    const shared = new Set(a.points.map(key));
    expect(panned.points.filter((p) => shared.has(key(p))).length).toBeGreaterThan(a.points.length / 2);

    // Zoomed in: a finer lattice that still contains the coarse points inside it.
    const fine = planGrid({ west: -82.6, east: -81.4, south: 28.4, north: 29.6 }, 100);
    expect(step(fine)).toBeLessThan(step(a));
    const finePts = new Set(fine.points.map(key));
    const coarseInside = a.points.filter((p) => p.lon >= fine.spec.west && p.lon <= fine.spec.east && p.lat >= fine.spec.south && p.lat <= fine.spec.north);
    expect(coarseInside.length).toBeGreaterThan(0);
    expect(coarseInside.every((p) => finePts.has(key(p)))).toBe(true);
  });

  it('blends two hours of wind as components, so it turns instead of jumping', () => {
    const spec = { west: 0, east: 1, south: 0, north: 1, cols: 2, rows: 2 };
    const at = (fromDeg: number): GridSample[] =>
      Array.from({ length: 4 }, () => ({ windMph: 10, windFromDeg: fromDeg, precipRate: 0, precipProbability: 0, weatherCode: 0 }));
    const north = new WeatherGrid(spec, at(0), 0, 7);
    const east = new WeatherGrid(spec, at(90), 0, 7);
    const mid = WeatherGrid.blend(north, east, 0.5);
    const s: FieldSample = { u: 0, v: 0, rain: 0, storm: false };
    mid.sampleAt(0.5, 0.5, s);
    // From the north-east: blowing toward the south-west.
    expect(s.u).toBeCloseTo(-5);
    expect(s.v).toBeCloseTo(-5);
  });

  it('pads beyond the view and covers it', () => {
    const b = { west: -84, east: -80, south: 27, north: 31 };
    const { spec, points } = planGrid(b, 100);
    const samples: GridSample[] = points.map(() => ({
      windMph: 10,
      windFromDeg: 270,
      precipRate: 0,
      precipProbability: 0,
      weatherCode: 0,
    }));
    const g = new WeatherGrid(spec, samples, Date.now(), 7);
    expect(g.covers(b)).toBe(true);
    expect(g.covers({ ...b, west: -90 })).toBe(false);
  });

  it('interpolates bilinearly between lattice points', () => {
    const spec = { west: 0, east: 1, south: 0, north: 1, cols: 2, rows: 2 };
    const mk = (windMph: number, weatherCode = 0): GridSample => ({
      windMph,
      windFromDeg: 270,
      precipRate: 0,
      precipProbability: 0,
      weatherCode,
    });
    // Row-major, north row first: NW, NE, SW, SE.
    const g = new WeatherGrid(spec, [mk(0), mk(10), mk(0), mk(10, 95)], 0, 7);
    const s: FieldSample = { u: 0, v: 0, rain: 0, storm: false };
    g.sampleAt(0.5, 0.5, s);
    expect(s.u).toBeCloseTo(5);
    g.sampleAt(1, 1, s);
    expect(s.storm).toBe(true);
    expect(g.stormCells()).toHaveLength(1);
  });

  it('rain intensity rises with rate and probability, zero when dry', () => {
    expect(rainIntensity(0, 100)).toBe(0);
    expect(rainIntensity(2, 90)).toBeGreaterThan(rainIntensity(0.5, 90));
    expect(rainIntensity(2, 90)).toBeGreaterThan(rainIntensity(2, 20));
    expect(rainIntensity(50, 100)).toBeLessThanOrEqual(1);
  });
});

describe('NWS helpers', () => {
  const base: NwsPoint = {
    city: 'Reddick',
    state: 'FL',
    distanceM: 4893,
    bearing: 110,
    forecastUrl: '',
    forecastHourlyUrl: '',
    stationsUrl: '',
    timeZone: 'America/New_York',
  };

  it('labels the place relative to the nearest city', () => {
    expect(placeLabel(base)).toBe('3 mi ESE of Reddick, FL');
    expect(placeLabel({ ...base, distanceM: 500 })).toBe('Reddick, FL');
  });

  it('ranks the most severe alert first', () => {
    const a = (event: string, severity: Alert['severity'], urgency = 'Expected'): Alert => ({
      id: event,
      event,
      headline: event,
      severity,
      urgency,
      areaDesc: '',
      description: '',
      instruction: '',
      sender: 'NWS',
      effective: null,
      ends: null,
    });
    const ranked = rankAlerts([a('Heat Advisory', 'Moderate'), a('Tornado Warning', 'Extreme', 'Immediate'), a('Flood Watch', 'Severe')]);
    expect(ranked.map((x) => x.event)).toEqual(['Tornado Warning', 'Flood Watch', 'Heat Advisory']);
  });

  it('reflows hard-wrapped alert text but keeps paragraphs', () => {
    expect(reflow('* WHAT...Flooding caused\nby rain.\n\n* WHERE...Duval.')).toBe(
      '* WHAT...Flooding caused by rain.\n\n* WHERE...Duval.',
    );
  });

  it('shortens forecast period names', () => {
    expect(shortPeriodName('Wednesday Night')).toBe('Wed night');
    expect(shortPeriodName('Thursday')).toBe('Thu');
    expect(shortPeriodName('This Afternoon')).toBe('This afternoon');
  });
});

describe('basemap desaturation', () => {
  it('parses hex, rgb(a), and hsl colors', () => {
    expect(parseColor('#2C353C')).toEqual([44, 53, 60, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('match')).toBeNull();
  });

  it('keeps lightness and drops hue', () => {
    expect(toGray('#ffffff')).toBe('rgb(255, 255, 255)');
    expect(toGray('rgba(63, 90, 109, 0.5)')).toBe('rgba(86, 86, 86, 0.5)');
  });

  it('walks paint expressions and leaves non-colors alone', () => {
    const style = desaturateStyle({
      layers: [
        {
          paint: {
            'fill-color': ['interpolate', ['linear'], ['zoom'], 5, '#2C353C', 10, 'rgba(63, 90, 109, 1)'],
            'fill-opacity': 0.5,
          },
        },
      ],
    });
    expect(style.layers[0].paint!['fill-color']).toEqual(['interpolate', ['linear'], ['zoom'], 5, 'rgb(52, 52, 52)', 10, 'rgb(86, 86, 86)']);
    expect(style.layers[0].paint!['fill-opacity']).toBe(0.5);
  });
});

describe('lightning geometry', () => {
  it('ends the bolt at the strike point', () => {
    const s = makeStrike(-82, 29, 0);
    const n = s.bolt.length;
    expect(s.bolt[n - 2]).toBeCloseTo(0);
    expect(s.bolt[n - 1]).toBeCloseTo(0);
    expect(s.bolt[1]).toBeLessThan(0); // starts above the strike point
    expect(s.branch.length).toBeGreaterThan(4);
  });
});
