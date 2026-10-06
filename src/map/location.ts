import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import type { LatLon } from '../config';

/**
 * Your location as an Apple Maps-style blue dot with a pulsing halo. Once a
 * position is known it keeps watching (low power) so the dot moves with you.
 */
export class LocationDot {
  private marker: maplibregl.Marker | null = null;
  private watchId: number | null = null;
  position: LatLon | null = null;

  constructor(
    private readonly map: MlMap,
    private readonly onMove: (p: LatLon) => void = () => {},
  ) {}

  /** Ask for a fresh fix (user gesture: high accuracy). Resolves null if denied or unavailable. */
  locate(highAccuracy = true, timeoutMs = 10_000): Promise<LatLon | null> {
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          this.set(p);
          this.watch();
          resolve(p);
        },
        () => resolve(null),
        { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 60_000 },
      );
    });
  }

  set(p: LatLon): void {
    this.position = p;
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'loc-dot';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Your location');
      el.innerHTML = '<span class="loc-halo"></span><span class="loc-core"></span>';
      this.marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(this.map);
    } else {
      this.marker.setLngLat([p.lon, p.lat]);
    }
  }

  private watch(): void {
    if (this.watchId != null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        this.set(p);
        this.onMove(p);
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 120_000 },
    );
  }
}
