import type { LatLon } from '../config';
import { currentFix, locationPermission, type GeoPermission } from '../util/position';

export type { GeoPermission };

export function getPosition(timeoutMs = 8000): Promise<LatLon | null> {
  return currentFix({ enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60_000 });
}

export function geoPermission(): Promise<GeoPermission> {
  return locationPermission();
}
