export type TempUnit = 'F' | 'C';
/** Knots too (owner, 2026-10-29: pilot features). */
export type WindUnit = 'mph' | 'kmh' | 'kt';

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kmhToMph = (k: number) => k / 1.609344;
export const mphToKmh = (m: number) => m * 1.609344;
export const mphToKt = (m: number) => m / 1.150779;

/** A speed in mph in the chosen unit. */
export const windIn = (mph: number, unit: WindUnit) => (unit === 'kmh' ? mphToKmh(mph) : unit === 'kt' ? mphToKt(mph) : mph);
export const windLabel = (unit: WindUnit) => (unit === 'kmh' ? 'km/h' : unit === 'kt' ? 'kt' : 'mph');

export function formatTemp(tempF: number, unit: TempUnit): string {
  const v = unit === 'C' ? fToC(tempF) : tempF;
  return `${Math.round(v)}°`;
}

export function formatWind(mph: number, unit: WindUnit): string {
  return `${Math.round(windIn(mph, unit))} ${windLabel(unit)}`;
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
