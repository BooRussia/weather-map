const DEG = Math.PI / 180;
export const MAX_MERC_LAT = 85.0511;

export const clampLat = (lat: number) => Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));

/** Wrap any longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === 180 ? -180 : w;
}

/** Web Mercator y in [−π, π] for a latitude in degrees (unitless). */
export function mercY(lat: number): number {
  const phi = clampLat(lat) * DEG;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

export function latFromMercY(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
}

/**
 * Wind vector from meteorological speed + direction.
 * Direction is where the wind comes FROM (0 = from north), so the vector
 * points the opposite way. u is east-positive, v is north-positive.
 */
export function windToUV(speed: number, fromDeg: number): { u: number; v: number } {
  const r = fromDeg * DEG;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/** Inverse of windToUV: returns speed and the FROM direction in [0, 360). */
export function uvToWind(u: number, v: number): { speed: number; fromDeg: number } {
  const speed = Math.hypot(u, v);
  const deg = (Math.atan2(-u, -v) / DEG + 360) % 360;
  return { speed, fromDeg: deg };
}
