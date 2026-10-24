import { Marker, type Map as MlMap } from 'maplibre-gl';
import type { LatLon } from '../config';

/** How far above the point the sign sits, px, clear of what marks it: the blue dot, a pin, or nothing. */
const LIFT = { dot: 15, pin: 34, point: 8 } as const;
export type BubbleOver = keyof typeof LIFT;

/** Dark type on the light end of the temperature ramp (sky, green, yellow, orange), white on the rest. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.36 ? '#1c1c1e' : '#ffffff';
}

/**
 * Phones: the temperature right now as a little sign on the map, over the spot it's for (owner,
 * 2026-10-23: out of the banner, onto the map). With your location it grows out of your blue dot and
 * rides above it, never over it, so you can still see the dot itself; elsewhere it sits over the
 * pinned place. It scales a little with zoom, and pops when the reading changes. Apple Weather's map
 * style (owner, 2026-10-24: cleaner, and over the wind): a capsule filled with the temperature's own
 * color, ringed in white like the dot, drawn above the wind and rain layers.
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

  /** `fill`: the temperature's color on the ramp. */
  set(at: LatLon | null, text: string | null, over: BubbleOver, fill: string | null = null): void {
    if (!at || !text) {
      if (this.shown) this.marker.remove();
      this.shown = false;
      this.text = '';
      return;
    }
    this.marker.setLngLat([at.lon, at.lat]).setOffset([0, -LIFT[over]]);
    if (fill) {
      this.inner.style.setProperty('--bubble-fill', fill);
      this.inner.style.setProperty('--bubble-ink', inkOn(fill));
    }
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
