/**
 * Inline icons, 24×24. Layer icons come in two states per DESIGN.md:
 * active = filled (or heavier stroke for the line-only wind glyph),
 * inactive = outline.
 */

const svgOpen = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">`;

export const windIcon = `${svgOpen('icon icon-wind')}
  <path d="M3 8.5h10.5a3 3 0 1 0-3-3" />
  <path d="M3 12.5h15a3 3 0 1 1-3 3" />
  <path d="M3 16.5h6.5" />
</svg>`;

export const rainIcon = `${svgOpen('icon icon-rain')}
  <path d="M12 3.2c-2.6 3.6-5 6.6-5 9.6a5 5 0 0 0 10 0c0-3-2.4-6-5-9.6z" />
</svg>`;

export const thunderIcon = `${svgOpen('icon icon-thunder')}
  <path d="M13.2 2.5 5 13.6h6l-1.2 7.9 8.2-11.1h-6z" />
</svg>`;

export const cloudsIcon = `${svgOpen('icon icon-clouds')}
  <path d="M7.2 18.5h10.1a3.9 3.9 0 0 0 .5-7.77 5.6 5.6 0 0 0-10.8-1.2A4.5 4.5 0 0 0 7.2 18.5z" />
</svg>`;

export const closeIcon = `${svgOpen('icon icon-close')}
  <path d="M6 6l12 12M18 6 6 18" />
</svg>`;

function gearPath(teeth = 8, rOuter = 9.6, rInner = 7.2): string {
  const step = (Math.PI * 2) / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [r, da] of [
      [rInner, -step * 0.3],
      [rOuter, -step * 0.17],
      [rOuter, step * 0.17],
      [rInner, step * 0.3],
    ] as const) {
      pts.push(`${(12 + r * Math.cos(a + da)).toFixed(2)},${(12 + r * Math.sin(a + da)).toFixed(2)}`);
    }
  }
  return `M${pts.join('L')}Z`;
}

export const gearIcon = `${svgOpen('icon icon-gear')}
  <path d="${gearPath()}" />
  <circle cx="12" cy="12" r="3" />
</svg>`;

/* ---------- small UI marks ---------- */

export const warningIcon = `${svgOpen('icon icon-warning')}
  <path d="M12 3.5 1.8 20.5h20.4z" />
  <path class="cut" d="M12 9.5v5M12 17.2v.6" />
</svg>`;

export const gpsIcon = `${svgOpen('icon icon-gps')}
  <path d="M20.5 3.5 3.5 10.6l7.2 2.7 2.7 7.2z" />
</svg>`;

export const chevronIcon = `${svgOpen('icon icon-chevron')}
  <path d="m9 5 7 7-7 7" />
</svg>`;

export const playIcon = `${svgOpen('icon icon-play')}
  <path d="M7 4.5v15l12.5-7.5z" />
</svg>`;

export const pauseIcon = `${svgOpen('icon icon-pause')}
  <path d="M7.5 5v14M16.5 5v14" />
</svg>`;

/* ---------- condition glyphs (24×24, 1.5 stroke, no fill) ---------- */

const CLOUD_FULL = 'M6.6 18.5h10.6a4 4 0 0 0 .5-7.97 5.7 5.7 0 0 0-11-1.2A4.6 4.6 0 0 0 6.6 18.5z';
/** Raised cloud leaving room for rain, snow, or a bolt underneath. */
const CLOUD_HIGH = 'M6.8 14.5h10a3.6 3.6 0 0 0 .4-7.17 5.1 5.1 0 0 0-9.8-1.1A4.1 4.1 0 0 0 6.8 14.5z';
const CLOUD_SMALL = 'M9.6 19.5h8.2a3.2 3.2 0 0 0 .3-6.38 4.5 4.5 0 0 0-8.6-1 3.7 3.7 0 0 0 .1 7.38z';

const rays = (cx: number, cy: number, r1: number, r2: number, n = 8) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i * Math.PI * 2) / n;
    const f = (v: number) => v.toFixed(2);
    return `M${f(cx + r1 * Math.cos(a))} ${f(cy + r1 * Math.sin(a))}L${f(cx + r2 * Math.cos(a))} ${f(cy + r2 * Math.sin(a))}`;
  }).join('');

const glyph = (body: string) => `${svgOpen('icon glyph')}${body}</svg>`;

export const GLYPHS: Record<string, string> = {
  'clear-day': glyph(`<circle cx="12" cy="12" r="4" /><path d="${rays(12, 12, 6.5, 9)}" />`),
  'clear-night': glyph(`<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z" />`),
  'partly-day': glyph(`<circle cx="8.5" cy="8.5" r="3" /><path d="${rays(8.5, 8.5, 4.8, 6.6)}" /><path d="${CLOUD_SMALL}" />`),
  'partly-night': glyph(`<path d="M12.6 9.6A5 5 0 1 1 6.4 3.4a4 4 0 0 0 6.2 6.2z" /><path d="${CLOUD_SMALL}" />`),
  cloudy: glyph(`<path d="${CLOUD_FULL}" />`),
  fog: glyph(`<path d="M4 9h16M2.5 13h15M6.5 17h15" />`),
  rain: glyph(`<path d="${CLOUD_HIGH}" /><path d="M8.5 17.5 7.5 20M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />`),
  snow: glyph(`<path d="${CLOUD_HIGH}" /><path d="M8 18.5v.5M12 20v.5M16 18.5v.5M10 21v.5M14 21v.5" />`),
  thunder: glyph(`<path d="${CLOUD_HIGH}" /><path d="m12.8 15-2.3 3.4h3l-2.3 3.6" />`),
  Sunrise: glyph(`<path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0M12 4.5v5M9.5 7 12 4.5 14.5 7" />`),
  Sunset: glyph(`<path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0M12 4.5v5M9.5 7 12 9.5 14.5 7" />`),
};
