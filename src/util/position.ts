import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { LatLon } from '../config';

/** Inside the iPhone app (Capacitor), not a browser tab or the home-screen web app. */
export const isNative = Capacitor.isNativePlatform();

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Where you are. In a browser, the page's own geolocation; inside the iPhone app, iOS's through
 * Capacitor's plugin, since the web view's own asks twice there (once for the app, again for its page).
 * Null if it's denied, unavailable, or too slow.
 */
export function currentFix(opts: PositionOptions): Promise<LatLon | null> {
  if (isNative) {
    return Geolocation.getCurrentPosition(opts)
      .then((p) => ({ lat: p.coords.latitude, lon: p.coords.longitude }))
      .catch(() => null);
  }
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      opts,
    );
  });
}

/** Follow you as you move (errors are ignored: the last fix stays). */
export function watchFix(opts: PositionOptions, onFix: (p: LatLon) => void): void {
  if (isNative) {
    void Geolocation.watchPosition(opts, (p) => {
      if (p) onFix({ lat: p.coords.latitude, lon: p.coords.longitude });
    }).catch(() => {});
    return;
  }
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => {},
    opts,
  );
}

/** Whether asking would prompt, without asking. */
export async function locationPermission(): Promise<GeoPermission> {
  try {
    if (isNative) {
      const { location } = await Geolocation.checkPermissions();
      return location === 'granted' || location === 'denied' ? location : 'prompt';
    }
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
