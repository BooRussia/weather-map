import type { ScreenField } from './screenField';
import { PX_PER_MPH } from './screenField';

/**
 * Each particle is a short comet along the wind: brightest and widest at the
 * head, tapering to nothing at the tail. Its length is the distance it covers
 * in STREAK_S, so stronger wind draws longer streaks.
 */
const STREAK_S = 0.2;
const MIN_LEN = 4;
const MAX_LEN = 20;
/** Pieces per comet, tail to head; each is a little wider and brighter. */
const SEGMENTS = 5;
const TAIL_WIDTH = 0.5;
const HEAD_WIDTH = 1.6;
/** Seconds to fade in after spawning and out before dying, so nothing pops. */
const FADE_IN = 0.4;
const FADE_OUT = 0.6;
/** Head opacity by wind speed (mph): calm air is faint, strong wind brighter. */
const SPEED_ALPHA: [maxMph: number, alpha: number][] = [
  [4, 0.35],
  [10, 0.5],
  [20, 0.65],
  [Infinity, 0.8],
];
/** Opacity is drawn in this many steps (one batch each); too fine to see. */
const LEVELS = 10;
const MAX_ALPHA = 0.8;
/** Screen area per particle, CSS px². */
const AREA_PER_PARTICLE = 650;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Wind as advected particles drawn as tapered comets, in `foreground`. */
export class WindLayer {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  /** Velocity at the particle, px/s: the comet points along it. */
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  /** Opacity step, 0 (hidden) … LEVELS. */
  private level = new Uint8Array(0);
  private w = 0;
  private h = 0;
  private readonly vel = new Float32Array(2);
  private readonly lists: Int32Array[] = Array.from({ length: LEVELS + 1 }, () => new Int32Array(0));
  private readonly listLen = new Int32Array(LEVELS + 1);

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.n = Math.round(Math.max(80, Math.min(2500, (w * h) / AREA_PER_PARTICLE)));
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.age = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.level = new Uint8Array(this.n);
    for (let l = 0; l <= LEVELS; l++) this.lists[l] = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.spawn(i);
      // Stagger lifetimes so particles don't all respawn together.
      this.age[i] = Math.random() * this.life[i];
    }
  }

  private spawn(i: number): void {
    this.x[i] = Math.random() * this.w;
    this.y[i] = Math.random() * this.h;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.age[i] = 0;
    this.life[i] = 1.5 + Math.random() * 2.5;
    this.level[i] = 0;
  }

  /** Respawn everything (e.g. after a camera jump). */
  scatter(): void {
    for (let i = 0; i < this.n; i++) this.spawn(i);
  }

  /** Keep particles pinned to the map while it pans or zooms: p' = s·p + t. */
  transform(s: number, tx: number, ty: number): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.x[i] * s + tx;
      this.y[i] = this.y[i] * s + ty;
    }
  }

  step(dt: number, field: ScreenField): void {
    const v = this.vel;
    const margin = MAX_LEN;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      let x = this.x[i];
      let y = this.y[i];
      if (this.age[i] > this.life[i] || x < -margin || y < -margin || x > this.w + margin || y > this.h + margin) {
        this.spawn(i);
        x = this.x[i];
        y = this.y[i];
      }
      field.velocity(x, y, v);
      this.x[i] = x + v[0] * dt;
      this.y[i] = y + v[1] * dt;
      this.vx[i] = v[0];
      this.vy[i] = v[1];
      const mph = Math.hypot(v[0], v[1]) / PX_PER_MPH;
      let k = 0;
      while (mph > SPEED_ALPHA[k][0]) k++;
      const age = this.age[i];
      const fade = smooth(age / FADE_IN) * smooth((this.life[i] - age) / FADE_OUT);
      this.level[i] = Math.round(((SPEED_ALPHA[k][1] * fade) / MAX_ALPHA) * LEVELS);
    }
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.clearRect(0, 0, this.w, this.h);
    this.listLen.fill(0);
    for (let i = 0; i < this.n; i++) {
      const l = this.level[i];
      if (l > 0) this.lists[l][this.listLen[l]++] = i;
    }
    ctx.strokeStyle = color;
    // Piece s = 0 is the tail; s = SEGMENTS - 1 ends at the particle. Square
    // ends meet without overlapping (no bright seams); the head is rounded.
    for (let s = 0; s < SEGMENTS; s++) {
      const t0 = s / SEGMENTS;
      const t1 = (s + 1) / SEGMENTS;
      ctx.lineCap = s === SEGMENTS - 1 ? 'round' : 'butt';
      ctx.lineWidth = TAIL_WIDTH + (HEAD_WIDTH - TAIL_WIDTH) * t1;
      const taper = t1 * t1;
      for (let l = 1; l <= LEVELS; l++) {
        const len = this.listLen[l];
        if (!len) continue;
        ctx.globalAlpha = ((MAX_ALPHA * l) / LEVELS) * taper;
        ctx.beginPath();
        const list = this.lists[l];
        for (let m = 0; m < len; m++) {
          const i = list[m];
          const vx = this.vx[i];
          const vy = this.vy[i];
          const speed = Math.hypot(vx, vy);
          if (speed < 1e-3) continue;
          // Tail sits `streak` px behind the head, against the wind.
          const streak = Math.min(MAX_LEN, Math.max(MIN_LEN, speed * STREAK_S));
          const ux = (vx / speed) * streak;
          const uy = (vy / speed) * streak;
          const hx = this.x[i];
          const hy = this.y[i];
          ctx.moveTo(hx - ux * (1 - t0), hy - uy * (1 - t0));
          ctx.lineTo(hx - ux * (1 - t1), hy - uy * (1 - t1));
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.w, this.h);
  }
}
