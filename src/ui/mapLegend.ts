import { buildFieldRamp, rampDomain } from '../map/fieldLayer';
import { formatValue, plainLabel, type Units, type WeatherMap } from '../maps/catalog';
import { h } from './dom';

/** Ramp colors as they look over the dark map (alpha applied), for the legend bar. */
function barGradient(m: WeatherMap): string {
  const lut = buildFieldRamp(m.ramp);
  const ground = [26, 32, 42];
  const stops: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const k = Math.round((i / 16) * 255) * 4;
    const a = Math.max(0.25, (lut[k + 3] / 255) * m.opacity);
    const c = [0, 1, 2].map((j) => Math.round(ground[j] * (1 - a) + lut[k + j] * a));
    stops.push(`rgb(${c.join(', ')}) ${((i / 16) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Where a base-unit value sits along the bar, 0..1. */
function position(m: WeatherMap, base: number): number {
  const [lo, hi] = rampDomain(m.ramp);
  const v = m.ramp.curve === 'sqrt' ? Math.sign(base) * Math.sqrt(Math.abs(base)) : base;
  return (v - lo) / (hi - lo);
}

/**
 * The legend for the colored map, under the timeline: its name and the value
 * at the selected point, then the color bar with ticks in the user's units.
 */
export function renderMapLegend(el: HTMLElement, m: WeatherMap | null, units: Units, here: number | null): void {
  el.hidden = !m;
  if (!m) {
    el.replaceChildren();
    return;
  }
  const d = m.unit(units);
  const ticks = d.ticks
    .map((t) => ({ t, x: position(m, d.to(t)) }))
    .filter((k) => k.x >= -0.001 && k.x <= 1.001)
    .sort((a, b) => a.x - b.x);
  const fmt = (t: number) => (Number.isInteger(t) ? String(t) : String(t).replace(/^0\./, '.'));
  el.setAttribute('aria-label', `${plainLabel(m)} scale in ${d.label}${here != null ? `; ${formatValue(m, here, units)} at the selected point` : ''}`);
  el.replaceChildren(
    h(
      'span',
      { class: 'ml-name' },
      plainLabel(m),
      here != null ? h('span', { class: 'ml-here' }, formatValue(m, here, units)) : null,
    ),
    h(
      'span',
      { class: 'ml-scale' },
      h('span', { class: 'ml-unit' }, d.label),
      h(
        'span',
        { class: 'ml-track' },
        h('i', { class: 'ml-bar', style: `background:${barGradient(m)}` }),
        h(
          'span',
          { class: 'ml-ticks' },
          ...ticks.map((k) => h('span', { style: `left:${(Math.max(0, Math.min(1, k.x)) * 100).toFixed(1)}%` }, fmt(k.t))),
        ),
      ),
    ),
  );
}
