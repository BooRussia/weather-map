import type { FeatureCollection, MultiLineString } from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { US_COUNTIES_TOPO_URL, US_STATES_TOPO_URL } from '../config';
import { fetchJson } from '../util/http';

const STATES = 'us-state-lines';
const COUNTIES = 'us-county-lines';
/** County lines fade in from here (about one state on screen); zoomed out further they'd be a mesh. */
export const COUNTY_MIN_ZOOM = 5.5;

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: Record<string, { geometries: { type: string; arcs?: unknown }[] }>;
}

/** Every arc index a geometry's rings use (a negative index is that arc reversed: ~i). */
function arcsOf(nested: unknown, out: number[]): number[] {
  if (typeof nested === 'number') out.push(nested < 0 ? ~nested : nested);
  else if (Array.isArray(nested)) for (const n of nested) arcsOf(n, out);
  return out;
}

/**
 * Every border of a TopoJSON object's shapes, each line once (topojson's mesh): the ones two shapes
 * share, and with `outer` the coastlines and national borders too, so every state is outlined all the
 * way around (owner, 2026-10-23: Florida, Louisiana, and Texas had open coasts).
 */
export function meshLines(topo: Topology, object: string, outer = true): MultiLineString {
  const users = new Map<number, Set<number>>();
  topo.objects[object].geometries.forEach((g, gi) => {
    for (const a of arcsOf(g.arcs, [])) {
      let set = users.get(a);
      if (!set) users.set(a, (set = new Set()));
      set.add(gi);
    }
  });
  const [sx, sy] = topo.transform?.scale ?? [1, 1];
  const [tx, ty] = topo.transform?.translate ?? [0, 0];
  const lines: [number, number][][] = [];
  for (const [a, set] of users) {
    if (set.size < 2 && !outer) continue;
    // Quantized arcs are delta-encoded: each point is the sum of the ones before.
    let x = 0;
    let y = 0;
    lines.push(
      topo.arcs[a].map(([dx, dy]) => {
        if (topo.transform) {
          x += dx;
          y += dy;
          return [x * sx + tx, y * sy + ty];
        }
        return [dx, dy];
      }),
    );
  }
  return { type: 'MultiLineString', coordinates: lines };
}

const collection = (g: MultiLineString | null): FeatureCollection => ({
  type: 'FeatureCollection',
  features: g ? [{ type: 'Feature', geometry: g, properties: {} }] : [],
});

/**
 * State and county borders over the map (each its own switch): states at every zoom, counties once
 * zoomed in to about a state. Above the radar and traffic, under the labels; dark on the light
 * Standard map, light on Satellite and Dark. The shapes load the first time each is switched on.
 */
export class Boundaries {
  /** Shapes loaded, or loading now. */
  private loading = new Set<string>();

  constructor(private readonly map: MlMap) {}

  set(states: boolean, counties: boolean, light: boolean): void {
    this.show(COUNTIES, counties, light);
    this.show(STATES, states, light);
  }

  private show(id: string, on: boolean, light: boolean): void {
    const m = this.map;
    if (!m.getLayer(id)) {
      if (!on) return;
      this.add(id);
    }
    m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    if (on) void this.load(id);
    const ink = light ? '40, 40, 48' : '255, 255, 255';
    m.setPaintProperty(id, 'line-color', `rgba(${ink}, ${id === STATES ? 0.75 : light ? 0.45 : 0.4})`);
  }

  private add(id: string): void {
    const m = this.map;
    const states = id === STATES;
    m.addSource(id, { type: 'geojson', data: collection(null) });
    // Under the labels; states over counties (and over traffic, which goes in under the lines).
    const before = states ? m.getStyle().layers.find((l) => l.type === 'symbol')?.id : m.getLayer(STATES) ? STATES : undefined;
    m.addLayer(
      {
        id,
        type: 'line',
        source: id,
        ...(states ? {} : { minzoom: COUNTY_MIN_ZOOM }),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: states
          ? { 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.3, 10, 2.2] }
          : {
              'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 1],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], COUNTY_MIN_ZOOM, 0, COUNTY_MIN_ZOOM + 1, 1],
            },
      },
      before ?? m.getStyle().layers.find((l) => l.type === 'symbol')?.id,
    );
  }

  private async load(id: string): Promise<void> {
    if (this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const states = id === STATES;
      const topo = await fetchJson<Topology>(states ? US_STATES_TOPO_URL : US_COUNTIES_TOPO_URL, { timeoutMs: 20_000 });
      (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(collection(meshLines(topo, states ? 'states' : 'counties')));
    } catch {
      // Borders are a nicety: try again the next time the switch goes on.
      this.loading.delete(id);
    }
  }
}
