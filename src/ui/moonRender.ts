/**
 * The moon as Apple draws it (owner, 2026-10-23): a lit sphere wrapped in NASA's map of the near side
 * (public/moon.jpg: the Scientific Visualization Studio's CGI Moon Kit, from LRO's camera, public
 * domain; cropped to the half that faces us). The sun comes from the phase's angle, so the terminator
 * falls where it really does; the night side fades into what's behind it. Painted into a canvas; the
 * map loads the first time a moon is shown.
 */

export const MOON_TEXTURE_URL = `${import.meta.env.BASE_URL}moon.jpg`;

let texture: Promise<ImageData> | null = null;
const painted = new Map<string, ImageData>();

function loadTexture(): Promise<ImageData> {
  texture ??= new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      resolve(g.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => {
      texture = null;
      reject(new Error('moon texture'));
    };
    img.src = MOON_TEXTURE_URL;
  });
  return texture;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Paint the moon at `phase` (0 new, 0.25 first quarter, 0.5 full) filling `canvas`, north up as seen
 * from the northern hemisphere: waxing, the lit side is on the right.
 */
export function paintMoon(canvas: HTMLCanvasElement, phase: number): void {
  const S = canvas.width;
  const key = `${S}:${phase.toFixed(3)}`;
  const g = canvas.getContext('2d');
  if (!g) return;
  const done = painted.get(key);
  if (done) {
    g.putImageData(done, 0, 0);
    return;
  }
  void loadTexture()
    .then((tex) => {
      const out = g.createImageData(S, S);
      const r = S / 2 - 1;
      const th = phase * 2 * Math.PI;
      const lx = Math.sin(th);
      const lz = -Math.cos(th);
      const tw = tex.width;
      const thh = tex.height;
      const src = tex.data;
      const px = out.data;
      for (let y = 0; y < S; y++) {
        const ny = (S / 2 - (y + 0.5)) / r;
        for (let x = 0; x < S; x++) {
          const nx = (x + 0.5 - S / 2) / r;
          const d2 = nx * nx + ny * ny;
          // Antialiased rim.
          const edge = Math.min(1, Math.max(0, (1 - Math.sqrt(d2)) * r + 0.5));
          if (edge <= 0) continue;
          const nz = Math.sqrt(Math.max(0, 1 - d2));
          // Sphere → the map: longitude across the near side (-90..90°), latitude up and down.
          const u = Math.atan2(nx, nz) / Math.PI + 0.5;
          const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
          const tx = Math.min(tw - 2, Math.max(0, Math.floor(u * (tw - 1))));
          const ty = Math.min(thh - 2, Math.max(0, Math.floor(v * (thh - 1))));
          // Four texels averaged: the map is about twice the size it's drawn at.
          const i0 = (ty * tw + tx) * 4;
          const i1 = i0 + 4;
          const i2 = i0 + tw * 4;
          const i3 = i2 + 4;
          // The moon is nearly as bright to its edge as at its middle; the terminator is soft. The night
          // side fades into whatever it's on (the card, as Apple's does), with a trace of earthshine.
          const lit = nx * lx + nz * lz;
          const day = smooth(-0.06, 0.1, lit);
          const light = (0.84 + 0.16 * Math.max(0, lit)) * 1.32;
          const limb = 0.86 + 0.14 * nz;
          const k = (light * limb) / 4;
          const o = (y * S + x) * 4;
          px[o] = Math.min(255, (src[i0] + src[i1] + src[i2] + src[i3]) * k * 0.97);
          px[o + 1] = Math.min(255, (src[i0 + 1] + src[i1 + 1] + src[i2 + 1] + src[i3 + 1]) * k);
          px[o + 2] = Math.min(255, (src[i0 + 2] + src[i1 + 2] + src[i2 + 2] + src[i3 + 2]) * k * 1.05);
          px[o + 3] = edge * (0.07 + 0.93 * day) * 255;
        }
      }
      painted.set(key, out);
      g.putImageData(out, 0, 0);
    })
    .catch(() => {
      // No map (offline the first time): the card keeps its words; the sky keeps its plain moon.
    });
}
