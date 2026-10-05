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
