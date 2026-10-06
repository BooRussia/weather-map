/**
 * Live sky behind the weather page, Apple Weather style: a gradient for the
 * scene and time of day, with sun glow, stars, drifting clouds, rain, snow,
 * fog bands, and lightning drawn over it. Classic draws the same effects in
 * white on black. Renders at 1× and ~30 fps; it is a soft background.
 */

export type Scene = 'clear-day' | 'clear-night' | 'cloudy-day' | 'cloudy-night' | 'rain' | 'storm' | 'snow' | 'fog';

/** WMO code + day/night → scene, plus how cloudy and how intense. */
export function sceneFor(code: number, isDay: boolean): { scene: Scene; clouds: number; intensity: number } {
  if (code >= 95) return { scene: 'storm', clouds: 1, intensity: 1 };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { scene: 'snow', clouds: 0.8, intensity: code >= 75 ? 1 : 0.6 };
  if (code === 45 || code === 48) return { scene: 'fog', clouds: 0.4, intensity: 0.8 };
  if (code >= 51) {
    const heavy = [55, 65, 67, 82].includes(code);
    const light = [51, 56, 61, 80].includes(code);
    return { scene: 'rain', clouds: 1, intensity: heavy ? 1 : light ? 0.45 : 0.7 };
  }
  if (code === 3) return { scene: isDay ? 'cloudy-day' : 'cloudy-night', clouds: 1, intensity: 0 };
  if (code === 2) return { scene: isDay ? 'cloudy-day' : 'cloudy-night', clouds: 0.5, intensity: 0 };
  return { scene: isDay ? 'clear-day' : 'clear-night', clouds: code === 1 ? 0.2 : 0, intensity: 0 };
}

const GRADIENTS: Record<Scene, [string, string]> = {
  'clear-day': ['#2c7be5', '#6cb8f0'],
  'clear-night': ['#070b1f', '#1d2a4a'],
  'cloudy-day': ['#5f6f84', '#9aa9bb'],
  'cloudy-night': ['#151c28', '#2b3545'],
  rain: ['#323f50', '#5a6a7d'],
  storm: ['#141a24', '#34404f'],
  snow: ['#7f8b99', '#c3ccd6'],
  fog: ['#8a9098', '#bcc2c8'],
};

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  alpha: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  rate: number;
}

const FRAME_MS = 1000 / 30;

export class SkyRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private scene: Scene = 'clear-day';
  private clouds = 0;
  private intensity = 0;
  private classic = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private t = 0;
  private drops: Drop[] = [];
  private cloudList: Cloud[] = [];
  private stars: Star[] = [];
  private flash = 0;
  private nextFlash = 3;
  private sprite: HTMLCanvasElement | null = null;
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setScene(scene: Scene, clouds: number, intensity: number, classic: boolean): void {
    const changed = scene !== this.scene || classic !== this.classic || clouds !== this.clouds || intensity !== this.intensity;
    this.scene = scene;
    this.clouds = clouds;
    this.intensity = intensity;
    this.classic = classic;
    if (changed) this.populate();
    if (!this.raf) this.draw(0);
  }

  start(): void {
    this.resize();
    if (this.still.matches) {
      this.draw(0);
      return;
    }
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    this.populate();
  }

  private populate(): void {
    const { w, h } = this;
    if (!w || !h) return;
    const rainy = this.scene === 'rain' || this.scene === 'storm';
    const count = rainy ? Math.round((w * h) / 2600 * (0.35 + 0.65 * this.intensity)) : 0;
    this.drops = Array.from({ length: count }, () => this.newDrop(true));
    if (this.scene === 'snow') {
      this.drops = Array.from({ length: Math.round((w * h) / 5000 * (0.5 + this.intensity)) }, () => this.newFlake(true));
    }
    const nClouds = Math.round(this.clouds * (rainy || this.scene === 'snow' ? 7 : 5));
    this.cloudList = Array.from({ length: nClouds }, (_, i) => ({
      x: Math.random() * w * 1.4 - w * 0.2,
      y: h * (0.02 + (i / Math.max(1, nClouds)) * 0.38) + Math.random() * 30,
      scale: 0.7 + Math.random() * 0.9,
      speed: 6 + Math.random() * 10,
      alpha: rainy ? 0.22 : 0.3 + Math.random() * 0.25,
    }));
    const night = this.scene === 'clear-night' || this.scene === 'cloudy-night';
    this.stars = night
      ? Array.from({ length: Math.round((w * h) / (this.scene === 'clear-night' ? 3800 : 9000)) }, () => ({
          x: Math.random() * w,
          y: Math.random() * h * 0.7,
          r: Math.random() < 0.08 ? 1.4 : 0.8,
          phase: Math.random() * Math.PI * 2,
          rate: 0.6 + Math.random() * 1.6,
        }))
      : [];
    this.sprite ??= cloudSprite();
  }

  private newDrop(anywhere: boolean): Drop {
    const far = Math.random() < 0.45;
    return {
      x: Math.random() * (this.w + 120) - 60,
      y: anywhere ? Math.random() * this.h : -40 - Math.random() * 80,
      len: far ? 10 + Math.random() * 8 : 18 + Math.random() * 14,
      speed: far ? 700 + Math.random() * 200 : 1050 + Math.random() * 300,
      alpha: far ? 0.16 : 0.28 + Math.random() * 0.14,
    };
  }

  private newFlake(anywhere: boolean): Drop {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : -10,
      len: 1 + Math.random() * 2.2,
      speed: 25 + Math.random() * 45,
      alpha: 0.5 + Math.random() * 0.4,
    };
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt * 1000;
    if (this.acc < FRAME_MS) return;
    const step = this.acc / 1000;
    this.acc = 0;
    this.draw(step);
  };

  private draw(dt: number): void {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    this.t += dt;

    // Sky
    if (this.classic) {
      ctx.fillStyle = '#000';
    } else {
      const [top, bottom] = GRADIENTS[this.scene];
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, w, h);

    // Sun glow
    if (!this.classic && (this.scene === 'clear-day' || (this.scene === 'cloudy-day' && this.clouds < 1))) {
      const pulse = 0.92 + 0.08 * Math.sin(this.t * 0.4);
      const r = Math.max(w, h) * 0.7 * pulse;
      const g = ctx.createRadialGradient(w * 0.82, h * 0.06, 0, w * 0.82, h * 0.06, r);
      g.addColorStop(0, 'rgba(255, 246, 214, 0.55)');
      g.addColorStop(0.25, 'rgba(255, 236, 190, 0.18)');
      g.addColorStop(1, 'rgba(255, 236, 190, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Stars
    for (const s of this.stars) {
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * s.rate + s.phase));
      ctx.globalAlpha = this.classic ? a * 0.7 : a;
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Clouds
    if (this.sprite) {
      for (const c of this.cloudList) {
        c.x += c.speed * dt;
        const cw = 360 * c.scale;
        if (c.x > w + cw * 0.2) c.x = -cw;
        ctx.globalAlpha = this.classic ? c.alpha * 0.5 : c.alpha;
        ctx.drawImage(this.sprite, c.x, c.y, cw, cw * 0.45);
      }
      ctx.globalAlpha = 1;
    }

    // Fog bands
    if (this.scene === 'fog') {
      for (let i = 0; i < 4; i++) {
        const y = h * (0.35 + i * 0.16) + Math.sin(this.t * 0.2 + i) * 14;
        const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${this.classic ? 0.08 : 0.2})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y - 60, w, 120);
      }
    }

    // Rain
    if (this.scene === 'rain' || this.scene === 'storm') {
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = this.classic ? '#fff' : 'rgba(220, 235, 255, 1)';
      const slant = 0.18;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        d.y += d.speed * dt;
        d.x += d.speed * slant * dt;
        if (d.y - d.len > h || d.x > w + 60) this.drops[i] = this.newDrop(false);
        ctx.globalAlpha = d.alpha;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * slant, d.y - d.len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Snow
    if (this.scene === 'snow') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < this.drops.length; i++) {
        const f = this.drops[i];
        f.y += f.speed * dt;
        f.x += Math.sin(this.t * 0.8 + i) * 12 * dt;
        if (f.y > h + 5) this.drops[i] = this.newFlake(false);
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.len, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Lightning: a quick double flash every few seconds.
    if (this.scene === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 0.0001;
        this.nextFlash = 4 + Math.random() * 6;
      }
      if (this.flash > 0) {
        this.flash += dt;
        const f = this.flash;
        const a = f < 0.06 ? 0.55 : f < 0.12 ? 0.1 : f < 0.2 ? 0.4 : Math.max(0, 0.4 - (f - 0.2) * 1.4);
        ctx.fillStyle = `rgba(235, 240, 255, ${a})`;
        ctx.fillRect(0, 0, w, h);
        if (a <= 0) this.flash = 0;
      }
    }
  }
}

/** One soft cloud, pre-rendered once: overlapping radial puffs. */
function cloudSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 162;
  const ctx = c.getContext('2d')!;
  const puffs: [number, number, number][] = [
    [90, 105, 62],
    [160, 80, 78],
    [235, 95, 66],
    [290, 112, 48],
    [130, 118, 52],
    [205, 120, 56],
  ];
  for (const [x, y, r] of puffs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}
