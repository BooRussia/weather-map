import type { Map as MlMap } from 'maplibre-gl';

/** Pictures and videos are this wide at most (plenty for a phone, small enough to send). */
const MAX_WIDTH = 1080;
/** Video formats, best first: MP4 plays everywhere; WebM where it's all the browser records. */
const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

/** Paints the map as you see it onto `out`: the map, the wind and rain over it, and a caption along the foot. */
function paint(map: MlMap, overlays: HTMLCanvasElement[], caption: string, out: HTMLCanvasElement): void {
  const src = map.getCanvas();
  const k = Math.min(1, MAX_WIDTH / src.width);
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  const g = out.getContext('2d')!;
  g.drawImage(src, 0, 0, w, h);
  for (const c of overlays) if (c.width && c.height) g.drawImage(c, 0, 0, w, h);
  const size = Math.round(Math.max(14, w / 40));
  g.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const pad = Math.round(size * 0.6);
  const tw = g.measureText(caption).width;
  const y = h - pad * 2 - size;
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  g.beginPath();
  g.roundRect(pad, y, tw + pad * 2, size + pad * 1.4, size * 0.6);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(caption, pad * 2, y + (size + pad * 1.4) / 2);
}

/** A picture of the map now (the map's canvas is only readable right after it draws, so on its next frame). */
export function snapshot(map: MlMap, overlays: HTMLCanvasElement[], caption: string): Promise<Blob | null> {
  const out = document.createElement('canvas');
  return new Promise((resolve) => {
    map.once('render', () => {
      paint(map, overlays, caption, out);
      out.toBlob((b) => resolve(b), 'image/png');
    });
    map.triggerRepaint();
  });
}

/** Whether this browser can record the map as a video. */
export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && VIDEO_TYPES.some((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * A short video of the map while `play` runs the radar loop (owner, 2026-10-29: share a radar loop,
 * as MyRadar and RadarScope do): every frame the map draws, with the wind and rain over it and the
 * caption (asked each frame, so the time moves), for `seconds`.
 */
export async function recordLoop(
  map: MlMap,
  overlays: HTMLCanvasElement[],
  caption: () => string,
  seconds: number,
  play: () => void,
  stop: () => void,
): Promise<{ blob: Blob; type: string } | null> {
  const type = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const out = document.createElement('canvas');
  paint(map, overlays, caption(), out);
  const rec = new MediaRecorder(out.captureStream(30), { mimeType: type, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const draw = () => paint(map, overlays, caption(), out);
  map.on('render', draw);
  // Keep the map drawing every frame, so the particles and the playhead keep moving in the video.
  let live = true;
  const tick = () => {
    if (!live) return;
    map.triggerRepaint();
    requestAnimationFrame(tick);
  };
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(250);
  play();
  tick();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  live = false;
  stop();
  rec.stop();
  await done;
  map.off('render', draw);
  return chunks.length ? { blob: new Blob(chunks, { type: type.split(';')[0] }), type: type.split(';')[0] } : null;
}
