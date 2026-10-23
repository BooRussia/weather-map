import type { Map as MlMap } from 'maplibre-gl';

/** Every this many pixels along the top row is averaged (plenty for one color). */
const STEP = 6;

/**
 * Safari on an iPhone (a tab, not the home-screen app) won't draw the page under the status bar in
 * portrait: it paints that strip itself, in the page's background color, which was black (owner,
 * 2026-10-23). So the background takes the average color along the map's top edge, sampled once the
 * map settles after a move, and Safari's strip blends into the map instead of sitting over it as a bar.
 * (iOS 26 Safari ignores theme-color and tints from the page's background.)
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
    const color = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
  });
}
