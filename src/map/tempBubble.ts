import { Marker, type Map as MlMap } from 'maplibre-gl';
import type { LatLon } from '../config';

/** How far above the point the sign sits, px, clear of what marks it: the blue dot, a pin, or nothing. */
const LIFT = { dot: 15, pin: 34, point: 8 } as const;
export type BubbleOver = keyof typeof LIFT;

/**
 * Phones: the temperature right now as a little sign on the map, over the spot it's for (owner,
 * 2026-10-23: out of the banner, onto the map). With your location it grows out of your blue dot and
 * rides above it, never over it, so you can still see the dot itself; elsewhere it sits over the
 * pinned place. It scales a little with zoom, and pops when the reading changes.
 */
export class TempBubble {
  private readonly el = document.createElement('div');
  private readonly inner = document.createElement('div');
  private readonly marker: Marker;
  private shown = false;
  private text = '';

  constructor(private readonly map: MlMap) {
    this.el.className = 'temp-bubble';
    this.el.setAttribute('aria-hidden', 'true');
    this.inner.className = 'temp-bubble-in';
    this.el.append(this.inner);
    this.marker = new Marker({ element: this.el, anchor: 'bottom', offset: [0, -LIFT.point] });
    map.on('zoom', () => this.scale());
  }

  set(at: LatLon | null, text: string | null, over: BubbleOver): void {
    if (!at || !text) {
      if (this.shown) this.marker.remove();
      this.shown = false;
      this.text = '';
      return;
    }
    this.marker.setLngLat([at.lon, at.lat]).setOffset([0, -LIFT[over]]);
    if (text !== this.text) {
      this.inner.textContent = text;
      // A fresh sign grows out of the spot; a new reading on one already up just pops.
      this.pop(this.shown ? 'is-bump' : 'is-in');
      this.text = text;
    }
    if (!this.shown) {
      this.marker.addTo(this.map);
      this.shown = true;
    }
    this.scale();
  }

  private pop(cls: 'is-in' | 'is-bump'): void {
    this.inner.classList.remove('is-in', 'is-bump');
    void this.inner.offsetWidth;
    this.inner.classList.add(cls);
  }

  /** A touch smaller zoomed out, a touch bigger zoomed in. */
  private scale(): void {
    const k = Math.min(1.12, Math.max(0.8, 0.8 + (this.map.getZoom() - 4) * 0.05));
    this.el.style.setProperty('--k', k.toFixed(3));
  }
}
