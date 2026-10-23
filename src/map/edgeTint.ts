import type { Map as MlMap } from 'maplibre-gl';

/** Every this many pixels along the top row is averaged (plenty for one color). */
const STEP = 6;

/**
 * A phone browser (Safari, Arc, any other: not the home-screen app) won't let the page draw under the
 * status bar: the browser paints that strip itself, and it was black (owner, 2026-10-23). Browsers take
 * that color from the page in different ways, iOS 26 Safari from the page's background, others from
 * the theme-color tag, so both take the average color along the map's top edge, sampled once the map
 * settles after a move, and the strip blends into the map instead of sitting over it as a black bar.
 */
export function edgeTint(map: MlMap): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  // The home-screen app draws the map up there itself.
  if (nav.standalone || matchMedia('(display-mode: standalone)').matches) return;
  let want = false;
  let timer = 0;
  const ask = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!document.body.classList.contains('phone')) return;
      want = true;
      map.triggerRepaint();
    }, ms);
  };
  map.on('moveend', () => ask(700));
  map.once('load', () => ask(2500));
  new MutationObserver(() => ask(1500)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-basemap'] });

  // Read the frame just drawn, in the same task (the drawing buffer is still there).
  map.on('render', () => {
    if (!want) return;
    want = false;
    const canvas = map.getCanvas();
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (!w || !h) return;
    const row = new Uint8Array(w * 4);
    gl.readPixels(0, h - 1, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let x = 0; x < w; x += STEP) {
      r += row[x * 4];
      g += row[x * 4 + 1];
      b += row[x * 4 + 2];
      n++;
    }
    if (!n) return;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    const color = `#${hex(r)}${hex(g)}${hex(b)}`;
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = color;
  });
}
