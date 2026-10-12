import { camera, nearby, type Camera, type CameraData, type CameraView } from '../data/cameras';
import { h, svg } from './dom';
import { expandIcon } from './icons';
import { segmented } from './layersMenu';

/** Snapshots are asked for again no more often than this, s (some DOTs renew theirs every 10 s). */
const MIN_REFRESH_S = 10;
/** Nearby cameras listed under the picture, and how far they may be, miles. */
const NEARBY = 8;
const NEARBY_MILES = 25;

export interface CameraViewer {
  el: HTMLElement;
  camera: Camera;
  /** Stop the stream and the refresh (the sheet closed or moved to another camera). */
  dispose(): void;
}

/** "every minute", "every 10 seconds" */
function every(s: number): string {
  if (s % 60 === 0) return s === 60 ? 'every minute' : `every ${s / 60} minutes`;
  return `every ${s} seconds`;
}

/** "Updated 12 s ago" / "Updated 2 min ago" */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `Updated ${s} s ago` : `Updated ${Math.round(s / 60)} min ago`;
}

/** The same image, fetched fresh (DOTs keep the URL and replace the picture). */
const fresh = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 1000)}`;

/**
 * Play an HLS stream in `video`: natively where the browser can (Safari, iOS), else with hls.js, loaded
 * only now. Resolves to a stop function; `onFail` runs if the stream breaks for good.
 */
async function playStream(video: HTMLVideoElement, url: string, onFail: () => void): Promise<() => void> {
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('error', onFail, { once: true });
    void video.play().catch(() => {});
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }
  const { default: Hls } = (await import('hls.js/light')) as typeof import('hls.js');
  if (!Hls.isSupported()) throw new Error('No HLS support');
  const hls = new Hls({ liveSyncDurationCount: 2, maxBufferLength: 12, backBufferLength: 10 });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal) onFail();
  });
  // Play once the stream is read (sooner, the browser refuses: there's nothing to play yet), at its live edge.
  hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => {}));
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}

/**
 * The camera sheet's body: the live picture (video where the DOT streams openly, else its snapshot,
 * renewed as often as the DOT does), its other views, the road it watches, where it comes from, and the
 * cameras nearby. `open` moves the sheet to another camera.
 */
export function cameraViewer(d: CameraData, i: number, opts: { km: boolean; open: (j: number) => void }): CameraViewer {
  const cam = camera(d, i);
  const src = cam.source;
  const refreshS = Math.max(MIN_REFRESH_S, src.refresh);
  let disposed = false;
  let stop: (() => void) | null = null;
  let timer = 0;
  let ticker = 0;
  let shownAt = 0;
  let view: CameraView = cam.views[0];

  // What's showing and how fresh it is, under the picture: DOTs burn their own captions into its corners.
  const msg = h('p', { class: 'cam-msg', hidden: true });
  const full = h('button', { class: 'cam-full', type: 'button', 'aria-label': 'Full screen', title: 'Full screen' }, svg(expandIcon));
  const media = h('div', { class: 'cam-media' }, full, msg);
  const status = h('p', { class: 'cam-status' });
  const setStatus = (text: string, isLive = false) => {
    status.classList.toggle('is-live', isLive);
    status.textContent = text;
  };

  const clear = () => {
    window.clearTimeout(timer);
    window.clearInterval(ticker);
    stop?.();
    stop = null;
    media.querySelectorAll('img, video').forEach((el) => el.remove());
    msg.hidden = true;
  };

  const showMessage = (text: string) => {
    msg.textContent = text;
    msg.hidden = false;
  };

  /** The DOT's snapshot, renewed as often as it renews it (each loads behind the shown one, then swaps in). */
  const snapshots = (videoFailed = false) => {
    const img = h('img', { class: 'cam-img', alt: `${cam.title}, latest camera image`, decoding: 'async' });
    media.prepend(img);
    const line = () =>
      `${videoFailed ? 'Live video isn’t playing right now. ' : ''}${shownAt ? ago(shownAt) : 'Loading'}, new ${every(refreshS)} · ${src.agency}`;
    setStatus(line());
    const load = () => {
      if (disposed) return;
      const next = new Image();
      next.decoding = 'async';
      next.onload = () => {
        if (disposed) return;
        img.src = next.src;
        shownAt = Date.now();
        setStatus(line());
        msg.hidden = true;
        timer = window.setTimeout(load, refreshS * 1000);
      };
      next.onerror = () => {
        if (disposed) return;
        if (!shownAt) showMessage('This camera’s image isn’t available right now.');
        timer = window.setTimeout(load, refreshS * 1000);
      };
      next.src = fresh(view.image);
    };
    load();
    ticker = window.setInterval(() => {
      if (shownAt) setStatus(line());
    }, 5000);
  };

  /** Live video, falling back to snapshots if the stream won't play. */
  const live = (url: string) => {
    const video = h('video', { class: 'cam-video', muted: true, playsinline: true, autoplay: true, 'aria-label': `${cam.title}, live video` });
    video.muted = true; // the attribute alone doesn't let autoplay through everywhere
    media.prepend(video);
    setStatus(`Live video · ${src.agency}`, true);
    const fail = () => {
      if (disposed || !video.isConnected) return;
      clear();
      snapshots(true);
    };
    playStream(video, url, fail)
      .then((s) => {
        if (disposed) s();
        else stop = s;
      })
      .catch(fail);
  };

  const show = (v: CameraView) => {
    view = v;
    clear();
    shownAt = 0;
    if (v.video) live(v.video);
    else snapshots();
  };

  // Full screen: the video's own player where there is one (iPhone), else the picture's box.
  const canFull = () => !!document.fullscreenEnabled || !!media.querySelector('video');
  full.addEventListener('click', () => {
    const video = media.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenEnabled) void media.requestFullscreen().catch(() => {});
    else video?.webkitEnterFullscreen?.();
  });

  const views =
    cam.views.length > 1
      ? segmented(
          'Camera view',
          cam.views.map((_, k) => ({ value: String(k), label: `View ${k + 1}` })),
          '0',
          (k) => show(cam.views[Number(k)]),
        )
      : null;
  views?.classList.add('seg-compact', 'cam-views');

  // Live video isn't open to other sites everywhere: the DOT's own site has it.
  const anyVideo = cam.views.some((v) => v.video);
  const link = h(
    'a',
    { class: 'cam-link', href: src.site, target: '_blank', rel: 'noopener' },
    anyVideo ? `More cameras on ${src.name}` : `Live video on ${src.name}`,
  );

  const near = nearby(d, i, NEARBY, NEARBY_MILES);
  const strip = near.length
    ? h(
        'div',
        { class: 'cam-strip' },
        ...near.map(({ i: j, miles }) => {
          const c = camera(d, j);
          const dist = opts.km ? `${(miles * 1.609).toFixed(miles < 6 ? 1 : 0)} km` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
          const b = h(
            'button',
            { class: 'cam-thumb', type: 'button', title: c.title },
            h('img', { src: c.views[0].image, alt: '', loading: 'lazy', decoding: 'async' }),
            h('span', { class: 'cam-thumb-title' }, c.title),
            h('span', { class: 'cam-thumb-sub' }, `${dist}${c.views.some((v) => v.video) ? ' · Live' : ''}`),
          );
          b.addEventListener('click', () => opts.open(j));
          return b;
        }),
      )
    : null;

  const el = h(
    'div',
    { class: 'cam' },
    media,
    views,
    cam.sub ? h('p', { class: 'cam-road' }, cam.sub) : null,
    status,
    h('p', { class: 'cam-source' }, `${src.name} · `, link),
    strip ? h('p', { class: 'group-label' }, 'Nearby cameras') : null,
    strip,
  );

  show(view);
  full.hidden = !canFull();

  return {
    el,
    camera: cam,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
