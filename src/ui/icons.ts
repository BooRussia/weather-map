/**
 * Inline icons, 24×24. UI marks are single-color (currentColor). Weather
 * glyphs are multicolor in Liquid (SF Symbols style: yellow sun, white cloud,
 * cyan drops) via CSS variables, and white outlines in Classic. See styles.css.
 */

const open = (cls: string) =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">`;

/* ---------- UI marks ---------- */

export const searchIcon = `${open('i-search')}<circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>`;

/** Location arrow (Apple Maps style); filled while the map follows you. */
export const locateIcon = `${open('i-locate')}<path d="M20.6 3.4 3.6 10.4c-.7.3-.6 1.2.1 1.4l6.4 1.9 1.9 6.4c.2.7 1.2.8 1.4.1z" /></svg>`;

export const layersIcon = `${open('i-layers')}<path d="M12 3.5 2.8 8.3 12 13.1l9.2-4.8z" /><path d="m2.8 12.2 9.2 4.8 9.2-4.8" /><path d="m2.8 16.1 9.2 4.8 9.2-4.8" /></svg>`;

export const routeIcon = `${open('i-route')}<circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="6" r="2.3" /><path d="M8.3 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.7" /></svg>`;

export const closeIcon = `${open('i-close')}<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>`;

export const chevronIcon = `${open('i-chevron')}<path d="m9 5 7 7-7 7" /></svg>`;

export const playIcon = `${open('i-play')}<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.4 0-1.8L9.6 4.3C8.9 3.9 8 4.4 8 5.2z" /></svg>`;

export const pauseIcon = `${open('i-pause')}<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" /><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" /></svg>`;

export const warningIcon = `${open('i-warning')}<path class="w-body" d="M10.3 4.1 2.6 17.6c-.8 1.3.2 2.9 1.7 2.9h15.4c1.5 0 2.5-1.6 1.7-2.9L13.7 4.1c-.8-1.3-2.6-1.3-3.4 0z" /><path class="w-mark" d="M12 9v4.6M12 16.8v.2" /></svg>`;

export const gearIcon = `${open('i-gear')}<circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>`;

/* Card header and layer-row marks (small, single-color). */
export const clockIcon = `${open('i-clock')}<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>`;
export const calendarIcon = `${open('i-calendar')}<rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>`;
export const umbrellaIcon = `${open('i-umbrella')}<path d="M3 12a9 9 0 0 1 18 0z" /><path d="M12 12v6.5a2 2 0 0 1-4 0" /></svg>`;
export const thermoIcon = `${open('i-thermo')}<path d="M10 14.2V5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z" /></svg>`;
export const sunMark = `${open('i-sun')}<circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>`;
export const windIcon = `${open('i-wind')}<path d="M3 8.5h10.5a3 3 0 1 0-3-3" /><path d="M3 12.5h15a3 3 0 1 1-3 3" /><path d="M3 16.5h6.5" /></svg>`;
export const dropIcon = `${open('i-drop')}<path d="M12 3.2c-2.6 3.6-5.6 6.6-5.6 10a5.6 5.6 0 0 0 11.2 0c0-3.4-3-6.4-5.6-10z" /></svg>`;
export const sunsetIcon = `${open('i-sunset')}<path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0M12 4v5M9.5 6.5 12 9l2.5-2.5" /></svg>`;
export const eyeIcon = `${open('i-eye')}<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>`;
export const gaugeIcon = `${open('i-gauge')}<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0" /><path d="m12 13 3.5-4" /></svg>`;
export const rainMark = `${open('i-rainmark')}<path d="M6.8 13.5h10a3.6 3.6 0 0 0 .4-7.17 5.1 5.1 0 0 0-9.8-1.1A4.1 4.1 0 0 0 6.8 13.5z" /><path d="M8.5 17 7.5 20M12.5 17l-1 3M16.5 17l-1 3" /></svg>`;
export const boltMark = `${open('i-bolt')}<path d="M13.2 2.5 5 13.6h6l-1.2 7.9 8.2-11.1h-6z" /></svg>`;
export const cloudMark = `${open('i-cloud')}<path d="M6.6 18.5h10.6a4 4 0 0 0 .5-7.97 5.7 5.7 0 0 0-11-1.2A4.6 4.6 0 0 0 6.6 18.5z" /></svg>`;
/** The hurricane symbol: an eye with two curled arms. */
export const hurricaneMark = `${open('i-hurricane')}<circle cx="12" cy="12" r="3" /><path d="M12 9c-.9-3.6 1.6-6 6.2-6.4" /><path d="M12 15c.9 3.6-1.6 6-6.2 6.4" /></svg>`;
export const alertMark =`${open('i-alertmark')}<path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.3" /></svg>`;

/* ---------- weather glyphs (multicolor in Liquid) ---------- */

const CLOUD = 'M6.6 19h10.8a4.1 4.1 0 0 0 .5-8.17 5.8 5.8 0 0 0-11.2-1.2A4.7 4.7 0 0 0 6.6 19z';
const CLOUD_HIGH = 'M6.8 14.6h10.2a3.7 3.7 0 0 0 .4-7.37 5.2 5.2 0 0 0-10-1.1 4.2 4.2 0 0 0-.6 8.47z';
const CLOUD_LOW = 'M9.4 20h8.6a3.4 3.4 0 0 0 .4-6.77 4.7 4.7 0 0 0-9-1 3.9 3.9 0 0 0 0 7.77z';

const rays = (cx: number, cy: number, r1: number, r2: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const f = (v: number) => v.toFixed(2);
    return `M${f(cx + r1 * Math.cos(a))} ${f(cy + r1 * Math.sin(a))}L${f(cx + r2 * Math.cos(a))} ${f(cy + r2 * Math.sin(a))}`;
  }).join('');

const glyph = (body: string) => `${open('glyph')}${body}</svg>`;
const sun = (cx: number, cy: number, r: number) =>
  `<circle class="g-sun" cx="${cx}" cy="${cy}" r="${r}" /><path class="g-ray" d="${rays(cx, cy, r + 2, r + 4.2)}" />`;

export const GLYPHS: Record<string, string> = {
  'clear-day': glyph(sun(12, 12, 4.6)),
  'clear-night': glyph(`<path class="g-moon" d="M19.6 14.8A8.1 8.1 0 1 1 9.2 4.4a6.5 6.5 0 0 0 10.4 10.4z" />`),
  'partly-day': glyph(`${sun(8.6, 8.6, 3.2)}<path class="g-cloud" d="${CLOUD_LOW}" />`),
  'partly-night': glyph(
    `<path class="g-moon" d="M12.8 9.8A5.1 5.1 0 1 1 6.2 3.2a4.1 4.1 0 0 0 6.6 6.6z" /><path class="g-cloud" d="${CLOUD_LOW}" />`,
  ),
  cloudy: glyph(`<path class="g-cloud" d="${CLOUD}" />`),
  fog: glyph(`<path class="g-cloud" d="${CLOUD_HIGH}" /><path class="g-fog" d="M4 17.5h16M6.5 21h11" />`),
  rain: glyph(`<path class="g-cloud" d="${CLOUD_HIGH}" /><path class="g-drop" d="M8.4 17.4 7.4 20.4M12.4 17.4l-1 3M16.4 17.4l-1 3" />`),
  snow: glyph(
    `<path class="g-cloud" d="${CLOUD_HIGH}" /><g class="g-snow"><circle cx="8" cy="18.2" r="1.2" /><circle cx="12" cy="20.4" r="1.2" /><circle cx="16" cy="18.2" r="1.2" /></g>`,
  ),
  thunder: glyph(
    `<path class="g-cloud" d="${CLOUD_HIGH}" /><path class="g-bolt" d="m12.9 13.6-3.2 4.6h2.7l-1.6 4.3 4.5-5.7h-2.8l1.6-3.2z" />`,
  ),
  Sunrise: glyph(
    `<path class="g-sun" d="M7 18a5 5 0 0 1 10 0z" /><path class="g-fog" d="M3 18h18" /><path class="g-arrow" d="M12 3.5v5M9.6 6 12 3.5 14.4 6" />`,
  ),
  Sunset: glyph(
    `<path class="g-sun" d="M7 18a5 5 0 0 1 10 0z" /><path class="g-fog" d="M3 18h18" /><path class="g-arrow" d="M12 3.5v5M9.6 6 12 8.5 14.4 6" />`,
  ),
};
