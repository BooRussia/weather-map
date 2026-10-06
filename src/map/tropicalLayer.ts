import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, PaddingOptions, PointLike } from 'maplibre-gl';
import { category, modelLines, type ModelGroup, type Outlook, type Storm, type StormGIS } from '../data/tropical';

/**
 * Hurricanes on the map, bottom to top: NHC's seven-day outlook areas, the
 * forecast cone, coastal watches and warnings, the spaghetti (model tracks,
 * ensemble members faintest, the official forecast boldest), the past and
 * forecast track, forecast points colored by intensity, and each storm's
 * marker. Colors here are hazard data (DESIGN.md: the documented exception):
 * the Saffir–Simpson scale, NHC's watch/warning colors, a color per model group.
 */

/** Saffir–Simpson colors, as tropical-weather maps use them. */
export const CATEGORY_COLOR: Record<string, string> = {
  TD: '#5ebaff',
  TS: '#00faf4',
  '1': '#ffffcc',
  '2': '#ffe775',
  '3': '#ffc140',
  '4': '#ff8f20',
  '5': '#ff6060',
};

/** A color and weight per model group; members are faint so the spread reads as a cloud of tracks. */
export const MODEL_STYLE: Record<ModelGroup, { color: string; width: number; label: string; rank: number }> = {
  member: { color: 'rgba(255,255,255,0.28)', width: 1, label: 'GFS ensemble members', rank: 0 },
  statistical: { color: '#98989f', width: 1.2, label: 'Statistical and trajectory', rank: 1 },
  global: { color: '#64d2ff', width: 1.8, label: 'Global models', rank: 2 },
  ensembleMean: { color: '#bf5af2', width: 2, label: 'Ensemble means', rank: 3 },
  hurricane: { color: '#ff6b81', width: 1.8, label: 'Hurricane models', rank: 4 },
  consensus: { color: '#ffd60a', width: 2.4, label: 'Consensus', rank: 5 },
  official: { color: '#ffffff', width: 3.5, label: 'NHC official', rank: 6 },
};

/** NHC watch/warning colors (tcww codes). */
const WARNING_COLOR = ['match', ['get', 'tcww'], 'HWR', '#ff453a', 'HWA', '#ff6fb5', 'TWR', '#0a84ff', 'TWA', '#ffd60a', '#ffffff'];

const S = {
  outlook: 'trop-outlook',
  outlookPts: 'trop-outlook-pts',
  cone: 'trop-cone',
  warn: 'trop-warn',
  models: 'trop-models',
  ends: 'trop-model-ends',
  past: 'trop-past',
  track: 'trop-track',
  points: 'trop-points',
  storms: 'trop-storms',
} as const;

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const tag = (fc: FeatureCollection, storm: string): Feature[] => fc.features.map((f) => ({ ...f, properties: { ...f.properties, storm } }));
const ICON = 'trop-hurricane';

export class TropicalLayer {
  private installed = false;
  private visible = true;
  private hasText = false;
  private layerIds: string[] = [];

  constructor(
    private readonly map: MlMap,
    private readonly onPick: (stormId: string) => void,
  ) {}

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    const m = this.map;
    const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    // The fallback style has no glyphs: no text then.
    this.hasText = !!m.getStyle().glyphs;
    const font = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
    for (const id of Object.values(S)) m.addSource(id, { type: 'geojson', data: empty() });
    if (!m.hasImage(ICON)) m.addImage(ICON, hurricaneIcon(), { pixelRatio: 2 });

    const add = (layer: Parameters<MlMap['addLayer']>[0]) => {
      if (layer.type === 'symbol' && !this.hasText && (layer.layout as Record<string, unknown> | undefined)?.['text-field']) return;
      m.addLayer(layer, before);
      this.layerIds.push(layer.id);
    };
    const risk = ['match', ['get', 'risk7day'], 'High', '#ff453a', 'Medium', '#ff9f0a', '#ffd60a'];
    add({ id: `${S.outlook}-fill`, type: 'fill', source: S.outlook, paint: { 'fill-color': risk as never, 'fill-opacity': 0.14 } });
    add({ id: `${S.outlook}-line`, type: 'line', source: S.outlook, paint: { 'line-color': risk as never, 'line-width': 1.5, 'line-dasharray': [3, 2] } });
    add({
      id: S.outlookPts,
      type: 'symbol',
      source: S.outlookPts,
      layout: {
        'text-field': ['concat', '✕ ', ['get', 'prob7day']],
        'text-font': font,
        'text-size': 13,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': risk as never, 'text-halo-color': '#000', 'text-halo-width': 1.4 },
    });
    add({ id: `${S.cone}-fill`, type: 'fill', source: S.cone, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.1 } });
    add({ id: `${S.cone}-line`, type: 'line', source: S.cone, paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': 1.2 } });
    add({
      id: S.warn,
      type: 'line',
      source: S.warn,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': WARNING_COLOR as never, 'line-width': 5 },
    });
    const by = (key: 'color' | 'width') => ['match', ['get', 'group'], ...Object.entries(MODEL_STYLE).flatMap(([g, st]) => [g, st[key]]), key === 'color' ? '#fff' : 1];
    add({
      id: S.models,
      type: 'line',
      source: S.models,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['match', ['get', 'group'], ...Object.entries(MODEL_STYLE).flatMap(([g, st]) => [g, st.rank]), 0] as never,
      },
      paint: { 'line-color': by('color') as never, 'line-width': by('width') as never },
    });
    add({
      id: S.ends,
      type: 'symbol',
      source: S.ends,
      layout: { 'text-field': ['get', 'tech'], 'text-font': font, 'text-size': 10, 'text-offset': [0, -0.9], 'text-optional': true },
      paint: { 'text-color': by('color') as never, 'text-halo-color': '#000', 'text-halo-width': 1.2 },
    });
    add({ id: S.past, type: 'line', source: S.past, paint: { 'line-color': '#ffffff', 'line-opacity': 0.75, 'line-width': 2 } });
    add({ id: S.track, type: 'line', source: S.track, paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.6] } });
    const catColor = ['match', ['get', 'cat'], ...Object.entries(CATEGORY_COLOR).flat(), '#ffffff'];
    add({
      id: S.points,
      type: 'circle',
      source: S.points,
      paint: { 'circle-radius': 7, 'circle-color': catColor as never, 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 },
    });
    add({
      id: `${S.points}-label`,
      type: 'symbol',
      source: S.points,
      layout: {
        'text-field': ['get', 'dvlbl'],
        'text-font': font,
        'text-size': 10,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#000' },
    });
    add({
      id: `${S.points}-time`,
      type: 'symbol',
      source: S.points,
      layout: {
        'text-field': ['get', 'datelbl'],
        'text-font': font,
        'text-size': 11,
        'text-offset': [0.9, 0],
        'text-anchor': 'left',
        'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#000', 'text-halo-width': 1.3 },
    });
    // The marker: a disc in the storm's intensity color under a white hurricane symbol.
    add({
      id: `${S.storms}-dot`,
      type: 'circle',
      source: S.storms,
      paint: { 'circle-radius': 15, 'circle-color': catColor as never, 'circle-opacity': 0.9, 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 },
    });
    add({
      id: S.storms,
      type: 'symbol',
      source: S.storms,
      layout: {
        'icon-image': ICON,
        'icon-size': 1,
        'icon-allow-overlap': true,
        ...(this.hasText
          ? {
              'text-field': ['get', 'label'],
              'text-font': font,
              'text-size': 13,
              'text-offset': [0, 1.7],
              'text-anchor': 'top',
              'text-allow-overlap': true,
            }
          : {}),
      },
      paint: this.hasText ? { 'text-color': '#ffffff', 'text-halo-color': '#000', 'text-halo-width': 1.6 } : {},
    });

    for (const id of [S.storms, `${S.storms}-dot`, S.points, `${S.cone}-fill`]) {
      if (!m.getLayer(id)) continue;
      m.on('click', id, (e) => {
        const storm = e.features?.[0]?.properties?.storm as string | undefined;
        if (storm) this.onPick(storm);
      });
      m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
    }
    this.applyVisibility();
  }

  /** The storm under a screen point, if any (so a tap on a storm doesn't also move the map). */
  hit(point: PointLike): string | null {
    if (!this.installed || !this.visible) return null;
    const layers = [S.storms, `${S.storms}-dot`, S.points, `${S.cone}-fill`].filter((id) => this.map.getLayer(id));
    const f = this.map.queryRenderedFeatures(point, { layers })[0];
    return (f?.properties?.storm as string | undefined) ?? null;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (!this.installed) return;
    for (const id of this.layerIds) this.map.setLayoutProperty(id, 'visibility', this.visible ? 'visible' : 'none');
  }

  /** Draw every active storm, its official forecast, the chosen model groups, and the outlook. */
  set(storms: Storm[], gis: Map<string, StormGIS>, outlook: Outlook | null, groups: Set<ModelGroup>): void {
    if (!this.map.isStyleLoaded() && !this.installed) {
      this.map.once('load', () => this.set(storms, gis, outlook, groups));
      return;
    }
    this.install();
    const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
    const pick = (key: keyof StormGIS) => fc(storms.flatMap((s) => (gis.get(s.id) ? tag(gis.get(s.id)![key], s.id) : [])));
    const points = pick('points');
    for (const f of points.features) {
      const p = f.properties as Record<string, unknown>;
      p.cat = category(Number(p.maxwind) || 0);
    }
    const models = fc(storms.flatMap((s) => tag(modelLines(s, groups), s.id)));
    const ends = fc(
      storms.flatMap((s) =>
        s.models
          .filter((m) => groups.has(m.group) && m.group !== 'member' && m.pts.length >= 2)
          .map((m) => {
            const [, lat, lon] = m.pts[m.pts.length - 1];
            return { type: 'Feature', properties: { tech: m.tech, group: m.group, storm: s.id }, geometry: { type: 'Point', coordinates: [lon, lat] } } as Feature;
          }),
      ),
    );
    const markers = fc(
      storms.map((s) => ({
        type: 'Feature',
        properties: { storm: s.id, cat: category(s.intensityKt), label: s.name },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
    );
    const set = (id: string, data: FeatureCollection) => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    set(S.cone, pick('cone'));
    set(S.warn, pick('warnings'));
    set(S.past, pick('past'));
    set(S.track, pick('track'));
    set(S.points, points);
    set(S.models, models);
    set(S.ends, ends);
    set(S.storms, markers);
    set(S.outlook, (outlook?.areas as FeatureCollection | undefined) ?? empty());
    set(S.outlookPts, (outlook?.points as FeatureCollection | undefined) ?? empty());
  }

  /** Frame a storm: its cone, track, and the models shown. */
  fit(storm: Storm, gis: StormGIS | undefined, groups: Set<ModelGroup>, padding: PaddingOptions): void {
    const coords: number[][] = [[storm.lon, storm.lat]];
    const walk = (g: Geometry | null) => {
      if (!g) return;
      if (g.type === 'Point') coords.push(g.coordinates);
      else if (g.type === 'LineString' || g.type === 'MultiPoint') coords.push(...g.coordinates);
      else if (g.type === 'Polygon' || g.type === 'MultiLineString') g.coordinates.forEach((r) => coords.push(...r));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r) => coords.push(...r)));
    };
    gis?.cone.features.forEach((f) => walk(f.geometry));
    gis?.points.features.forEach((f) => walk(f.geometry));
    for (const m of storm.models) if (groups.has(m.group) && m.group !== 'member') for (const [, lat, lon] of m.pts) coords.push([lon, lat]);
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const bounds: LngLatBoundsLike = [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
    this.map.fitBounds(bounds, { padding, maxZoom: 7, duration: 900 });
  }
}

/** The storm marker's symbol: two curved arms around an eye, white with a dark outline (the disc beneath carries the color). */
function hurricaneIcon(): ImageData {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  const arm = (rot: number) => {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.bezierCurveTo(12, -12, 22, -4, 26, 10);
    ctx.bezierCurveTo(16, 2, 8, 0, 4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 2.5;
  arm(0);
  arm(Math.PI);
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
