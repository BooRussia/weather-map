import type { ScreenField } from './screenField';

/** Seconds of travel each streak spans. */
const STREAK_S = 0.02;
const ALPHAS = [0.45, 0.7, 0.95];

/**
 * Rain as short falling streaks. Density follows the field's rain intensity
 * (precip rate scaled by probability); streaks lean with the wind.
 */
export class RainLayer {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private level = new Uint8Array(0);
  private alive = new Uint8Array(0);
  private w = 0;
  private h = 0;
  private readonly vel = new Float32Array(2);

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.n = Math.round(Math.max(200, Math.min(3000, (w * h) / 450)));
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.age = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.level = new Uint8Array(this.n);
    this.alive = new Uint8Array(this.n);
  }

  reset(): void {
    this.alive.fill(0);
  }

  transform(s: number, tx: number, ty: number): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.x[i] * s + tx;
      this.y[i] = this.y[i] * s + ty;
    }
  }

  step(dt: number, field: ScreenField): void {
    if (field.meanRain <= 0) {
      this.alive.fill(0);
      return;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.alive[i]) {
        this.age[i] += dt;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        if (this.age[i] > this.life[i] || this.y[i] > this.h + 20) this.alive[i] = 0;
        continue;
      }
      // Rejection sampling: a dead slot respawns where the rain is.
      const x = Math.random() * this.w;
      const y = Math.random() * this.h;
      const r = field.rainAt(x, y);
      if (r <= 0 || Math.random() > r * 0.5) continue;
      field.velocity(x, y, this.vel);
      const fall = 380 + Math.random() * 160;
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = this.vel[0] * 0.6;
      this.vy[i] = fall + this.vel[1] * 0.3;
      this.age[i] = 0;
      this.life[i] = 0.2 + Math.random() * 0.25;
      this.level[i] = r < 0.33 ? 0 : r < 0.66 ? 1 : 2;
      this.alive[i] = 1;
    }
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = color;
    for (let lv = 0; lv < ALPHAS.length; lv++) {
      ctx.globalAlpha = ALPHAS[lv];
      ctx.beginPath();
      for (let i = 0; i < this.n; i++) {
        if (!this.alive[i] || this.level[i] !== lv) continue;
        const x = this.x[i];
        const y = this.y[i];
        ctx.moveTo(x, y);
        ctx.lineTo(x - this.vx[i] * STREAK_S, y - this.vy[i] * STREAK_S);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
