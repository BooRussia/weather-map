import { compile, GAUSS9_FS, QUAD_VS, target, texture2d, type Program } from './gl';

/**
 * Pyramid levels. The search runs over the whole reach on the coarsest
 * (4× the finest texel), and each finer level refines its vector by a texel.
 */
const LEVELS = 3;
/** The finest level's texels: at most this many, and at least 2 km (MRMS is 1 km, blurred). */
const MAX_TEXELS = 16_000;
const MIN_TEXEL_KM = 2;
/** The fastest storms, km/h: how far the search reaches between frames. */
const MAX_SPEED_KMH = 150;
/** Search radius on the coarsest level, texels (13 × 13 candidates). */
const MAX_RADIUS = 6;
/** One smoothing pass's Gaussian sigma per tap step (GAUSS9_FS). */
const SIGMA_PER_STEP = 1.75;

/** Field → finest level: each frame's strength (field r for frame a, b for frame b), box-averaged per texel. */
const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_cell;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) acc += texture(u_src, v_uv + (vec2(float(i), float(j)) - 1.5) * 0.25 * u_cell).rb;
  }
  o = vec4(acc / 16.0, 0.0, 1.0);
}`;

/** Each coarser level: one filtered tap where four texels meet averages them. */
const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_src, v_uv); }`;

/**
 * Block matching: for each texel, the move (in this level's texels) that
 * best lines a 5 × 5 block of frame a up with frame b, searched around the
 * coarser level's answer. Ties (no echo, flat rain) go to that answer, and
 * at the top to no motion. The last level fits a parabola through the cost
 * around the best move for a fraction of a texel. Output is the vector times
 * the echo in the block (how far to trust it), and that echo, so smoothing
 * can spread trusted vectors into empty places (normalized convolution).
 */
const SEARCH_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_prior;
uniform vec2 u_texel;
uniform float u_priorScale;
uniform int u_radius;
uniform float u_max;
uniform int u_refine;
in vec2 v_uv;
out vec4 o;
float cost(vec2 d) {
  float s = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 q = v_uv + vec2(float(i), float(j)) * u_texel;
      s += abs(texture(u_src, q).r - texture(u_src, q + d * u_texel).g);
    }
  }
  return s;
}
void main() {
  vec4 pr = texture(u_prior, v_uv);
  vec2 p = pr.xy / max(pr.z, 0.05) * u_priorScale;
  vec2 c = floor(p + 0.5);
  float best = 1e9;
  vec2 bd = c;
  for (int y = -u_radius; y <= u_radius; y++) {
    for (int x = -u_radius; x <= u_radius; x++) {
      vec2 d = c + vec2(float(x), float(y));
      if (length(d) > u_max + 0.5) continue;
      vec2 e = d - p;
      float s = cost(d) + 0.02 * dot(e, e);
      if (s < best) {
        best = s;
        bd = d;
      }
    }
  }
  float w = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec4 v = texture(u_src, v_uv + vec2(float(i), float(j)) * u_texel);
      w += v.r + v.g;
    }
  }
  if (u_refine == 1) {
    float c0 = cost(bd);
    float xl = cost(bd - vec2(1.0, 0.0));
    float xr = cost(bd + vec2(1.0, 0.0));
    float yl = cost(bd - vec2(0.0, 1.0));
    float yr = cost(bd + vec2(0.0, 1.0));
    float cx = xl + xr - 2.0 * c0;
    float cy = yl + yr - 2.0 * c0;
    if (cx > 1e-4) bd.x += clamp(0.5 * (xl - xr) / cx, -0.5, 0.5);
    if (cy > 1e-4) bd.y += clamp(0.5 * (yl - yr) / cy, -0.5, 0.5);
  }
  o = vec4(bd * w, w, 1.0);
}`;

export interface FlowInput {
  /** The smoothed field: frame a's strength in r, frame b's in b. */
  field: WebGLTexture;
  fieldW: number;
  fieldH: number;
  /** A field pixel, km. */
  pxKm: number;
  /** Minutes from frame a to frame b. */
  minutes: number;
  /**
   * Smooth the answer over about this distance, km (a Gaussian's sigma): only the broad motion is kept.
   * For carrying rain far ahead (the nowcast), where a block's own noise would be multiplied into streaks.
   */
  smoothKm?: number;
}

interface Plan {
  w: number;
  h: number;
  texKm: number;
  reachKm: number;
}

/**
 * Where the rain moves between two radar frames (optical flow), so playback
 * can slide storms along their paths instead of fading one picture into the
 * next. Computed on the GPU from the radar layer's own smoothed field, once
 * per frame pair and view.
 */
export class RadarFlow {
  private progs: { down: Program; copy: Program; search: Program; blur: Program } | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private zeroTex: WebGLTexture | null = null;
  private pyr: WebGLTexture[] = [];
  private flow: WebGLTexture[] = [];
  private tmp: WebGLTexture[] = [];
  private sizes: [number, number][] = [];

  /** The finest level's size, or null when these frames can't be matched here (the moves are too big for the view). */
  static plan(i: FlowInput): Plan | null {
    if (!(i.minutes > 0)) return null;
    const reachKm = (MAX_SPEED_KMH * Math.min(i.minutes, 40)) / 60;
    if (Math.min(i.fieldW, i.fieldH) * i.pxKm < 2 * reachKm) return null;
    const k = Math.max(1, MIN_TEXEL_KM / i.pxKm, Math.sqrt((i.fieldW * i.fieldH) / MAX_TEXELS));
    const w = Math.max(8, Math.round(i.fieldW / k));
    const h = Math.max(8, Math.round(i.fieldH / k));
    return { w, h, texKm: (i.pxKm * i.fieldW) / w, reachKm };
  }

  /** The flow: (x·trust, y·trust, trust), x and y in finest-level texels. */
  get result(): WebGLTexture | null {
    return this.flow[0] ?? null;
  }

  /** The finest level's size (what a vector's texels are). */
  get size(): [number, number] {
    return this.sizes[0] ?? [1, 1];
  }

  /** No motion anywhere (sampled when not gliding). */
  zero(gl: WebGL2RenderingContext): WebGLTexture {
    if (!this.zeroTex) {
      this.zeroTex = texture2d(gl, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    return this.zeroTex;
  }

  /** Match the two frames in `i.field`. Needs float render targets; leaves the framebuffer bound. False: not possible here. */
  compute(gl: WebGL2RenderingContext, i: FlowInput): boolean {
    const plan = RadarFlow.plan(i);
    if (!plan) return false;
    const p = (this.progs ??= {
      down: compile(gl, QUAD_VS, DOWN_FS, ['u_src', 'u_cell']),
      copy: compile(gl, QUAD_VS, COPY_FS, ['u_src']),
      search: compile(gl, QUAD_VS, SEARCH_FS, ['u_src', 'u_prior', 'u_texel', 'u_priorScale', 'u_radius', 'u_max', 'u_refine']),
      blur: compile(gl, QUAD_VS, GAUSS9_FS, ['u_tex', 'u_step']),
    });
    const fbo = (this.fbo ??= gl.createFramebuffer()!);
    this.resize(gl, plan.w, plan.h);

    // 1. The pyramid: the field averaged into the finest level, then halved twice.
    gl.activeTexture(gl.TEXTURE0);
    target(gl, fbo, this.pyr[0], ...this.sizes[0]);
    gl.useProgram(p.down.prog);
    gl.uniform1i(p.down.u.u_src, 0);
    gl.uniform2f(p.down.u.u_cell, 1 / this.sizes[0][0], 1 / this.sizes[0][1]);
    gl.bindTexture(gl.TEXTURE_2D, i.field);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(p.copy.prog);
    gl.uniform1i(p.copy.u.u_src, 0);
    for (let l = 1; l < LEVELS; l++) {
      target(gl, fbo, this.pyr[l], ...this.sizes[l]);
      gl.bindTexture(gl.TEXTURE_2D, this.pyr[l - 1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 2. Search the coarsest level over the whole reach, then refine level by level.
    for (let l = LEVELS - 1; l >= 0; l--) {
      const [w, h] = this.sizes[l];
      const maxTex = plan.reachKm / (plan.texKm * 2 ** l);
      const top = l === LEVELS - 1;
      target(gl, fbo, this.flow[l], w, h);
      gl.useProgram(p.search.prog);
      gl.uniform1i(p.search.u.u_src, 0);
      gl.uniform1i(p.search.u.u_prior, 1);
      gl.uniform2f(p.search.u.u_texel, 1 / w, 1 / h);
      gl.uniform1f(p.search.u.u_priorScale, top ? 0 : 2);
      gl.uniform1i(p.search.u.u_radius, top ? Math.max(1, Math.min(MAX_RADIUS, Math.ceil(maxTex))) : 1);
      gl.uniform1f(p.search.u.u_max, maxTex);
      gl.uniform1i(p.search.u.u_refine, l === 0 ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, top ? this.zero(gl) : this.flow[l + 1]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pyr[l]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Spread trusted vectors over the coarse answer (the next level's starting point) and the final one.
      if (top || l === 0) this.smooth(gl, p.blur, fbo, l, l === 0 ? 1.5 : 1);
    }

    // Broad motion only: passes with doubling steps until the smoothing reaches smoothKm (variances add).
    if (i.smoothKm) {
      const want = (i.smoothKm / plan.texKm) ** 2;
      let have = (SIGMA_PER_STEP * 1.5) ** 2;
      for (let step = 1.5; have < want && step <= 24; step *= 2) {
        this.smooth(gl, p.blur, fbo, 0, step);
        have += (SIGMA_PER_STEP * step) ** 2;
      }
    }
    return true;
  }

  private smooth(gl: WebGL2RenderingContext, blur: Program, fbo: WebGLFramebuffer, l: number, step: number): void {
    const [w, h] = this.sizes[l];
    gl.useProgram(blur.prog);
    gl.uniform1i(blur.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    target(gl, fbo, this.tmp[l], w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.flow[l]);
    gl.uniform2f(blur.u.u_step, step / w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    target(gl, fbo, this.flow[l], w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.tmp[l]);
    gl.uniform2f(blur.u.u_step, 0, step / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private resize(gl: WebGL2RenderingContext, w0: number, h0: number): void {
    if (this.sizes[0]?.[0] === w0 && this.sizes[0]?.[1] === h0) return;
    if (!this.pyr.length) {
      for (let l = 0; l < LEVELS; l++) {
        this.pyr.push(texture2d(gl, gl.LINEAR));
        this.flow.push(texture2d(gl, gl.LINEAR));
        this.tmp.push(texture2d(gl, gl.LINEAR));
      }
    }
    this.sizes = [];
    for (let l = 0; l < LEVELS; l++) {
      const w = Math.max(1, Math.ceil(w0 / 2 ** l));
      const h = Math.max(1, Math.ceil(h0 / 2 ** l));
      this.sizes.push([w, h]);
      for (const tex of [this.pyr[l], this.flow[l], this.tmp[l]]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      }
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const tex of [...this.pyr, ...this.flow, ...this.tmp]) gl.deleteTexture(tex);
    if (this.zeroTex) gl.deleteTexture(this.zeroTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.progs) for (const prog of Object.values(this.progs)) gl.deleteProgram(prog.prog);
    this.pyr = [];
    this.flow = [];
    this.tmp = [];
    this.sizes = [];
    this.zeroTex = null;
    this.fbo = null;
    this.progs = null;
  }
}
