import type { ScreenField } from './screenField';
import { PX_PER_MPH } from './screenField';

/** History samples per particle; the trail is drawn through these. */
const HIST = 8;
/** Seconds between history samples (trail ≈ HIST × this ≈ 0.55 s of travel: short dashes, not streaks). */
const SAMPLE_EVERY = 0.07;
const LINE_WIDTH = 1;

/** Alpha by wind speed (mph). Calm air is faint, strong wind is brighter; none of it should cover the map. */
const BUCKETS = [
  { maxMph: 4, alpha: 0.3 },
  { maxMph: 10, alpha: 0.45 },
  { maxMph: 20, alpha: 0.6 },
  { maxMph: Infinity, alpha: 0.75 },
];
/** Screen area per particle, CSS px². */
const AREA_PER_PARTICLE = 1300;

/** Wind as advected particles with fading trails, drawn in `foreground`. */
export class WindLayer {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private bucket = new Uint8Array(0);
  /** Ring buffer: [particle][HIST][x,y]. */
  private hist = new Float32Array(0);
  private head = 0;
  private sinceSample = 0;
  private w = 0;
  private h = 0;
  private readonly vel = new Float32Array(2);
  private readonly lists: Int32Array[] = BUCKETS.map(() => new Int32Array(0));
  private readonly listLen = new Int32Array(BUCKETS.length);

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.n = Math.round(Math.max(80, Math.min(1400, (w * h) / AREA_PER_PARTICLE)));
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.age = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.bucket = new Uint8Array(this.n);
    this.hist = new Float32Array(this.n * HIST * 2);
    for (let b = 0; b < BUCKETS.length; b++) this.lists[b] = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.spawn(i);
      // Stagger lifetimes so particles don't all respawn together.
      this.age[i] = Math.random() * this.life[i];
    }
  }

  private spawn(i: number): void {
    const x = Math.random() * this.w;
    const y = Math.random() * this.h;
    this.x[i] = x;
    this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = 1.5 + Math.random() * 2.5;
    const base = i * HIST * 2;
    for (let k = 0; k < HIST; k++) {
      this.hist[base + k * 2] = x;
      this.hist[base + k * 2 + 1] = y;
    }
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
    for (let j = 0; j < this.hist.length; j += 2) {
      this.hist[j] = this.hist[j] * s + tx;
      this.hist[j + 1] = this.hist[j + 1] * s + ty;
    }
  }

  step(dt: number, field: ScreenField): void {
    this.sinceSample += dt;
    const record = this.sinceSample >= SAMPLE_EVERY;
    if (record) {
      this.sinceSample = 0;
      this.head = (this.head + 1) % HIST;
    }
    const v = this.vel;
    const margin = 8;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      let x = this.x[i];
      let y = this.y[i];
      if (this.age[i] > this.life[i] || x < -margin || y < -margin || x > this.w + margin || y > this.h + margin) {
        this.spawn(i);
        continue;
      }
      field.velocity(x, y, v);
      x += v[0] * dt;
      y += v[1] * dt;
      this.x[i] = x;
      this.y[i] = y;
      const mph = Math.hypot(v[0], v[1]) / PX_PER_MPH;
      let b = 0;
      while (mph > BUCKETS[b].maxMph) b++;
      this.bucket[i] = b;
      if (record) {
        const o = (i * HIST + this.head) * 2;
        this.hist[o] = x;
        this.hist[o + 1] = y;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.clearRect(0, 0, this.w, this.h);
    this.listLen.fill(0);
    for (let i = 0; i < this.n; i++) {
      const b = this.bucket[i];
      this.lists[b][this.listLen[b]++] = i;
    }
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    // Segment k = 0 is the oldest piece of the trail; k = HIST - 1 ends at the particle.
    for (let b = 0; b < BUCKETS.length; b++) {
      const list = this.lists[b];
      const len = this.listLen[b];
      if (!len) continue;
      for (let k = 0; k < HIST; k++) {
        ctx.globalAlpha = (BUCKETS[b].alpha * (k + 1)) / HIST;
        ctx.beginPath();
        const s0 = (this.head + 1 + k) % HIST;
        const s1 = (s0 + 1) % HIST;
        const last = k === HIST - 1;
        for (let m = 0; m < len; m++) {
          const i = list[m];
          const base = i * HIST * 2;
          const x0 = this.hist[base + s0 * 2];
          const y0 = this.hist[base + s0 * 2 + 1];
          const x1 = last ? this.x[i] : this.hist[base + s1 * 2];
          const y1 = last ? this.y[i] : this.hist[base + s1 * 2 + 1];
          if (x0 === x1 && y0 === y1) continue;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
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
