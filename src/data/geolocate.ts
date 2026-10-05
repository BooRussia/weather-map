import type { LatLon } from '../config';

export function getPosition(timeoutMs = 8000): Promise<LatLon | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60_000 },
    );
  });
}

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function geoPermission(): Promise<GeoPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
