import { MercatorCoordinate, type CustomLayerInterface, type Map as MlMap } from 'maplibre-gl';

/**
 * A weather variable on a regular longitude/latitude lattice: `values` is
 * row-major, north row first, NaN where there's no data (land, for waves).
 */
export interface FieldGrid {
  west: number;
  east: number;
  south: number;
  north: number;
  cols: number;
  rows: number;
  values: Float32Array;
}

/** How values become color: ramp stops (value, r, g, b, alpha 0..1), and how values are spaced along it. */
export interface FieldRamp {
  stops: [value: number, r: number, g: number, b: number, a: number][];
  /** 'sqrt' spends more of the ramp on small values (rain, snow). */
  curve?: 'linear' | 'sqrt';
}

/** Samples on the smoothing pass: values change slowly, so it runs well below screen resolution. */
const MAX_FIELD_PX = 260_000;
const RAMP_SIZE = 256;

const QUAD_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }`;

/**
 * Pass 1, per field texel: where on Earth it is (the map is north-up with no
 * pitch, so screen → Web Mercator is a box), then a cubic B-spline over the
 * 4×4 lattice points around it. Points with no data drop out and the rest
 * are renormalized (normalized convolution), so coasts fade softly instead
 * of bleeding the land's "no data" into the sea. Out: (t, coverage) for
 * frame a in rg and frame b in ba, t being the value placed on the ramp 0..1.
 */
const FIELD_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform vec4 u_merc;            // x0, y0 (top-left), x1, y1 (bottom-right), Web Mercator 0..1
uniform sampler2D u_a;          // RG32F: value, valid
uniform sampler2D u_b;
uniform vec4 u_boxA;            // west, north, east - west, north - south
uniform vec4 u_boxB;
uniform vec2 u_range;           // ramp domain, after the curve
uniform int u_sqrt;
uniform int u_hasB;
out vec4 o;

const float PI = 3.141592653589793;

float curve(float v) { return u_sqrt == 1 ? sign(v) * sqrt(abs(v)) : v; }

vec4 bspline(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4((1.0 - t) * (1.0 - t) * (1.0 - t), 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

vec2 sampleGrid(sampler2D tex, vec4 box, float lon, float lat) {
  ivec2 size = textureSize(tex, 0);
  // Bring the longitude into the lattice's own 360° window.
  float center = box.x + box.z * 0.5;
  lon += 360.0 * floor((center - lon) / 360.0 + 0.5);
  vec2 g = vec2((lon - box.x) / box.z * float(size.x - 1), (box.y - lat) / box.w * float(size.y - 1));
  vec2 c = floor(g);
  vec2 f = g - c;
  vec4 wx = bspline(f.x), wy = bspline(f.y);
  float sum = 0.0, wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 p = ivec2(c) + ivec2(i - 1, j - 1);
      if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) continue;
      vec2 s = texelFetch(tex, p, 0).rg;
      float w = wx[i] * wy[j] * s.g;
      sum += w * curve(s.r);
      wsum += w;
    }
  }
  float t = wsum > 1e-5 ? (sum / wsum - u_range.x) / (u_range.y - u_range.x) : 0.0;
  return vec2(clamp(t, 0.0, 1.0), wsum);
}

void main() {
  vec2 m = vec2(mix(u_merc.x, u_merc.z, v_uv.x), mix(u_merc.w, u_merc.y, v_uv.y));
  float lon = m.x * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * m.y))));
  vec2 a = sampleGrid(u_a, u_boxA, lon, lat);
  vec2 b = u_hasB == 1 ? sampleGrid(u_b, u_boxB, lon, lat) : a;
  o = vec4(a, b);
}`;

/** Pass 2, per screen pixel: mix the frames in time (by coverage), recolor, fade where data thins out. */
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_field;
uniform sampler2D u_ramp;
uniform float u_f;
uniform float u_opacity;
out vec4 o;
void main() {
  vec4 s = texture(u_field, v_uv);
  float wa = s.y * (1.0 - u_f), wb = s.w * u_f;
  float cov = wa + wb;
  float t = cov > 1e-4 ? (s.x * wa + s.z * wb) / cov : 0.0;
  vec4 c = texture(u_ramp, vec2(t, 0.5));
  float a = c.a * smoothstep(0.08, 0.6, cov) * u_opacity;
  o = vec4(c.rgb * a, a);
}`;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, fs: string, uniforms: string[]): Program {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, QUAD_VS],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`field shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`field program: ${gl.getProgramInfoLog(prog)}`);
  const u: Program['u'] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
}

function texture2d(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const applyCurve = (v: number, ramp: FieldRamp) => (ramp.curve === 'sqrt' ? Math.sign(v) * Math.sqrt(Math.abs(v)) : v);

/** The ramp's domain after its curve: [t = 0, t = 1]. */
export function rampDomain(ramp: FieldRamp): [number, number] {
  return [applyCurve(ramp.stops[0][0], ramp), applyCurve(ramp.stops[ramp.stops.length - 1][0], ramp)];
}

/** 256 RGBA texels across the ramp's domain (straight alpha). */
export function buildFieldRamp(ramp: FieldRamp): Uint8Array {
  const out = new Uint8Array(RAMP_SIZE * 4);
  const [lo, hi] = rampDomain(ramp);
  const stops = ramp.stops.map((s) => [applyCurve(s[0], ramp), s[1], s[2], s[3], s[4]] as const);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const x = lo + ((hi - lo) * i) / (RAMP_SIZE - 1);
    let k = 0;
    while (k < stops.length - 2 && stops[k + 1][0] <= x) k++;
    const a = stops[k];
    const b = stops[k + 1] ?? a;
    const t = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
    for (let c = 1; c <= 4; c++) {
      const v = a[c] + (b[c] - a[c]) * t;
      out[i * 4 + c - 1] = Math.round(c === 4 ? v * 255 : v);
    }
  }
  return out;
}

/** Interleave a grid as (value, valid) pairs for an RG32F texture. */
function pack(grid: FieldGrid): Float32Array {
  const out = new Float32Array(grid.values.length * 2);
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    const ok = Number.isFinite(v);
    out[i * 2] = ok ? v : 0;
    out[i * 2 + 1] = ok ? 1 : 0;
  }
  return out;
}

interface Gl {
  quad: WebGLVertexArrayObject;
  field: Program;
  composite: Program;
  grids: [WebGLTexture, WebGLTexture];
  ramp: WebGLTexture;
  target: WebGLTexture;
  fbo: WebGLFramebuffer;
  float: boolean;
  w: number;
  h: number;
}

/**
 * Windy-style colored weather maps: one variable at a time, drawn smooth
 * over the basemap (under borders, radar, and labels) and crossfaded in time
 * as the timeline plays.
 */
export class FieldLayer implements CustomLayerInterface {
  readonly id = 'weather-field';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private res: Gl | null = null;
  private a: FieldGrid | null = null;
  private b: FieldGrid | null = null;
  private f = 0;
  private uploaded: [FieldGrid | null, FieldGrid | null] = [null, null];
  private ramp: FieldRamp | null = null;
  private rampDirty = false;
  private drawnKey = '';
  private opacity = 0.85;

  constructor(private readonly map: MlMap) {}

  /** Under borders, radar, and labels: before the first boundary line, else the radar. */
  install(): void {
    const layers = this.map.getStyle().layers;
    const before = layers.find((l) => /boundary/.test(l.id))?.id ?? (this.map.getLayer('radar') ? 'radar' : layers.find((l) => l.type === 'symbol')?.id);
    this.map.addLayer(this, before);
  }

  setRamp(ramp: FieldRamp | null, opacity = 0.85): void {
    this.ramp = ramp;
    this.opacity = opacity;
    this.rampDirty = true;
    this.drawnKey = '';
    this.map.triggerRepaint();
  }

  /** Show `a`, crossfading toward `b` by `f` (0..1); null hides the layer. */
  setFrames(a: FieldGrid | null, b: FieldGrid | null = null, f = 0): void {
    if (a === this.a && b === this.b && f === this.f) return;
    this.a = a;
    this.b = b;
    this.f = b ? f : 0;
    this.map.triggerRepaint();
  }

  get visible(): boolean {
    return !!(this.a && this.ramp);
  }

  onAdd(_map: MlMap, gl: WebGL2RenderingContext): void {
    // GL objects are made in the first prerender (MapLibre resets its state cache around render callbacks).
    this.gl = gl;
  }

  onRemove(): void {
    const gl = this.gl;
    const r = this.res;
    if (!gl || !r) return;
    for (const t of [...r.grids, r.ramp, r.target]) gl.deleteTexture(t);
    gl.deleteFramebuffer(r.fbo);
    gl.deleteVertexArray(r.quad);
    gl.deleteProgram(r.field.prog);
    gl.deleteProgram(r.composite.prog);
    this.res = null;
    this.uploaded = [null, null];
  }

  private init(gl: WebGL2RenderingContext): Gl {
    const quad = gl.createVertexArray()!;
    gl.bindVertexArray(quad);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return {
      quad,
      field: compile(gl, FIELD_FS, ['u_merc', 'u_a', 'u_b', 'u_boxA', 'u_boxB', 'u_range', 'u_sqrt', 'u_hasB']),
      composite: compile(gl, COMPOSITE_FS, ['u_field', 'u_ramp', 'u_f', 'u_opacity']),
      grids: [texture2d(gl, gl.NEAREST), texture2d(gl, gl.NEAREST)],
      ramp: texture2d(gl, gl.LINEAR),
      target: texture2d(gl, gl.LINEAR),
      fbo: gl.createFramebuffer()!,
      float: !!gl.getExtension('EXT_color_buffer_float'),
      w: 0,
      h: 0,
    };
  }

  /** Upload a grid to its slot if it isn't there already; true if it changed. */
  private upload(gl: WebGL2RenderingContext, r: Gl, slot: 0 | 1, grid: FieldGrid): boolean {
    if (this.uploaded[slot] === grid) return false;
    gl.bindTexture(gl.TEXTURE_2D, r.grids[slot]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, grid.cols, grid.rows, 0, gl.RG, gl.FLOAT, pack(grid));
    this.uploaded[slot] = grid;
    return true;
  }

  /** The visible area in Web Mercator (0..1), top-left then bottom-right. */
  private mercBox(): [number, number, number, number] {
    const c = this.map.getContainer();
    const tl = MercatorCoordinate.fromLngLat(this.map.unproject([0, 0]));
    const br = MercatorCoordinate.fromLngLat(this.map.unproject([c.clientWidth, c.clientHeight]));
    return [tl.x, tl.y, br.x, br.y];
  }

  prerender(gl: WebGL2RenderingContext): void {
    const { a, ramp } = this;
    if (!a || !ramp) return;
    const r = (this.res ??= this.init(gl));
    if (this.rampDirty) {
      gl.bindTexture(gl.TEXTURE_2D, r.ramp);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RAMP_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildFieldRamp(ramp));
      this.rampDirty = false;
    }
    const b = this.b ?? a;
    const freshA = this.upload(gl, r, 0, a);
    const freshB = this.upload(gl, r, 1, b);
    const fresh = freshA || freshB;

    // Field size: below screen resolution, fixed aspect.
    const el = this.map.getContainer();
    const s = Math.min(1, Math.sqrt(MAX_FIELD_PX / Math.max(1, el.clientWidth * el.clientHeight)));
    const w = Math.max(1, Math.round(el.clientWidth * s));
    const h = Math.max(1, Math.round(el.clientHeight * s));
    if (w !== r.w || h !== r.h) {
      gl.bindTexture(gl.TEXTURE_2D, r.target);
      if (r.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      r.w = w;
      r.h = h;
      this.drawnKey = '';
    }

    const merc = this.mercBox();
    const key = `${merc.join(',')}|${w}x${h}`;
    if (key === this.drawnKey && !fresh) return;
    this.drawnKey = key;

    gl.bindVertexArray(r.quad);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.target, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(r.field.prog);
    const u = r.field.u;
    gl.uniform4f(u.u_merc, ...merc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.grids[0]);
    gl.uniform1i(u.u_a, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.grids[1]);
    gl.uniform1i(u.u_b, 1);
    gl.uniform4f(u.u_boxA, a.west, a.north, a.east - a.west, a.north - a.south);
    gl.uniform4f(u.u_boxB, b.west, b.north, b.east - b.west, b.north - b.south);
    gl.uniform2f(u.u_range, ...rampDomain(ramp));
    gl.uniform1i(u.u_sqrt, ramp.curve === 'sqrt' ? 1 : 0);
    gl.uniform1i(u.u_hasB, b !== a ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  render(gl: WebGL2RenderingContext): void {
    const r = this.res;
    if (!r || !r.w || !this.a || !this.ramp) return;
    gl.bindVertexArray(r.quad);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(r.composite.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.target);
    gl.uniform1i(r.composite.u.u_field, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.ramp);
    gl.uniform1i(r.composite.u.u_ramp, 1);
    gl.uniform1f(r.composite.u.u_f, this.b ? this.f : 0);
    gl.uniform1f(r.composite.u.u_opacity, this.opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
