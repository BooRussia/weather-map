import type { Feature, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MlMap, PointLike } from 'maplibre-gl';
import { siteCall, type RadarSite, type SiteProduct } from '../data/radarSites';

const SITES = 'radar-sites';
const RING = 'radar-site-ring';
const L = { dot: 'radar-site-dot', label: 'radar-site-label', ring: 'radar-site-ring-line' };
/** How far each product reaches from the radar, km. */
const RANGE_KM: Record<SiteProduct, number> = { N0B: 460, N0S: 300 };

/** A circle `km` around a point, as a polygon (flat-earth is fine at these sizes). */
export function ring(lon: number, lat: number, km: number, steps = 96): Feature<Polygon> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a), lat + (km / 110.57) * Math.cos(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

/**
 * The NEXRAD towers, tappable from zoom 5.5 (named from 6.5), shown while
 * the radar is on; the chosen one in the accent with a dashed ring at its
 * product's range, past which it sees nothing.
 */
export class RadarSitesLayer {
  private sites: RadarSite[] = [];
  private visible = false;
  private selected: { site: RadarSite; product: SiteProduct } | null = null;

  constructor(
    private readonly map: MlMap,
    private readonly accent: string,
  ) {}

  install(): void {
    const m = this.map;
    m.addSource(SITES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addSource(RING, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: L.ring,
      type: 'line',
      source: RING,
      layout: { visibility: 'none' },
      paint: { 'line-color': this.accent, 'line-width': 1.25, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
    });
    m.addLayer({
      id: L.dot,
      type: 'circle',
      source: SITES,
      minzoom: 5.5,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 6, 4],
        'circle-color': ['case', ['boolean', ['get', 'selected'], false], this.accent, '#ffffff'],
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1.5,
      },
    });
    m.addLayer({
      id: L.label,
      type: 'symbol',
      source: SITES,
      minzoom: 6.5,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'call'],
        'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.8, 0],
        'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.4 },
    });
    this.draw();
  }

  setSites(sites: RadarSite[]): void {
    this.sites = sites;
    this.draw();
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const id of [L.dot, L.label, L.ring]) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  select(site: RadarSite | null, product: SiteProduct = 'N0B'): void {
    this.selected = site ? { site, product } : null;
    this.draw();
  }

  private draw(): void {
    const sel = this.selected;
    (this.map.getSource(SITES) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.sites.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id: s.id, call: siteCall(s), selected: sel?.site.id === s.id },
      })),
    });
    (this.map.getSource(RING) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: sel ? [ring(sel.site.lon, sel.site.lat, RANGE_KM[sel.product])] : [],
    });
  }

  /** The tower under a tap, if any. */
  hit(point: { x: number; y: number }): RadarSite | null {
    if (!this.visible || !this.map.getLayer(L.dot)) return null;
    const box: [PointLike, PointLike] = [
      [point.x - 12, point.y - 12],
      [point.x + 12, point.y + 12],
    ];
    const f = this.map.queryRenderedFeatures(box, { layers: [L.dot] })[0];
    return f ? (this.sites.find((s) => s.id === f.properties?.id) ?? null) : null;
  }
}
