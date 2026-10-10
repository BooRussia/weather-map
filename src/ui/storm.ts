import { category, categoryLabel, floater, nhcGraphicsPage, stormGraphics, stormTitle, type ModelGroup, type SatBand, type Storm, type StormGIS } from '../data/tropical';
import { CATEGORY_COLOR, MODEL_STYLE } from '../map/tropicalLayer';
import type { AppState } from '../state';
import { compass16 } from '../util/units';
import { h } from './dom';
import { segmented } from './layersMenu';

/** Groups listed top to bottom in the panel. */
const GROUP_ORDER: ModelGroup[] = ['official', 'consensus', 'hurricane', 'global', 'ensembleMean', 'statistical', 'member'];
/** Saffir–Simpson thresholds (kt) drawn on the intensity chart. */
const BANDS: [number, string][] = [
  [34, 'TS'],
  [64, '1'],
  [83, '2'],
  [96, '3'],
  [113, '4'],
  [137, '5'],
];

const windText = (kt: number, s: AppState) => (s.windUnit === 'kmh' ? `${Math.round(kt * 1.852)} km/h` : `${Math.round(kt * 1.15078)} mph`);
const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  return min < 60 ? `${Math.max(1, min)} min ago` : `${Math.round(min / 60)} h ago`;
};
const latLon = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/** A short name for the pill: "Nine · Depression", "Milton · Cat 3". */
export function stormShort(s: Storm): string {
  const c = category(s.intensityKt);
  return `${s.name} · ${c === 'TD' ? 'Depression' : c === 'TS' ? 'Tropical storm' : `Cat ${c}`}`;
}

export interface StormPanelHooks {
  state(): AppState;
  groups(): Set<ModelGroup>;
  setGroup(group: ModelGroup, on: boolean): void;
  select(id: string): void;
  showOnMap(id: string): void;
}

/** The storm sheet's content: now, NHC's forecast, intensity guidance, model switches, sources. */
export function stormPanel(storms: Storm[], gis: Map<string, StormGIS>, generated: string | null, selected: string, hooks: StormPanelHooks): HTMLElement {
  const s = hooks.state();
  const storm = storms.find((x) => x.id === selected) ?? storms[0];
  const g = gis.get(storm.id);
  const c = category(storm.intensityKt);

  const picker =
    storms.length > 1
      ? h(
          'div',
          { class: 'storm-picker' },
          segmented(
            'Storm',
            storms.map((x) => ({ value: x.id, label: x.name })),
            storm.id,
            (id) => hooks.select(id),
          ),
        )
      : null;

  const stat = (label: string, value: string) => h('div', { class: 'storm-stat' }, h('span', { class: 'storm-stat-label' }, label), h('span', { class: 'storm-stat-value' }, value));
  const moving =
    storm.movementDir != null && storm.movementKt != null
      ? storm.movementKt < 2
        ? 'Stationary'
        : `${compass16(storm.movementDir)} at ${windText(storm.movementKt, s)}`
      : '—';
  const now = h(
    'div',
    { class: 'storm-now' },
    h(
      'p',
      { class: 'storm-cat' },
      h('span', { class: 'storm-cat-dot', style: `background:${CATEGORY_COLOR[c]}` }),
      categoryLabel(c),
    ),
    h(
      'div',
      { class: 'storm-stats' },
      stat('Max wind', windText(storm.intensityKt, s)),
      stat('Pressure', storm.pressureMb ? `${storm.pressureMb} mb` : '—'),
      stat('Moving', moving),
      stat('Center', latLon(storm.lat, storm.lon)),
    ),
  );

  const advisory = h(
    'p',
    { class: 'pop-note storm-adv' },
    storm.advisory ? `NHC advisory ${Number(storm.advisory) || storm.advisory}` : 'NHC',
    storm.updated && Number.isFinite(Date.parse(storm.updated)) ? ` · ${new Date(storm.updated).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '',
    storm.advisoryUrl ? ' · ' : '',
    storm.advisoryUrl ? h('a', { href: storm.advisoryUrl, target: '_blank', rel: 'noopener' }, 'Advisory') : null,
    storm.discussionUrl ? ' · ' : '',
    storm.discussionUrl ? h('a', { href: storm.discussionUrl, target: '_blank', rel: 'noopener' }, 'Discussion') : null,
    ' · ',
    h('a', { href: nhcGraphicsPage(storm.bin), target: '_blank', rel: 'noopener' }, 'Graphics'),
  );

  // NHC's official forecast points.
  const pts = g?.points.features.map((f) => f.properties!).filter(Boolean) ?? [];
  const forecast = pts.length
    ? h(
        'div',
        { class: 'group storm-fcst' },
        ...pts.map((p) => {
          const pc = category(p.maxwind);
          return h(
            'div',
            { class: 'row storm-fcst-row' },
            h('span', { class: 'storm-fcst-time' }, p.tau === 0 ? 'Now' : p.datelbl),
            h('span', { class: 'storm-cat-dot', style: `background:${CATEGORY_COLOR[pc]}` }),
            h('span', { class: 'row-label' }, p.tcdvlp || categoryLabel(pc)),
            h('span', { class: 'storm-fcst-wind' }, windText(p.maxwind, s)),
          );
        }),
      )
    : h('p', { class: 'pop-note' }, 'NHC’s forecast points aren’t available right now.');

  const chart = intensityChart(storm, hooks.groups(), s);

  const toggles = h(
    'div',
    { class: 'group' },
    ...GROUP_ORDER.filter((grp) => storm.models.some((m) => m.group === grp)).map((grp) => {
      const n = storm.models.filter((m) => m.group === grp).length;
      const st = MODEL_STYLE[grp];
      const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': st.label });
      // On the map only while Spaghetti models is on (Layers → Hurricanes); turning one on turns that on.
      input.checked = hooks.state().tropics.models && hooks.groups().has(grp);
      input.addEventListener('change', () => hooks.setGroup(grp, input.checked));
      return h(
        'label',
        { class: 'row' },
        h('span', { class: 'model-swatch', style: `background:${st.color};height:${Math.max(2, st.width)}px` }),
        h(
          'span',
          { class: 'row-label' },
          st.label,
          h('span', { class: 'row-sub' }, `${n} ${n === 1 ? 'track' : 'tracks'}: ${storm.models.filter((m) => m.group === grp).slice(0, 6).map((m) => m.tech).join(', ')}${n > 6 ? '…' : ''}`),
        ),
        input,
      );
    }),
  );
  const latestRun = storm.models.reduce((t, m) => Math.max(t, m.init), 0);

  const show = h('button', { type: 'button', class: 'trip-go storm-show' }, 'Show on map');
  show.addEventListener('click', () => hooks.showOnMap(storm.id));

  return h(
    'div',
    {},
    picker,
    now,
    advisory,
    satellite(storm),
    h('p', { class: 'group-label' }, 'NHC forecast'),
    forecast,
    storm.models.length ? h('p', { class: 'group-label' }, 'Intensity guidance') : null,
    chart,
    h('p', { class: 'group-label' }, 'Spaghetti models'),
    storm.models.length
      ? toggles
      : h('p', { class: 'pop-note' }, storm.modelsError ?? 'No model guidance yet for this storm.'),
    storm.models.length
      ? h(
          'p',
          { class: 'pop-note' },
          `Latest run ${new Date(latestRun).toISOString().slice(11, 13)}Z (${ago(latestRun)}). Checked every 30 minutes${generated ? `, last ${ago(Date.parse(generated))}` : ''}.`,
        )
      : null,
    graphics(storm),
    show,
    h(
      'p',
      { class: 'pop-note' },
      'Model tracks are computer guidance from NHC’s ATCF, not forecasts; individual models can be far off. The white cone and track are NHC’s official forecast. For decisions, follow NHC and local officials.',
    ),
  );
}

/**
 * NOAA STAR's storm-centered GOES imagery: the latest frame, GeoColor or
 * infrared, and the animated loop on request (it's several megabytes). The
 * section hides itself if the storm has no floater yet.
 */
function satellite(storm: Storm): HTMLElement {
  let band: SatBand = 'GEOCOLOR';
  let looping = false;
  const img = h('img', { class: 'storm-sat-img', alt: '', decoding: 'async', width: 500, height: 500 });
  const play = h('button', { type: 'button', class: 'storm-sat-play' });
  const section = h(
    'div',
    { class: 'storm-sat-section' },
    h('p', { class: 'group-label' }, 'Satellite'),
    h(
      'div',
      { class: 'storm-sat-bands' },
      segmented<SatBand>(
        'Satellite band',
        [
          { value: 'GEOCOLOR', label: 'Color' },
          { value: '13', label: 'Infrared' },
        ],
        band,
        (v) => {
          band = v;
          load();
        },
      ),
    ),
    h('div', { class: 'storm-sat' }, img, play),
    h(
      'p',
      { class: 'pop-note' },
      'GOES imagery centered on the storm, from NOAA STAR. Infrared works at night; colored areas are the coldest, tallest clouds. ',
      h('a', { href: floater(storm.id, band).page, target: '_blank', rel: 'noopener' }, 'More bands'),
    ),
  );
  const load = () => {
    const f = floater(storm.id, band);
    img.src = looping ? f.loop : f.still;
    img.alt = `${band === 'GEOCOLOR' ? 'Color' : 'Infrared'} satellite ${looping ? 'loop' : 'image'} of ${storm.name}`;
    play.textContent = looping ? 'Loading loop…' : 'Play loop · about 8 MB';
    play.disabled = looping;
  };
  img.addEventListener('load', () => {
    if (!looping) return;
    play.textContent = 'Latest image';
    play.disabled = false;
  });
  img.addEventListener('error', () => {
    if (looping) {
      // No loop: keep the still.
      looping = false;
      load();
      play.hidden = true;
    } else section.hidden = true;
  });
  play.addEventListener('click', () => {
    looping = !looping;
    load();
  });
  load();
  return section;
}

/** NHC's standard graphics as a strip of thumbnails; each opens full size. Missing ones drop out. */
function graphics(storm: Storm): HTMLElement | null {
  const items = stormGraphics(storm.id);
  if (!items.length) return null;
  const strip = h('div', { class: 'storm-gfx' });
  const section = h('div', {}, h('p', { class: 'group-label' }, 'NHC graphics'), strip);
  for (const g of items) {
    const img = h('img', { src: g.thumb, alt: '', loading: 'lazy', decoding: 'async' });
    const a = h('a', { class: 'storm-gfx-item', href: g.full, target: '_blank', rel: 'noopener' }, img, h('span', {}, g.label));
    img.addEventListener('error', () => {
      a.remove();
      if (!strip.childElementCount) section.hidden = true;
    });
    strip.append(a);
  }
  return section;
}

/** Wind (kt) over the forecast for the model groups shown, with the Saffir–Simpson thresholds. */
function intensityChart(storm: Storm, groups: Set<ModelGroup>, s: AppState): SVGSVGElement | null {
  const tracks = storm.models.filter((m) => groups.has(m.group) && m.group !== 'member' && m.group !== 'statistical' && m.pts.some((p) => p[3] > 0));
  if (!tracks.length) return null;
  const W = 340;
  const H = 170;
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const maxTau = Math.min(168, Math.max(48, ...tracks.flatMap((m) => m.pts.map((p) => p[0]))));
  const maxKt = Math.max(70, ...tracks.flatMap((m) => m.pts.map((p) => p[3]))) + 10;
  const x = (tau: number) => pad.l + (tau / maxTau) * (W - pad.l - pad.r);
  const y = (kt: number) => H - pad.b - (kt / maxKt) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'storm-chart', role: 'img', 'aria-label': `Forecast intensity from ${tracks.length} models` });
  for (const [kt, label] of BANDS) {
    if (kt > maxKt) continue;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(kt), y2: y(kt), class: 'chart-band' }));
    const t = el('text', { x: pad.l - 4, y: y(kt) + 3, class: 'chart-label', 'text-anchor': 'end' });
    t.textContent = label;
    svg.append(t);
  }
  for (let d = 24; d <= maxTau; d += 24) {
    const t = el('text', { x: x(d), y: H - 4, class: 'chart-label', 'text-anchor': 'middle' });
    t.textContent = `${d / 24}d`;
    svg.append(t);
  }
  // Official last, on top.
  for (const m of [...tracks].sort((a, b) => MODEL_STYLE[a.group].rank - MODEL_STYLE[b.group].rank)) {
    const pts = m.pts.filter((p) => p[0] <= maxTau && p[3] > 0);
    if (pts.length < 2) continue;
    const st = MODEL_STYLE[m.group];
    svg.append(
      el('polyline', {
        points: pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[3]).toFixed(1)}`).join(' '),
        fill: 'none',
        stroke: st.color,
        'stroke-width': m.group === 'official' ? 3 : 1.4,
        'stroke-linejoin': 'round',
        'stroke-opacity': m.group === 'official' ? 1 : 0.85,
      }),
    );
  }
  const unit = el('text', { x: pad.l, y: pad.t + 8, class: 'chart-label' });
  unit.textContent = s.windUnit === 'kmh' ? 'kt (×1.85 = km/h)' : 'kt (×1.15 = mph)';
  svg.append(unit);
  return svg;
}

export { stormTitle };
