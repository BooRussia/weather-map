import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import type { LatLon } from '../config';
import { currentFix, watchFix } from '../util/position';

/**
 * Your location as an Apple Maps-style blue dot with a pulsing halo. Once a
 * position is known it keeps watching (low power) so the dot moves with you.
 */
export class LocationDot {
  private marker: maplibregl.Marker | null = null;
  private watching = false;
  position: LatLon | null = null;

  constructor(
    private readonly map: MlMap,
    private readonly onMove: (p: LatLon) => void = () => {},
  ) {}

  /** Ask for a fresh fix (user gesture: high accuracy). Resolves null if denied or unavailable. */
  locate(highAccuracy = true, timeoutMs = 10_000): Promise<LatLon | null> {
    return currentFix({ enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 60_000 }).then((p) => {
      if (p) {
        this.set(p);
        this.watch();
      }
      return p;
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
    if (this.watching) return;
    this.watching = true;
    watchFix({ enableHighAccuracy: false, maximumAge: 120_000 }, (p) => {
      this.set(p);
      this.onMove(p);
    });
  }
}
