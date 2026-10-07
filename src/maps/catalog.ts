import type { FieldRamp } from '../map/fieldLayer';
import type { TempUnit, WindUnit } from '../util/units';

/**
 * The weather maps (Windy's "layers"): one colored variable at a time under
 * the radar, wind, and labels. Ramps are in metric base units — °C, m/s,
 * mm/h, m, hPa, J/kg — and legends convert to the user's units.
 */
export type WeatherMapId =
  | 'none'
  | 'wind'
  | 'gust'
  | 'temp'
  | 'feels'
  | 'rain'
  | 'rainTotal'
  | 'thunder'
  | 'clouds'
  | 'lowClouds'
  | 'humidity'
  | 'dewpoint'
  | 'pressure'
  | 'visibility'
  | 'waves'
  | 'swell'
  | 'currents'
  | 'sst'
  | 'aqi'
  | 'snowDepth'
  | 'newSnow'
  | 'infrared';

export interface Units {
  temp: TempUnit;
  wind: WindUnit;
}

/** A display unit: its label and how to convert from the map's base unit (and back). */
interface DisplayUnit {
  label: string;
  from(base: number): number;
  to(display: number): number;
  /** Legend tick values, in this unit. */
  ticks: number[];
  /** Decimals in readouts. */
  digits: number;
}

export interface WeatherMap {
  id: WeatherMapId;
  label: string;
  /** Short line under the label in the picker. */
  sub?: string;
  ramp: FieldRamp;
  /** Overall opacity over the basemap. */
  opacity: number;
  unit(u: Units): DisplayUnit;
}

const unit = (label: string, from: (b: number) => number, to: (d: number) => number, ticks: number[], digits = 0): DisplayUnit => ({
  label,
  from,
  to,
  ticks,
  digits,
});
const same = (label: string, ticks: number[], digits = 0) => unit(label, (b) => b, (d) => d, ticks, digits);

const imperial = (u: Units) => u.temp === 'F';
const tempUnit = (u: Units, fTicks: number[], cTicks: number[]) =>
  u.temp === 'F' ? unit('°F', (c) => (c * 9) / 5 + 32, (f) => ((f - 32) * 5) / 9, fTicks) : same('°C', cTicks);
const speedUnit = (u: Units, mphTicks: number[], kmhTicks: number[]) =>
  u.wind === 'mph' ? unit('mph', (ms) => ms * 2.236936, (m) => m / 2.236936, mphTicks) : unit('km/h', (ms) => ms * 3.6, (k) => k / 3.6, kmhTicks);

/* ---------- ramps (base units) ---------- */

const mph = (v: number) => v / 2.236936;
const F = (f: number) => ((f - 32) * 5) / 9;

/** Calm blue through teal, green, yellow, orange, red, magenta, to near-white storms. */
const WIND: FieldRamp = {
  stops: [
    [mph(0), 62, 76, 158, 1],
    [mph(5), 58, 118, 186, 1],
    [mph(10), 47, 160, 154, 1],
    [mph(15), 60, 176, 92, 1],
    [mph(20), 165, 190, 64, 1],
    [mph(25), 222, 192, 58, 1],
    [mph(32), 232, 145, 44, 1],
    [mph(40), 216, 72, 59, 1],
    [mph(50), 176, 58, 143, 1],
    [mph(65), 123, 79, 196, 1],
    [mph(80), 228, 222, 240, 1],
  ],
};

const TEMP: FieldRamp = {
  stops: [
    [F(-20), 196, 178, 236, 1],
    [F(0), 128, 112, 210, 1],
    [F(15), 78, 104, 200, 1],
    [F(32), 60, 142, 210, 1],
    [F(45), 64, 180, 182, 1],
    [F(55), 76, 190, 122, 1],
    [F(65), 166, 200, 74, 1],
    [F(75), 240, 198, 62, 1],
    [F(85), 240, 138, 54, 1],
    [F(95), 222, 74, 58, 1],
    [F(105), 180, 42, 82, 1],
    [F(115), 120, 30, 62, 1],
  ],
};

/** mm/h: nothing below a trace, then the radar's greens, yellow, orange, red, magenta. */
const RAIN: FieldRamp = {
  curve: 'sqrt',
  stops: [
    [0, 120, 210, 120, 0],
    [0.1, 118, 206, 112, 0.5],
    [1, 66, 182, 74, 0.75],
    [3, 28, 152, 52, 0.85],
    [6, 238, 214, 52, 0.9],
    [12, 246, 150, 30, 0.92],
    [25, 222, 34, 30, 0.94],
    [50, 202, 40, 168, 0.95],
  ],
};

/** Accumulated mm (next 24 h). */
const RAIN_TOTAL: FieldRamp = {
  curve: 'sqrt',
  stops: [
    [0, 120, 210, 120, 0],
    [0.5, 120, 200, 130, 0.45],
    [5, 60, 170, 110, 0.7],
    [15, 40, 140, 190, 0.8],
    [30, 90, 90, 200, 0.85],
    [60, 170, 70, 190, 0.9],
    [120, 230, 80, 120, 0.92],
    [250, 250, 200, 200, 0.95],
  ],
};

/** CAPE, J/kg: the fuel for thunderstorms. */
const CAPE: FieldRamp = {
  stops: [
    [0, 80, 160, 90, 0],
    [200, 80, 160, 90, 0.35],
    [800, 170, 196, 70, 0.7],
    [1500, 236, 196, 56, 0.82],
    [2500, 240, 128, 48, 0.88],
    [3500, 220, 52, 56, 0.9],
    [5000, 190, 60, 170, 0.92],
  ],
};

/** % cover: clear is see-through, overcast is white. */
const CLOUDS: FieldRamp = {
  stops: [
    [0, 210, 214, 222, 0],
    [20, 210, 214, 222, 0.12],
    [50, 222, 225, 232, 0.42],
    [80, 236, 238, 242, 0.68],
    [100, 248, 248, 250, 0.82],
  ],
};

const HUMIDITY: FieldRamp = {
  stops: [
    [0, 176, 132, 72, 1],
    [30, 196, 170, 96, 1],
    [50, 132, 176, 120, 1],
    [70, 72, 160, 170, 1],
    [90, 46, 112, 182, 1],
    [100, 40, 80, 170, 1],
  ],
};

const DEWPOINT: FieldRamp = {
  stops: [
    [F(0), 176, 132, 72, 1],
    [F(30), 196, 170, 96, 1],
    [F(50), 132, 180, 116, 1],
    [F(60), 64, 170, 120, 1],
    [F(65), 60, 150, 190, 1],
    [F(70), 90, 100, 200, 1],
    [F(75), 160, 80, 190, 1],
    [F(80), 210, 90, 150, 1],
  ],
};

const PRESSURE: FieldRamp = {
  stops: [
    [960, 150, 70, 170, 1],
    [985, 80, 90, 190, 1],
    [1000, 60, 150, 200, 1],
    [1013, 80, 180, 130, 1],
    [1022, 200, 196, 70, 1],
    [1032, 232, 140, 50, 1],
    [1045, 210, 60, 60, 1],
  ],
};

/** Metres: fog is white, clear air is see-through. */
const VISIBILITY: FieldRamp = {
  curve: 'sqrt',
  stops: [
    [0, 240, 240, 244, 0.85],
    [800, 220, 222, 230, 0.7],
    [3000, 180, 186, 204, 0.45],
    [8000, 150, 160, 190, 0.18],
    [16000, 150, 160, 190, 0],
  ],
};

/** Metres of wave height. */
const WAVES: FieldRamp = {
  stops: [
    [0, 43, 74, 139, 1],
    [0.6, 47, 127, 191, 1],
    [1.2, 47, 176, 160, 1],
    [1.8, 92, 193, 90, 1],
    [2.7, 216, 194, 60, 1],
    [3.7, 232, 134, 44, 1],
    [5.5, 214, 66, 58, 1],
    [7.6, 160, 58, 146, 1],
    [11, 228, 222, 240, 1],
  ],
};

/** m/s of current. */
const CURRENTS: FieldRamp = {
  stops: [
    [0, 30, 50, 100, 1],
    [0.2, 40, 90, 160, 1],
    [0.5, 50, 150, 170, 1],
    [1, 120, 190, 90, 1],
    [1.5, 230, 190, 60, 1],
    [2.2, 220, 80, 60, 1],
  ],
};

/** °C at the sea surface; 26.5 °C (80 °F) and warmer fuels hurricanes. */
const SST: FieldRamp = {
  stops: [
    [F(40), 70, 60, 160, 1],
    [F(55), 50, 110, 200, 1],
    [F(65), 50, 170, 190, 1],
    [F(75), 90, 190, 110, 1],
    [F(80), 230, 200, 60, 1],
    [F(85), 236, 120, 46, 1],
    [F(90), 200, 40, 60, 1],
  ],
};

/** U.S. AQI with the EPA's own category colors; good air stays nearly clear. */
const AQI: FieldRamp = {
  stops: [
    [0, 0, 200, 80, 0.15],
    [50, 0, 228, 0, 0.3],
    [75, 255, 255, 0, 0.55],
    [100, 255, 126, 0, 0.7],
    [150, 255, 0, 0, 0.78],
    [200, 143, 63, 151, 0.82],
    [300, 126, 0, 35, 0.86],
  ],
};

/** cm of snow on the ground (or new). */
const SNOW: FieldRamp = {
  curve: 'sqrt',
  stops: [
    [0, 200, 215, 240, 0],
    [0.5, 200, 215, 240, 0.45],
    [5, 150, 180, 236, 0.7],
    [15, 96, 136, 220, 0.82],
    [30, 110, 92, 200, 0.88],
    [60, 176, 126, 216, 0.92],
    [120, 240, 220, 250, 0.95],
  ],
};

/** Cloud-top brightness temperature, °C: warm is dark and clear, the coldest tops colored. */
const INFRARED: FieldRamp = {
  stops: [
    [-85, 200, 60, 200, 0.95],
    [-75, 230, 60, 50, 0.95],
    [-68, 240, 220, 60, 0.95],
    [-60, 90, 210, 80, 0.94],
    [-50, 60, 200, 220, 0.92],
    [-40, 70, 120, 220, 0.9],
    [-30, 200, 200, 210, 0.8],
    [-10, 130, 130, 140, 0.55],
    [10, 60, 60, 66, 0.25],
    [30, 0, 0, 0, 0],
  ],
};

/* ---------- the list ---------- */

export const WEATHER_MAPS: WeatherMap[] = [
  {
    id: 'wind',
    label: 'Wind',
    ramp: WIND,
    opacity: 0.85,
    unit: (u) => speedUnit(u, [0, 10, 20, 30, 45, 70], [0, 15, 30, 50, 75, 110]),
  },
  {
    id: 'gust',
    label: 'Wind gusts',
    ramp: WIND,
    opacity: 0.85,
    unit: (u) => speedUnit(u, [0, 10, 20, 30, 45, 70], [0, 15, 30, 50, 75, 110]),
  },
  {
    id: 'temp',
    label: 'Temperature',
    ramp: TEMP,
    opacity: 0.85,
    unit: (u) => tempUnit(u, [0, 32, 50, 70, 90, 110], [-20, 0, 10, 20, 30, 40]),
  },
  {
    id: 'feels',
    label: 'Feels like',
    ramp: TEMP,
    opacity: 0.85,
    unit: (u) => tempUnit(u, [0, 32, 50, 70, 90, 110], [-20, 0, 10, 20, 30, 40]),
  },
  {
    id: 'rain',
    label: 'Rain, snow',
    sub: 'Per hour',
    ramp: RAIN,
    opacity: 1,
    unit: (u) =>
      imperial(u) ? unit('in/h', (mm) => mm / 25.4, (i) => i * 25.4, [0.01, 0.05, 0.2, 0.5, 1, 2], 2) : same('mm/h', [0.2, 1, 3, 6, 12, 25, 50], 1),
  },
  {
    id: 'rainTotal',
    label: 'Rain total',
    sub: 'Next 24 h',
    ramp: RAIN_TOTAL,
    opacity: 1,
    unit: (u) => (imperial(u) ? unit('in', (mm) => mm / 25.4, (i) => i * 25.4, [0.1, 0.5, 1, 2, 4, 8], 2) : same('mm', [2, 10, 25, 50, 100, 200])),
  },
  {
    id: 'thunder',
    // Soft hyphen: wraps as "Thunder-storms" in a narrow tile.
    label: 'Thunder­storms',
    sub: 'Storm energy (CAPE)',
    ramp: CAPE,
    opacity: 1,
    unit: () => same('J/kg', [200, 1000, 2000, 3000, 4500]),
  },
  { id: 'clouds', label: 'Clouds', ramp: CLOUDS, opacity: 1, unit: () => same('%', [0, 25, 50, 75, 100]) },
  { id: 'lowClouds', label: 'Low clouds', ramp: CLOUDS, opacity: 1, unit: () => same('%', [0, 25, 50, 75, 100]) },
  { id: 'humidity', label: 'Humidity', ramp: HUMIDITY, opacity: 0.8, unit: () => same('%', [0, 25, 50, 75, 100]) },
  {
    id: 'dewpoint',
    label: 'Dew point',
    ramp: DEWPOINT,
    opacity: 0.8,
    unit: (u) => tempUnit(u, [20, 40, 55, 65, 75], [-5, 5, 13, 18, 24]),
  },
  {
    id: 'pressure',
    label: 'Pressure',
    ramp: PRESSURE,
    opacity: 0.75,
    unit: (u) =>
      imperial(u)
        ? unit('inHg', (h) => h * 0.02953, (i) => i / 0.02953, [29.2, 29.6, 29.9, 30.2, 30.6], 2)
        : same('hPa', [980, 1000, 1013, 1025, 1040]),
  },
  {
    id: 'visibility',
    label: 'Fog, visibility',
    ramp: VISIBILITY,
    opacity: 1,
    unit: (u) =>
      imperial(u) ? unit('mi', (m) => m / 1609.344, (mi) => mi * 1609.344, [0.25, 1, 3, 6, 10], 2) : unit('km', (m) => m / 1000, (k) => k * 1000, [0.5, 2, 5, 10, 16], 1),
  },
  {
    id: 'waves',
    label: 'Waves',
    ramp: WAVES,
    opacity: 0.9,
    unit: (u) => (imperial(u) ? unit('ft', (m) => m * 3.28084, (f) => f / 3.28084, [2, 6, 10, 18, 30]) : same('m', [1, 2, 3, 5, 9])),
  },
  {
    id: 'swell',
    label: 'Swell',
    ramp: WAVES,
    opacity: 0.9,
    unit: (u) => (imperial(u) ? unit('ft', (m) => m * 3.28084, (f) => f / 3.28084, [2, 6, 10, 18, 30]) : same('m', [1, 2, 3, 5, 9])),
  },
  {
    id: 'currents',
    label: 'Currents',
    ramp: CURRENTS,
    opacity: 0.9,
    unit: (u) => (u.wind === 'mph' ? unit('kt', (ms) => ms * 1.943844, (k) => k / 1.943844, [0.5, 1, 2, 3, 4], 1) : unit('km/h', (ms) => ms * 3.6, (k) => k / 3.6, [1, 2, 4, 6, 8])),
  },
  {
    id: 'sst',
    label: 'Sea temperature',
    sub: '80 °F fuels hurricanes',
    ramp: SST,
    opacity: 0.85,
    unit: (u) => tempUnit(u, [50, 65, 75, 80, 85, 90], [10, 18, 24, 27, 29, 32]),
  },
  { id: 'aqi', label: 'Air quality', sub: 'U.S. AQI', ramp: AQI, opacity: 1, unit: () => same('AQI', [0, 50, 100, 150, 200, 300]) },
  {
    id: 'snowDepth',
    label: 'Snow depth',
    ramp: SNOW,
    opacity: 1,
    unit: (u) => (imperial(u) ? unit('in', (cm) => cm / 2.54, (i) => i * 2.54, [1, 3, 6, 12, 24, 48]) : same('cm', [2, 8, 15, 30, 60, 120])),
  },
  {
    id: 'newSnow',
    label: 'New snow',
    sub: 'Next 24 h',
    ramp: SNOW,
    opacity: 1,
    unit: (u) => (imperial(u) ? unit('in', (cm) => cm / 2.54, (i) => i * 2.54, [1, 3, 6, 12, 24]) : same('cm', [2, 8, 15, 30, 60])),
  },
  {
    id: 'infrared',
    label: 'Infrared satellite',
    sub: 'Cloud-top cold',
    ramp: INFRARED,
    opacity: 1,
    unit: (u) => tempUnit(u, [-100, -60, -20, 32], [-70, -50, -30, 0]),
  },
];

export const weatherMap = (id: WeatherMapId): WeatherMap | null => WEATHER_MAPS.find((m) => m.id === id) ?? null;

/** The label without its soft hyphens, for text that isn't a narrow tile. */
export const plainLabel = (m: WeatherMap) => m.label.replace(/­/g, '');

/** A value in base units as display text: "78°F", "12 mph", "0.25 in/h". */
export function formatValue(m: WeatherMap, base: number, u: Units): string {
  const d = m.unit(u);
  const v = d.from(base);
  const n = d.digits ? v.toFixed(d.digits).replace(/\.?0+$/, '') : String(Math.round(v));
  return d.label.startsWith('°') ? `${n}${d.label}` : `${n} ${d.label}`;
}
