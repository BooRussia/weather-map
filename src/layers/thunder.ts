import type { StormCell } from '../field/grid';

/** Total lifetime of one strike on screen, seconds (under 400 ms). */
const STRIKE_LIFE = 0.38;
/** Strikes per second per visible storm cell, by storm level. */
const RATE_PER_LEVEL = 0.18;
/** Never more than this many strikes per second across the view. */
const MAX_RATE = 1.2;

export interface Strike {
  lon: number;
  lat: number;
  born: number;
  /** Bolt and branch as flat [x, y, …] offsets in px from the strike point. */
  bolt: Float32Array;
  branch: Float32Array;
}

/**
 * Animated bolts inside lightning cells: live GOES lightning mapper flashes
 * when available (data/lightning), else forecast thunderstorm cells (WMO
 * codes 95–99). Where comes from the data; the exact timing is for show.
 */
export class ThunderLayer {
  private cells: StormCell[] = [];
  private cellDeg = { lon: 0, lat: 0 };
  private strikes: Strike[] = [];

  setCells(cells: StormCell[], cellDeg: { lon: number; lat: number }): void {
    this.cells = cells;
    this.cellDeg = cellDeg;
  }

  reset(): void {
    this.strikes = [];
  }

  /**
   * Advance time. Returns a new strike when one fires this frame.
   * `visible` limits strikes to storm cells currently on screen.
   */
  update(now: number, dt: number, visible: (lon: number, lat: number) => boolean): Strike | null {
    this.strikes = this.strikes.filter((s) => now - s.born < STRIKE_LIFE);
    const live = this.cells.filter((c) => visible(c.lon, c.lat));
    if (!live.length) return null;
    const totalWeight = live.reduce((sum, c) => sum + c.level, 0);
    const rate = Math.min(MAX_RATE, totalWeight * RATE_PER_LEVEL);
    if (Math.random() > 1 - Math.exp(-rate * dt)) return null;

    let pick = Math.random() * totalWeight;
    let cell = live[0];
    for (const c of live) {
      pick -= c.level;
      if (pick <= 0) {
        cell = c;
        break;
      }
    }
    const strike = makeStrike(
      cell.lon + (Math.random() - 0.5) * this.cellDeg.lon,
      cell.lat + (Math.random() - 0.5) * this.cellDeg.lat,
      now,
    );
    this.strikes.push(strike);
    return strike;
  }

  hasCellsIn(visible: (lon: number, lat: number) => boolean): boolean {
    return this.cells.some((c) => visible(c.lon, c.lat));
  }

  draw(ctx: CanvasRenderingContext2D, now: number, project: (lon: number, lat: number) => { x: number; y: number }, color: string): void {
    if (!this.strikes.length) return;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const s of this.strikes) {
      const a = flicker(now - s.born);
      if (a <= 0) continue;
      const p = project(s.lon, s.lat);
      // Wide faint pass, then the core.
      ctx.globalAlpha = a * 0.16;
      ctx.lineWidth = 3.5;
      strokePath(ctx, s.bolt, p.x, p.y);
      ctx.globalAlpha = a;
      ctx.lineWidth = 1.4;
      strokePath(ctx, s.bolt, p.x, p.y);
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = a * 0.8;
      strokePath(ctx, s.branch, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Bright, brief dip, bright again, then decay — the way a return stroke flickers. */
function flicker(age: number): number {
  if (age < 0.05) return 1;
  if (age < 0.09) return 0.25;
  if (age < 0.14) return 1;
  return Math.max(0, 1 - (age - 0.14) / (STRIKE_LIFE - 0.14));
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Float32Array, ox: number, oy: number): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(ox + pts[0], oy + pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(ox + pts[i], oy + pts[i + 1]);
  ctx.stroke();
}

export function makeStrike(lon: number, lat: number, born: number): Strike {
  // Short, so the bolt lands on its spot instead of filling the sky above it.
  const len = 26 + Math.random() * 24;
  // Come in from above, within ±35° of vertical; end at the strike point.
  const ang = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.39);
  const start: [number, number] = [Math.cos(ang) * len, Math.sin(ang) * len];
  const bolt = jagged(start, [0, 0], 5, len * 0.18);

  const pts = bolt.length / 2;
  const at = Math.floor(pts * (0.25 + Math.random() * 0.35));
  const bx = bolt[at * 2];
  const by = bolt[at * 2 + 1];
  const dir = Math.atan2(-start[1], -start[0]) + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.45);
  const blen = len * (0.35 + Math.random() * 0.2);
  const branch = jagged([bx, by], [bx + Math.cos(dir) * blen, by + Math.sin(dir) * blen], 3, blen * 0.2);
  return { lon, lat, born, bolt, branch };
}

/** Midpoint displacement between two points. */
function jagged(a: [number, number], b: [number, number], depth: number, amp: number): Float32Array {
  let pts: number[] = [a[0], a[1], b[0], b[1]];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i];
      const y0 = pts[i + 1];
      const x1 = pts[i + 2];
      const y1 = pts[i + 3];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * 2 * amp;
      next.push(x0, y0, (x0 + x1) / 2 + (-dy / l) * off, (y0 + y1) / 2 + (dx / l) * off);
    }
    next.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    amp /= 2;
  }
  return new Float32Array(pts);
}
