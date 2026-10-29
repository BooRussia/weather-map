import { describe, expect, it } from 'vitest';
import { csvFields, joinTfrs, parseGairmets, parseMetars, parsePireps, parseTafs, stationNames } from '../scripts/aviation.mjs';
import { ago, ceilingFt, intensityRank, levelText, pirepColor, tafLines, windText, zulu } from '../src/data/aviation';
import { atAltitude, capeWord, cloudbaseFt, lapseRate, lapseWord, windsAloft } from '../src/data/aloft';

const HEAD =
  'raw_text,station_id,observation_time,latitude,longitude,temp_c,dewpoint_c,wind_dir_degrees,wind_speed_kt,wind_gust_kt,visibility_statute_mi,altim_in_hg,sea_level_pressure_mb,corrected,auto,auto_station,maintenance_indicator_on,no_signal,lightning_sensor_off,freezing_rain_sensor_off,present_weather_sensor_off,wx_string,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,flight_category,three_hr_pressure_tendency_mb,maxT_c,minT_c,maxT24hr_c,minT24hr_c,precip_in,pcp3hr_in,pcp6hr_in,pcp24hr_in,snow_in,vert_vis_ft,metar_type,elevation_m';

describe('the airport weather relay', () => {
  it('splits CSV lines, quotes and all', () => {
    expect(csvFields('"METAR KOCF 291849Z, odd",KOCF,,3')).toEqual(['METAR KOCF 291849Z, odd', 'KOCF', '', '3']);
  });

  it('keeps each METAR compact, with its cloud layers as METAR writes them', () => {
    const line =
      '"SPECI KOCF 291849Z 02007KT 10SM SCT027 BKN070 26/22 A3005",KOCF,2026-10-29T18:49:00.000Z,29.1636,-82.2210,26,22,20,7,,10+,30.05,,,,,,,,,,,SCT,2700,BKN,7000,,,,,VFR,,,,,,,,,,,,SPECI,27';
    const old = line.replace('2026-10-29T18:49', '2026-10-29T10:49').replace('KOCF,', 'KOLD,');
    const rows = parseMetars(`${HEAD}\n${line}\n${old}`, Date.parse('2026-10-29T19:00:00Z'));
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 5)).toEqual(['KOCF', 29.1636, -82.221, Date.parse('2026-10-29T18:49:00Z') / 1000, 'VFR']);
    expect(rows[0][14]).toBe('SCT027 BKN070');
  });

  it('keeps each station\'s latest TAF', () => {
    const xml =
      '<TAF><raw_text><![CDATA[TAF KTPA 291737Z 2918/3024 03008G16KT P6SM BKN050]]></raw_text><station_id>KTPA</station_id><issue_time>2026-10-29T17:37:00.000Z</issue_time></TAF>' +
      '<TAF><raw_text><![CDATA[TAF KTPA 291130Z older]]></raw_text><station_id>KTPA</station_id><issue_time>2026-10-29T11:30:00.000Z</issue_time></TAF>';
    expect(parseTafs(xml).KTPA[1]).toContain('291737Z');
  });

  it('names stations with their state', () => {
    expect(stationNames([{ icaoId: 'KOCF', site: 'Ocala Rgnl', state: 'FL' }])).toEqual({ KOCF: 'Ocala Rgnl, FL' });
  });
});

describe('reading a METAR', () => {
  it('finds the ceiling: the lowest broken or overcast layer', () => {
    expect(ceilingFt('FEW010 SCT027 BKN070 OVC120', null)).toBe(7000);
    expect(ceilingFt('FEW010 SCT027', null)).toBeNull();
    expect(ceilingFt('', 300)).toBe(300);
  });

  it('says the wind the way pilots do', () => {
    expect(windText({ windDir: 20, windKt: 7, gustKt: 15 })).toBe('020° at 7 kt, gusts 15');
    expect(windText({ windDir: 0, windKt: 4, gustKt: null })).toBe('Variable at 4 kt');
    expect(windText({ windDir: 0, windKt: 0, gustKt: null })).toBe('Calm');
  });

  it('breaks a TAF at each change group', () => {
    expect(tafLines('TAF KTPA 291737Z 2918/3024 03008KT P6SM BKN050 FM300200 03007KT P6SM BKN250 TEMPO 3002/3006 3SM BR')).toEqual([
      'TAF KTPA 291737Z 2918/3024 03008KT P6SM BKN050',
      'FM300200 03007KT P6SM BKN250',
      'TEMPO 3002/3006 3SM BR',
    ]);
  });

  it('writes times in Zulu, and ages', () => {
    const t = Date.parse('2026-10-29T18:49:00Z');
    expect(zulu(t)).toBe('18:49Z');
    expect(ago(t, t + 14 * 60_000)).toBe('14 min ago');
    expect(ago(t, t + 125 * 60_000)).toBe('2 h 5 min ago');
  });
});

describe('the air above', () => {
  const hour = {
    time: '2026-10-29T14:00',
    surface: { tempC: 25, dewC: 20.5, pressureHpa: 1014 },
    levels: [
      { hpa: 1000, ft: 495, tempC: 24.4, dewC: 19.9, dir: 47, kt: 16.9 },
      { hpa: 925, ft: 2723, tempC: 18.4, dewC: 17.4, dir: 55, kt: 20.1 },
      { hpa: 850, ft: 5089, tempC: 14.1, dewC: 13, dir: 69, kt: 17.4 },
      { hpa: 700, ft: 10413, tempC: 8.2, dewC: -5.4, dir: 53, kt: 7.4 },
      { hpa: 500, ft: 19324, tempC: -6.3, dewC: -30.4, dir: 268, kt: 9.9 },
    ],
    freezingFt: 16700,
    mixingFt: 3445,
    cape: 350,
    liftedIndex: -0.9,
    cin: 56,
  };

  it('reads the wind between levels as a turning vector', () => {
    const at = atAltitude(hour.levels, 6000)!;
    expect(at.kt).toBeGreaterThan(14);
    expect(at.dir).toBeGreaterThan(60);
    expect(at.dir).toBeLessThan(70);
    expect(atAltitude(hour.levels, 30000)).toBeNull();
  });

  it('gives the standard altitudes at least 1,500 ft above the ground', () => {
    expect(windsAloft(hour, 98).map((r) => r.ft)).toEqual([3000, 6000, 9000, 12000, 18000]);
    expect(windsAloft(hour, 2000).map((r) => r.ft)).toEqual([6000, 9000, 12000, 18000]);
  });

  it('puts cloudbase about 400 ft per degree of spread, and words the lapse rate', () => {
    expect(cloudbaseFt(25, 20.5)).toBeCloseTo(1845);
    const rate = lapseRate(hour, 98)!;
    expect(rate).toBeGreaterThan(1.5);
    expect(rate).toBeLessThan(3);
    expect(lapseWord(3)).toMatch(/Unstable/);
    expect(capeWord(350)).toBe('Marginal');
  });
});

describe('advisories and pilot reports', () => {
  it('keeps the G-AIRMET hazards drawn as areas, not the freezing-level lines', () => {
    const area = [
      { lat: '31', lon: '-78' },
      { lat: '30', lon: '-77' },
      { lat: '29', lon: '-78' },
    ];
    const got = parseGairmets([
      { hazard: 'ICE', geometryType: 'AREA', severity: 'MOD', base: 'FZL', top: '180', validTime: '2026-10-29T18:00:00Z', coords: area },
      { hazard: 'FZLVL', geometryType: 'LINE', coords: area },
    ]);
    expect(got.map((g) => g.hazard)).toEqual(['ICE']);
    expect(got[0].area[0]).toEqual([-78, 31]);
  });

  it('keeps pilot reports, not airline position reports, and marks urgent ones', () => {
    const head = 'receipt_time,observation_time,latitude,longitude,altitude_ft_msl,aircraft_ref,turbulence_type,turbulence_intensity,icing_type,icing_intensity,report_type,raw_text';
    const csv = [
      head,
      '2026-10-29T18:57:17Z,2026-10-29T18:53:00Z,45.27,-123.68,6000,M20P,,,RIME,LGT,PIREP,UA /OV UBG240030/TM 1853/FL060/TP M20P/IC LGT RIME',
      '2026-10-29T18:57:17Z,2026-10-29T18:52:00Z,40.35,-79.93,3000,C172,,SEV,,,PIREP,UUA /OV KAGC/TM 1852/FL030/TP C172/TB SEV',
      '2026-10-29T18:59:31Z,2026-10-29T18:59:00Z,51.8,-30.8,40000,VJT993,,,,,AIREP,ARP VJT993 5148N03049W',
    ].join('\n');
    const got = parsePireps(csv);
    expect(got).toHaveLength(2);
    expect(got[0][6]).toBe('LGT RIME');
    expect(got[1][8]).toBe(true);
  });

  it('joins TFR shapes to their kind by NOTAM number', () => {
    const shapes = { features: [{ properties: { NOTAM_KEY: '6/4240-1-FDC-F', STATE: 'TX', TITLE: 'X' }, geometry: { type: 'Polygon', coordinates: [[[-100.47335512, 31.2], [-100.4, 31.3], [-100.3, 31.2], [-100.47335512, 31.2]]] } }] };
    const got = joinTfrs(shapes, [{ notam_id: '6/4240', type: 'SECURITY', description: 'SAN ANGELO, TX' }]);
    expect(got[0]).toMatchObject({ id: '6/4240', kind: 'SECURITY', title: 'SAN ANGELO, TX', state: 'TX' });
  });

  it('words levels and colors reports by the worst they met', () => {
    expect(levelText('SFC')).toBe('the surface');
    expect(levelText('180')).toBe('FL180');
    expect(levelText('090')).toBe('9,000 ft');
    expect(intensityRank('LGT-MOD')).toBe(2);
    expect(pirepColor({ turbulence: 'NEG', icing: 'MOD RIME' })).toBe('#ff9f0a');
  });
});

