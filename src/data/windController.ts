import type { Map as MlMap } from 'maplibre-gl';
import { WeatherGrid } from '../field/grid';
import { FrameController } from '../maps/fieldController';
import { GeoMetWindSource } from '../maps/geometSource';

/**
 * Wind for the particles from GeoMet's global model (15 km): the hours
 * around the timeline's moment, blended to the quarter hour (the timeline's
 * frame step) as u/v components, so the flow turns smoothly as it plays.
 */
export class WindController extends FrameController<WeatherGrid, 'wind'> {
  private blended: { a: WeatherGrid; b: WeatherGrid | null; f: number; grid: WeatherGrid } | null = null;

  constructor(map: MlMap, onWind: (grid: WeatherGrid | null) => void, onError: (err: unknown) => void) {
    super(
      map,
      new GeoMetWindSource(),
      (a, b, f) => onWind(a ? this.blend(a, b, f) : null),
      () => {},
      onError,
    );
  }

  /** Fetch and follow the wind (on), or stop (off). */
  setActive(on: boolean): void {
    this.select(on ? 'wind' : null);
  }

  private blend(a: WeatherGrid, b: WeatherGrid | null, f: number): WeatherGrid {
    const q = Math.round(f * 4) / 4;
    // Frames from different areas can't be mixed point by point; the newer area wins.
    const same = b && b.spec.cols === a.spec.cols && b.spec.rows === a.spec.rows && b.spec.west === a.spec.west && b.spec.north === a.spec.north;
    if (!b || !same || q === 0) return a;
    if (q === 1) return b;
    const c = this.blended;
    if (c && c.a === a && c.b === b && c.f === q) return c.grid;
    const grid = WeatherGrid.blend(a, b, q);
    this.blended = { a, b, f: q, grid };
    return grid;
  }
}
