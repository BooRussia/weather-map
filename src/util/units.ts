export type TempUnit = 'F' | 'C';
export type WindUnit = 'mph' | 'kmh';

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kmhToMph = (k: number) => k / 1.609344;
export const mphToKmh = (m: number) => m * 1.609344;

export function formatTemp(tempF: number, unit: TempUnit): string {
  const v = unit === 'C' ? fToC(tempF) : tempF;
  return `${Math.round(v)}°`;
}

export function formatWind(mph: number, unit: WindUnit): string {
  return unit === 'kmh' ? `${Math.round(mphToKmh(mph))} km/h` : `${Math.round(mph)} mph`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass label for a bearing in degrees. */
export function compass16(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i];
}

/** 8-point label; shorter, used in the condition line. */
export function compass8(deg: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return labels[i];
}
