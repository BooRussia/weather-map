import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { ColorMode } from '../config';
import { frameSource, tileMirrors, tilePalette, type FrameSource, type TilePalette, type Timeline } from '../data/timeline';
import { compile, GAUSS9_FS, QUAD_VS, target, texture2d, type Program } from './gl';
import { RadarFlow } from './radarFlow';
import { buildLut, buildMrmsLut, buildRamp, buildVelocityLut, buildVelocityRamp, LUT_BITS, LUT_SIZE } from './radarPalette';

/** What the tiles on screen are: reflectivity (composite, site N0B, HRRR) or a site's storm-relative velocity. */
export type RadarProduct = 'reflectivity' | 'velocity';

/** Tile zooms requested. IEM's composite is ~0.5 km, about z8. */
const MIN_Z = 3;
const MAX_Z = 8;
/** MapLibre's in-tile coordinate range. */
const EXTENT = 8192;
/** Decoded tiles kept on the GPU (128 KB each: strength and echo). */
const MAX_TILES = 240;
const MAX_INFLIGHT = 20;
/** Failed tiles (e.g. a 503) are retried after this long, ms. */
const RETRY_MS = 30_000;
/** Images decoded per map frame, so a burst of arrivals doesn't hitch a frame. */
const DECODES_PER_FRAME = 6;
/** Cap on the smoothing buffer's size, pixels. */
const MAX_FIELD_PX = 1_200_000;
/** Smoothing radius (Gaussian sigma), CSS pixels, and its share of a tile pixel when zoomed past the data. */
const BLUR_PX = 3;
const BLUR_PER_TEXEL = 0.9;

type TileState = 'loading' | 'decode' | 'ready' | 'failed';

interface TileEntry {
  state: TileState;
  img: HTMLImageElement | null;
  tex: WebGLTexture | null;
  used: number;
  failedAt: number;
}

interface Cover {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const lonToX = (lon: number) => (lon + 180) / 360;
const latToY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
const tileKey = (frame: string, z: number, x: number, y: number) => `${frame}|${z}/${x}/${y}`;

/** Half the Web Mercator world's width, m. */
const WORLD = 20037508.342789244;

/** A tile's bounds in Web Mercator meters, as WMS wants them (west,south,east,north). */
export function tileBbox(z: number, x: number, y: number): string {
  const span = (2 * WORLD) / 2 ** z;
  return [-WORLD + x * span, WORLD - (y + 1) * span, -WORLD + (x + 1) * span, WORLD - y * span].map((v) => v.toFixed(2)).join(',');
}

/** Ground size of a CSS pixel at a latitude and zoom (MapLibre's 512 px tiles), km. */
const pixelKm = (lat: number, zoom: number) => (40075.016686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/**
 * Tile colors → (reflectivity, echo) via the 3-D lookup: r is the palette
 * entry / 255 where there's an echo (0 elsewhere), g is 1 where there's an
 * echo. Keeping "how strong" and "is there one" apart lets every later
 * filter average strength over echoes only (normalized convolution), so
 * small or scattered rain keeps its real intensity instead of being diluted
 * by the empty pixels around it.
 */
const DECODE_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_src;
uniform sampler3D u_lut;
out vec4 o;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  if (c.a < 0.5) { o = vec4(0.0); return; }
  ivec3 q = ivec3(c.rgb * 255.0 + 0.5) >> ${8 - LUT_BITS};
  float v = texelFetch(u_lut, q, 0).r;
  o = vec4(v, v > 0.0 ? 1.0 : 0.0, 0.0, 1.0);
}`;

const TILE_VS = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
uniform vec4 u_uv;
out vec2 v_uv;
void main() {
  v_uv = u_uv.xy + a_pos * u_uv.zw;
  gl_Position = u_matrix * vec4(a_pos * ${EXTENT}.0, 0.0, 1.0);
}`;

/** (strength sum, echo share), bilinearly filtered; the color mask routes frame a to rg, frame b to ba. */
const TILE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { vec2 vc = texture(u_tex, v_uv).rg; o = vec4(vc, vc); }`;

/**
 * Color both frames from the ramp and crossfade them. Strength is the mean
 * over echoes nearby (strength sum / echo share), so a small storm keeps its
 * color; the echo share only softens the edge. Where both frames have rain
 * the combined coverage stays constant (B over A), so nothing pulses
 * mid-fade. Output is premultiplied, as MapLibre blends.
 *
 * Gliding: with the rain's motion between the frames (radarFlow.ts), frame a
 * is carried forward and frame b back to the in-between moment, so the two
 * line up and storms slide along their paths while they fade.
 */
const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform sampler2D u_ramp;
uniform sampler2D u_flow;
uniform vec2 u_flowTexel;
uniform float u_f;
uniform float u_opacity;
in vec2 v_uv;
out vec4 o;
vec4 ramp(float v) { return texture(u_ramp, vec2((v * 255.0 + 0.5) / 256.0, 0.5)); }
vec4 frame(vec2 sc) {
  float share = sc.y;
  vec4 c = ramp(sc.x / max(share, 1e-4));
  c.a *= smoothstep(0.06, 0.38, share);
  return c;
}
void main() {
  vec4 m = texture(u_flow, v_uv);
  vec2 d = m.xy / max(m.z, 0.05) * u_flowTexel;
  vec4 ca = frame(texture(u_field, v_uv - u_f * d).rg);
  vec4 cb = frame(texture(u_field, v_uv + (1.0 - u_f) * d).ba);
  float A = ca.a * (1.0 - u_f);
  float T = mix(ca.a, cb.a, u_f);
  float B = A > 0.999 ? 0.0 : clamp((T - A) / (1.0 - A), 0.0, 1.0);
  o = vec4(cb.rgb * B + ca.rgb * A * (1.0 - B), B + A * (1.0 - B)) * u_opacity;
}`;

interface Gl {
  quad: WebGLVertexArrayObject;
  decode: Program;
  tile: Program;
  blur: Program;
  composite: Program;
  /** Color → value lookups, one per tile palette, built when first needed. */
  luts: Partial<Record<TilePalette, WebGLTexture>>;
  ramp: WebGLTexture;
  scratch: WebGLTexture;
  fbo: WebGLFramebuffer;
  field: [WebGLTexture, WebGLTexture];
  /** Half-float smoothing buffers where the GPU can render to them (exact averages), else 8-bit. */
  fieldFloat: boolean;
  fieldW: number;
  fieldH: number;
}

/**
 * The radar, drawn by hand so it can be smoothed. Every frame (MRMS now and
 * the last 2 hours, the IEM archive before, the HRRR forecast after) is a
 * tile set painted with a known palette, so each tile is decoded back to
 * reflectivity, filtered and blurred at screen resolution (smooth shapes
 * instead of square data cells), and recolored with a TV-style ramp that
 * leaves out the faint "clear air" returns. Frames load ahead, glide into
 * each other during playback (the rain moves along its tracked motion while
 * they crossfade), and report when every tile in view has arrived.
 */
export class RadarLayer implements CustomLayerInterface {
  readonly id = 'radar';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private res: Gl | null = null;
  private tiles = new Map<string, TileEntry>();
  private toDecode: string[] = [];
  private inflight = 0;
  private clock = 0;
  /** Tile keys to load, most urgent first, and their frame templates. */
  private want: string[] = [];
  private wantSet = new Set<string>();
  private planKey = '';
  private shown: string[] = [];
  private ahead: string[] = [];
  private last: [number, number, number] = [0, 0, 0];
  private rampDirty = true;
  private product: RadarProduct = 'reflectivity';
  private moveTimer = 0;
  /** Frame → the frame it replaced, drawn wherever its own tiles haven't arrived. */
  private standIns = new Map<string, string>();
  /** The rain's motion between the two frames on screen (gliding playback). */
  private readonly flow = new RadarFlow();
  private flowKey = '';
  private flowReady = false;
  private flowOn = false;
  /** Tiles of the frames on screen decoded so far: the flow is redone when they change the picture. */
  private shownDecodes = 0;

  constructor(
    private readonly map: MlMap,
    private timeline: Timeline,
    private mode: ColorMode,
    private radarOn: boolean,
  ) {
    map.on('move', () => {
      // Re-plan while panning (throttled), so tiles stream in mid-gesture.
      if (this.moveTimer) return;
      this.moveTimer = window.setTimeout(() => {
        this.moveTimer = 0;
        this.replan(true);
      }, 250);
    });
    map.on('moveend', () => this.replan(true));
  }

  /** Add below the basemap labels. */
  install(): void {
    const firstSymbol = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    this.map.addLayer(this, firstSymbol);
  }

  setTimeline(t: Timeline): void {
    const product: RadarProduct = t.site?.product === 'N0S' ? 'velocity' : 'reflectivity';
    if (product !== this.product) {
      // Velocity and reflectivity are colored differently: no stand-ins across the switch.
      this.product = product;
      this.rampDirty = true;
      this.timeline = t;
      this.standIns.clear();
      this.replan(true);
      this.map.triggerRepaint();
      return;
    }
    // A new scan (or HRRR run) renames the frames on screen. Until the new
    // tiles arrive, the old ones stand in, so the radar never blinks out.
    const [a, b] = this.last;
    const before = [this.frameAt(a), this.frameAt(b)];
    this.timeline = t;
    const after = [this.frameAt(a), this.frameAt(b)];
    if (this.standIns.size > 8) this.standIns.clear();
    after.forEach((f, i) => {
      if (f !== before[i]) this.standIns.set(f, this.standIns.get(before[i]) ?? before[i]);
    });
  }

  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    this.rampDirty = true;
    this.map.triggerRepaint();
  }

  setRadarOn(on: boolean): void {
    this.radarOn = on;
    if (on) this.replan(true);
    this.map.triggerRepaint();
  }

  /* ---------- the timeline's view of the radar (TimelineBar's Frames) ---------- */

  /** Every tile in view for the frame at `offset` has arrived (or failed). */
  ready(offset: number): boolean {
    // Radar off: nothing to wait for (the timeline still drives wind and the weather map).
    if (!this.radarOn) return true;
    const frame = this.frameAt(offset);
    const c = this.cover();
    for (let x = c.x0; x <= c.x1; x++) {
      for (let y = c.y0; y <= c.y1; y++) {
        const t = this.tiles.get(tileKey(frame, c.z, x, y));
        if (!t || (t.state !== 'ready' && t.state !== 'failed')) return false;
      }
    }
    return true;
  }

  /** Start loading the next `count` frames from `offset`. */
  prefetch(offset: number, direction: 1 | -1, count: number): void {
    const ahead: string[] = [];
    for (let k = 0; k < count; k++) {
      const o = offset + k * 0.25 * direction;
      if (o < this.timeline.minOffset || o > this.timeline.maxOffset) break;
      ahead.push(this.frameAt(o));
    }
    this.ahead = ahead;
    this.replan(false);
  }

  /** Show frame `a` fading into frame `b` (f = 0…1). */
  blend(a: number, b: number, f: number): void {
    this.last = [a, b, f];
    const shown = [this.frameAt(a)];
    if (f > 0 && b <= this.timeline.maxOffset) shown.push(this.frameAt(b));
    this.shown = shown;
    this.replan(false);
    this.map.triggerRepaint();
  }

  private frameAt(offset: number): string {
    return frameSource(this.timeline, offset).url;
  }

  private sourceAt(offset: number): FrameSource {
    return frameSource(this.timeline, offset);
  }

  /* ---------- loading ---------- */

  private cover(): Cover {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.round(this.map.getZoom())));
    const el = this.map.getContainer();
    const nw = this.map.unproject([0, 0]);
    const se = this.map.unproject([el.clientWidth, el.clientHeight]);
    const n = 2 ** z;
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
    return { z, x0: clamp(lonToX(nw.lng)), x1: clamp(lonToX(se.lng)), y0: clamp(latToY(nw.lat)), y1: clamp(latToY(se.lat)) };
  }

  /** Rebuild the load list: frames on screen first, then the ones ahead, tiles nearest the center first. */
  private replan(force: boolean): void {
    if (!this.radarOn) return;
    const frames = [...new Set([...this.shown, ...this.ahead])];
    const c = this.cover();
    const key = `${frames.join(' ')}#${c.z}/${c.x0}/${c.x1}/${c.y0}/${c.y1}`;
    if (!force && key === this.planKey) return;
    this.planKey = key;
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    const cells: [number, number][] = [];
    for (let x = c.x0; x <= c.x1; x++) for (let y = c.y0; y <= c.y1; y++) cells.push([x, y]);
    cells.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
    this.want = frames.flatMap((f) => cells.map(([x, y]) => tileKey(f, c.z, x, y)));
    this.wantSet = new Set(this.want);
    this.pump();
  }

  private pump(): void {
    const now = performance.now();
    for (const key of this.want) {
      if (this.inflight >= MAX_INFLIGHT) break;
      const t = this.tiles.get(key);
      if (t && !(t.state === 'failed' && now - t.failedAt > RETRY_MS)) {
        t.used = ++this.clock;
        continue;
      }
      this.load(key);
    }
  }

  private load(key: string): void {
    const [frame, zxy] = key.split('|');
    const [z, x, y] = zxy.split('/').map(Number);
    const url = tileMirrors(frame)[(x + y) % 4]
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
      .replace('{bbox-epsg-3857}', tileBbox(z, x, y));
    const entry: TileEntry = { state: 'loading', img: new Image(), tex: null, used: ++this.clock, failedAt: 0 };
    this.tiles.set(key, entry);
    this.inflight++;
    const img = entry.img!;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.inflight--;
      entry.state = 'decode';
      this.toDecode.push(key);
      this.map.triggerRepaint();
      this.pump();
    };
    img.onerror = () => {
      this.inflight--;
      entry.state = 'failed';
      entry.img = null;
      entry.failedAt = performance.now();
      this.map.triggerRepaint();
      this.pump();
      window.setTimeout(() => this.pump(), RETRY_MS + 100);
    };
    img.src = url;
  }

  /* ---------- GPU ---------- */

  onAdd(_map: MlMap, gl: WebGL2RenderingContext): void {
    // GL objects are created in the first prerender: MapLibre resets its
    // state cache around render callbacks, not around onAdd.
    this.gl = gl;
  }

  onRemove(): void {
    const gl = this.gl;
    const r = this.res;
    if (!gl || !r) return;
    for (const t of this.tiles.values()) if (t.tex) gl.deleteTexture(t.tex);
    for (const tex of [...Object.values(r.luts), r.ramp, r.scratch, ...r.field]) gl.deleteTexture(tex);
    gl.deleteFramebuffer(r.fbo);
    gl.deleteVertexArray(r.quad);
    for (const p of [r.decode, r.tile, r.blur, r.composite]) gl.deleteProgram(p.prog);
    this.flow.dispose(gl);
    this.tiles.clear();
    this.res = null;
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
      decode: compile(gl, QUAD_VS, DECODE_FS, ['u_src', 'u_lut']),
      tile: compile(gl, TILE_VS, TILE_FS, ['u_matrix', 'u_uv', 'u_tex']),
      blur: compile(gl, QUAD_VS, GAUSS9_FS, ['u_tex', 'u_step']),
      composite: compile(gl, QUAD_VS, COMPOSITE_FS, ['u_field', 'u_ramp', 'u_flow', 'u_flowTexel', 'u_f', 'u_opacity']),
      luts: {},
      ramp: texture2d(gl, gl.LINEAR),
      scratch: texture2d(gl, gl.NEAREST),
      fbo: gl.createFramebuffer()!,
      field: [texture2d(gl, gl.LINEAR), texture2d(gl, gl.LINEAR)],
      fieldFloat: !!gl.getExtension('EXT_color_buffer_float'),
      fieldW: 0,
      fieldH: 0,
    };
  }

  private target(gl: WebGL2RenderingContext, r: Gl, tex: WebGLTexture, w: number, h: number): void {
    target(gl, r.fbo, tex, w, h);
  }

  /** The color → value lookup for a tile palette (a 128³ volume, built on first use). */
  private lut(gl: WebGL2RenderingContext, r: Gl, palette: TilePalette): WebGLTexture {
    const have = r.luts[palette];
    if (have) return have;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // 3-D uploads from arrays require flip and premultiply off.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const data = palette === 'mrms' ? buildMrmsLut() : palette === 'velocity' ? buildVelocityLut() : buildLut();
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    r.luts[palette] = tex;
    return tex;
  }

  /** Arrived images → reflectivity textures (R8, filtered), each read with its own palette. */
  private decodeArrivals(gl: WebGL2RenderingContext, r: Gl): void {
    let n = 0;
    while (this.toDecode.length && n < DECODES_PER_FRAME) {
      const key = this.toDecode.shift()!;
      const t = this.tiles.get(key);
      if (!t || t.state !== 'decode' || !t.img) continue;
      n++;
      const frame = key.slice(0, key.indexOf('|'));
      gl.activeTexture(gl.TEXTURE1);
      const lut = this.lut(gl, r, tilePalette(frame));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.scratch);
      // Exact palette colors: no color management, no premultiplication.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, t.img);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      const w = t.img.naturalWidth;
      const h = t.img.naturalHeight;

      const tex = texture2d(gl, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, null);
      this.target(gl, r, tex, w, h);
      gl.useProgram(r.decode.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.scratch);
      gl.uniform1i(r.decode.u.u_src, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lut);
      gl.uniform1i(r.decode.u.u_lut, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);

      t.tex = tex;
      t.img = null;
      t.state = 'ready';
      if (this.shown.includes(frame)) this.shownDecodes++;
    }
    if (this.toDecode.length) this.map.triggerRepaint();
  }

  private evict(gl: WebGL2RenderingContext): void {
    if (this.tiles.size <= MAX_TILES) return;
    const old = [...this.tiles.entries()]
      .filter(([k, t]) => t.state !== 'loading' && t.state !== 'decode' && !this.wantSet.has(k))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old) {
      if (this.tiles.size <= MAX_TILES * 0.85) break;
      if (t.tex) gl.deleteTexture(t.tex);
      this.tiles.delete(k);
    }
  }

  private resizeField(gl: WebGL2RenderingContext, r: Gl): number {
    const el = this.map.getContainer();
    const w = el.clientWidth;
    const h = el.clientHeight;
    const s = Math.min(1, Math.sqrt(MAX_FIELD_PX / Math.max(1, w * h)));
    const fw = Math.max(1, Math.round(w * s));
    const fh = Math.max(1, Math.round(h * s));
    if (fw !== r.fieldW || fh !== r.fieldH) {
      for (const tex of r.field) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (r.fieldFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      r.fieldW = fw;
      r.fieldH = fh;
    }
    return s;
  }

  /** Draw one frame's tiles into the field (into the bound color channel). */
  private drawFrame(gl: WebGL2RenderingContext, r: Gl, args: CustomRenderMethodInput, frame: string, c: Cover): void {
    const draw = (z: number, x: number, y: number, tex: WebGLTexture, uv: [number, number, number, number]) => {
      const m = args.getProjectionData({ tileID: { canonical: { z, x, y }, wrap: 0 }, applyGlobeMatrix: false });
      gl.uniformMatrix4fv(r.tile.u.u_matrix, false, m.mainMatrix as Float32Array);
      gl.uniform4f(r.tile.u.u_uv, ...uv);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    for (let x = c.x0; x <= c.x1; x++) {
      for (let y = c.y0; y <= c.y1; y++) {
        const t = this.tiles.get(tileKey(frame, c.z, x, y));
        if (t?.state === 'ready' && t.tex) {
          t.used = ++this.clock;
          draw(c.z, x, y, t.tex, [0, 0, 1, 1]);
          continue;
        }
        const standIn = this.standIns.get(frame);
        const sub = standIn ? this.tiles.get(tileKey(standIn, c.z, x, y)) : undefined;
        if (sub?.state === 'ready' && sub.tex) {
          sub.used = ++this.clock;
          draw(c.z, x, y, sub.tex, [0, 0, 1, 1]);
          continue;
        }
        // Not here yet (zooming, panning): stretch a coarser tile over the gap…
        for (let dz = 1; dz <= 3 && c.z - dz >= 0; dz++) {
          const ax = x >> dz;
          const ay = y >> dz;
          const a = this.tiles.get(tileKey(frame, c.z - dz, ax, ay));
          if (a?.state === 'ready' && a.tex) {
            const s = 1 / (1 << dz);
            draw(c.z, x, y, a.tex, [(x - (ax << dz)) * s, (y - (ay << dz)) * s, s, s]);
            break;
          }
        }
        // …and lay finer ones from before a zoom-out over it.
        for (let k = 0; k < 4; k++) {
          const cx = x * 2 + (k & 1);
          const cy = y * 2 + (k >> 1);
          const ch = this.tiles.get(tileKey(frame, c.z + 1, cx, cy));
          if (ch?.state === 'ready' && ch.tex) draw(c.z + 1, cx, cy, ch.tex, [0, 0, 1, 1]);
        }
      }
    }
  }

  prerender(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    if (!this.radarOn) return;
    const r = (this.res ??= this.init(gl));
    gl.bindVertexArray(r.quad);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);

    const velocity = this.product === 'velocity';
    if (this.rampDirty) {
      gl.bindTexture(gl.TEXTURE_2D, r.ramp);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, velocity ? buildVelocityRamp() : buildRamp(this.mode));
      this.rampDirty = false;
    }
    this.decodeArrivals(gl, r);
    this.evict(gl);

    // 1. Both frames into the field as (strength sum, echo share): frame a → rg, frame b → ba.
    const s = this.resizeField(gl, r);
    const c = this.cover();
    const [a, b, f] = this.last;
    const both = f > 0 && b <= this.timeline.maxOffset;
    this.target(gl, r, r.field[0], r.fieldW, r.fieldH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.tile.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(r.tile.u.u_tex, 0);
    gl.colorMask(true, true, false, false);
    this.drawFrame(gl, r, args, this.frameAt(a), c);
    if (both) {
      gl.colorMask(false, false, true, true);
      this.drawFrame(gl, r, args, this.frameAt(b), c);
    }
    gl.colorMask(true, true, true, true);

    // 2. Blur, horizontal then vertical. Wider when zoomed past the data's resolution.
    // Velocity is smoothed lightly: blurring would average a rotation couplet's inbound and outbound away.
    const texelCss = 2 * 2 ** (this.map.getZoom() - c.z);
    const sigma = velocity ? Math.max(1, 0.45 * texelCss) * s : Math.max(BLUR_PX, BLUR_PER_TEXEL * texelCss) * s;
    const spacing = sigma / 1.75;
    gl.useProgram(r.blur.prog);
    gl.uniform1i(r.blur.u.u_tex, 0);
    this.target(gl, r, r.field[1], r.fieldW, r.fieldH);
    gl.bindTexture(gl.TEXTURE_2D, r.field[0]);
    gl.uniform2f(r.blur.u.u_step, spacing / r.fieldW, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.target(gl, r, r.field[0], r.fieldW, r.fieldH);
    gl.bindTexture(gl.TEXTURE_2D, r.field[1]);
    gl.uniform2f(r.blur.u.u_step, 0, spacing / r.fieldH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. Gliding: where the rain moves from frame a to frame b, redone when the pair, the view, or
    // their tiles change. Not for velocity (a couplet's two halves would be dragged apart).
    this.flowOn = false;
    if (both && !velocity && r.fieldFloat) {
      const fa = this.sourceAt(a);
      const fb = this.sourceAt(b);
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();
      const key = `${fa.url} ${fb.url} ${r.fieldW}x${r.fieldH} ${center.lng.toFixed(5)},${center.lat.toFixed(5)},${zoom.toFixed(4)} ${this.shownDecodes}`;
      if (key === this.flowKey) {
        this.flowOn = this.flowReady;
      } else {
        this.flowKey = key;
        this.flowOn = this.flowReady = this.flow.compute(gl, {
          field: r.field[0],
          fieldW: r.fieldW,
          fieldH: r.fieldH,
          pxKm: pixelKm(center.lat, zoom) / s,
          minutes: (fb.at - fa.at) / 60_000,
        });
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  render(gl: WebGL2RenderingContext): void {
    const r = this.res;
    if (!this.radarOn || !r || !r.fieldW) return;
    const [, b, f] = this.last;
    gl.bindVertexArray(r.quad);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(r.composite.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.field[0]);
    gl.uniform1i(r.composite.u.u_field, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.ramp);
    gl.uniform1i(r.composite.u.u_ramp, 1);
    const flow = this.flowOn ? this.flow.result : null;
    const [fw, fh] = this.flow.size;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, flow ?? this.flow.zero(gl));
    gl.uniform1i(r.composite.u.u_flow, 2);
    gl.uniform2f(r.composite.u.u_flowTexel, flow ? 1 / fw : 0, flow ? 1 / fh : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(r.composite.u.u_f, b <= this.timeline.maxOffset ? f : 0);
    gl.uniform1f(r.composite.u.u_opacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
