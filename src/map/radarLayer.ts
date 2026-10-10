import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { ColorMode } from '../config';
import { frameSource, framesBetween, STEP_H, tileMirrors, tilePalette, type FrameSource, type TilePalette, type Timeline } from '../data/timeline';
import { compile, GAUSS9_FS, QUAD_VS, target, texture2d, type Program } from './gl';
import { RadarFlow } from './radarFlow';
import { COVERAGE_SIZE, RadarCoverage } from './radarCoverage';
import { buildLut, buildMrmsLut, buildPtypeLut, buildSatLut, buildTypeRamps, buildVelocityLut, buildVelocityRamp, LUT_BITS, LUT_SIZE } from './radarPalette';

/** What the tiles on screen are: reflectivity (composite, site N0B, HRRR) or a site's storm-relative velocity. */
export type RadarProduct = 'reflectivity' | 'velocity';

/** Tile zooms requested: MRMS is ~1 km (z7), one radar's own scans finer, the satellite estimate ~4 km. */
const MIN_Z = 3;
const MAX_Z = 7;
const SITE_MAX_Z = 8;
const SAT_MAX_Z = 6;
/** Precipitation type comes from the HRRR (3 km): coarse tiles are plenty. */
const PTYPE_MAX_Z = 6;
/** How far a type spreads past the model's own precipitation, km (its rain and the radar's rarely line up exactly). */
const PTYPE_SPREAD_KM = 12;
/** MapLibre's in-tile coordinate range. */
const EXTENT = 8192;
/** Decoded tiles kept on the GPU (128 KB each: strength and echo): enough for the opening loop with its 5-minute frames. */
const MAX_TILES = 400;
const MAX_INFLIGHT = 20;
/** Failed tiles (e.g. a 503) are retried after this long, ms. */
const RETRY_MS = 30_000;
/** Images decoded per map frame, so a burst of arrivals doesn't hitch a frame. */
const DECODES_PER_FRAME = 6;
/** Cap on the smoothing buffer's size, pixels. */
const MAX_FIELD_PX = 1_200_000;
/**
 * Smoothing radius (Gaussian sigma), CSS pixels, and its share of a tile pixel when zoomed past the data.
 * Light, with tiles a zoom finer than the map: smooth edges that keep a storm's fine structure.
 */
const BLUR_PX = 1.6;
const BLUR_PER_TEXEL = 0.75;
/**
 * The first hours of the forecast start from the radar now, carried along its tracked motion, then hand
 * off to the model (from NOWCAST_HANDOFF_H to NOWCAST_H), so playback doesn't jump from what the radar
 * sees to what the model drew when it crosses "now".
 */
const NOWCAST_HANDOFF_H = 0.75;
const NOWCAST_H = 1.75;

let velocityRamp: Uint8Array | null = null;
const buildVelocityRampCached = () => (velocityRamp ??= buildVelocityRamp());

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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

/**
 * Precip-type tile colors → (snow, ice, mix, any precipitation): one-hot
 * by type where the model has precipitation, so blurring gives each type's
 * share nearby (and its total, the 4th channel).
 */
const DECODE_TYPE_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_src;
uniform sampler3D u_lut;
out vec4 o;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  if (c.a < 0.5) { o = vec4(0.0); return; }
  ivec3 q = ivec3(c.rgb * 255.0 + 0.5) >> ${8 - LUT_BITS};
  int code = int(texelFetch(u_lut, q, 0).r * 255.0 + 0.5);
  o = code == 0 ? vec4(0.0) : vec4(code == 2 ? 1.0 : 0.0, code == 3 ? 1.0 : 0.0, code == 4 ? 1.0 : 0.0, 1.0);
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

/** A type tile as it is (snow, ice, mix, precipitation). */
const TYPE_TILE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_tex, v_uv); }`;

/** (strength sum, echo share), bilinearly filtered; the color mask routes frame a to rg, frame b to ba. */
const TILE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { vec2 vc = texture(u_tex, v_uv).rg; o = vec4(vc, vc); }`;

/**
 * Color the frames from the ramp. Strength is the mean over echoes nearby
 * (strength sum / echo share), so a small storm keeps its color; the echo
 * share only softens the edge. Output is premultiplied, as MapLibre blends.
 *
 * Between two frames, reflectivity is mixed as amounts (strength, echo)
 * and colored once: rain in both stays solid and shifts color smoothly, and
 * an edge moves to its new place instead of one picture fading through the
 * other (no washed-out, half-clear moment at every frame). Velocity keeps a
 * color crossfade (B over A): averaging inbound and outbound would gray a
 * couplet out mid-fade.
 *
 * Gliding: with the rain's motion between the frames (radarFlow.ts), frame a
 * is carried forward and frame b back to the in-between moment, so the two
 * line up and storms slide along their paths while they change.
 */
const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform sampler2D u_ramp;
uniform sampler2D u_flow;
uniform vec2 u_flowTexel;
uniform float u_f;
uniform float u_opacity;
uniform sampler2D u_now;
uniform sampler2D u_nowFlow;
uniform vec2 u_nowFlowTexel;
uniform float u_nowK;
uniform float u_nowW;
uniform sampler2D u_typeA;
uniform sampler2D u_typeB;
uniform float u_types;
uniform float u_mixAmounts;
in vec2 v_uv;
out vec4 o;
// The ramps: rows rain, snow, ice, mix.
vec4 ramp(float v, float row) { return texture(u_ramp, vec2((v * 255.0 + 0.5) / 256.0, (row + 0.5) / 4.0)); }
vec4 frame(vec2 sc, vec4 ty) {
  float share = sc.y;
  float v = sc.x / max(share, 1e-4);
  vec4 c = ramp(v, 0.0);
  if (u_types > 0.5 && ty.a > 0.005) {
    // Each type's share of the model's precipitation nearby; rain where it has none.
    vec3 w = ty.rgb / ty.a * smoothstep(0.005, 0.08, ty.a);
    float rain = max(0.0, 1.0 - w.x - w.y - w.z);
    c = c * rain + ramp(v, 1.0) * w.x + ramp(v, 2.0) * w.y + ramp(v, 3.0) * w.z;
  }
  c.a *= smoothstep(0.2, 0.45, share);
  return c;
}
void main() {
  vec4 m = texture(u_flow, v_uv);
  vec2 d = m.xy / max(m.z, 0.05) * u_flowTexel;
  vec2 ua = v_uv - u_f * d;
  vec2 ub = v_uv + (1.0 - u_f) * d;
  vec2 sa = texture(u_field, ua).rg;
  vec2 sb = texture(u_field, ub).ba;
  // The first hours ahead: the radar now, moved along its motion, handing off to the model (u_nowW = the
  // model's share). Mixed as (strength, echo) before coloring, so both stay solid while they trade places.
  if (u_nowW < 0.999) {
    vec4 mn = texture(u_nowFlow, v_uv);
    vec2 dn = mn.xy / max(mn.z, 0.05) * u_nowFlowTexel;
    vec2 sn = texture(u_now, v_uv - u_nowK * dn).rg;
    sa = mix(sn, sa, u_nowW);
    sb = mix(sn, sb, u_nowW);
  }
  vec4 ta = texture(u_typeA, ua);
  vec4 tb = texture(u_typeB, ub);
  if (u_mixAmounts > 0.5) {
    vec4 c = frame(mix(sa, sb, u_f), mix(ta, tb, u_f));
    o = vec4(c.rgb * c.a, c.a) * u_opacity;
    return;
  }
  vec4 ca = frame(sa, ta);
  vec4 cb = frame(sb, tb);
  float A = ca.a * (1.0 - u_f);
  float T = mix(ca.a, cb.a, u_f);
  float B = A > 0.999 ? 0.0 : clamp((T - A) / (1.0 - A), 0.0, 1.0);
  vec4 res = vec4(cb.rgb * B + ca.rgb * A * (1.0 - B), B + A * (1.0 - B));
  o = res * u_opacity;
}`;

/** Keep one frame of the field (its ba pair) as rg: the radar now, for the nowcast. */
const COPY_BA_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 o;
void main() { o = vec4(texture(u_src, v_uv).ba, 0.0, 1.0); }`;

/**
 * Satellite rain into the radar field, frame by frame, only where no radar
 * reaches (coverage r = 0) and never over an echo the radar has, so the
 * radar always wins where it can see.
 */
const MERGE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_radar;
uniform sampler2D u_sat;
uniform sampler2D u_cov;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 r = texture(u_radar, v_uv);
  vec4 s = texture(u_sat, v_uv);
  float open = 1.0 - texture(u_cov, v_uv).r;
  float wa = open * (1.0 - smoothstep(0.05, 0.5, r.g));
  float wb = open * (1.0 - smoothstep(0.05, 0.5, r.a));
  o = r + vec4(s.rg * wa, s.ba * wb);
}`;

interface Gl {
  quad: WebGLVertexArrayObject;
  decode: Program;
  tile: Program;
  blur: Program;
  composite: Program;
  merge: Program;
  copyBa: Program;
  decodeType: Program;
  typeTile: Program;
  /** What's falling, for the two frames on screen (snow, ice, mix, precipitation), half size, smoothed. */
  type: [WebGLTexture, WebGLTexture];
  typeTmp: WebGLTexture;
  /** The radar now, smoothed (strength sum, echo share), for the nowcast. */
  now: WebGLTexture;
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
  /** Which field holds the finished picture this frame. */
  out: 0 | 1;
  /** Satellite rain and the radars' coverage, at half the field's size (both are coarse). */
  sat: WebGLTexture;
  satTmp: WebGLTexture;
  cov: WebGLTexture;
  satW: number;
  satH: number;
  /** The coverage grid on the GPU, and the grid version it holds. */
  covGrid: WebGLTexture;
  covVersion: number;
}

/**
 * The radar, drawn by hand so it can be smoothed. Every frame (MRMS now and
 * the last 2 hours, the IEM archive before, the HRRR forecast after) is a tile set painted with
 * a known palette, so each tile is decoded back to reflectivity, filtered
 * and blurred at screen resolution (smooth shapes instead of square data
 * cells), and recolored with a TV-style ramp that leaves out the faint
 * "clear air" returns. Past radar range (a hurricane far offshore) the
 * satellite rain estimate fills in. Frames load ahead, glide into each other
 * during playback (the rain moves along its tracked motion while they
 * crossfade), and report when every tile in view has arrived.
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
  private shown: FrameSource[] = [];
  private ahead: FrameSource[] = [];
  /** Where the radars reach; the satellite fills the rest. */
  private readonly coverage = new RadarCoverage();
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
  /** The nowcast: the radar's motion over its last two frames, and how far along it to carry "now". */
  private readonly nowFlow = new RadarFlow();
  private nowKey = '';
  private nowFlowReady = false;
  private nowPairH = STEP_H;
  private nowcast: { k: number; w: number } | null = null;
  private aheadOffsets: number[] = [];
  private precipType = true;
  /** The frames drawn this map frame and how far from the first to the second (5-minute frames inside the MRMS window). */
  private drawF = 0;
  /** Bumped when a setting changes what the field holds, so a cached build is redone. */
  private epoch = 0;
  /** How often each frame's tiles have changed (decoded, dropped): a cached build of that frame is redone. */
  private versions = new Map<string, number>();
  /** What the field and the type textures were last built from: unchanged, the build is skipped. */
  private fieldKey = '';
  private typesKey = '';

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
      this.epoch++;
      this.standIns.clear();
      this.replan(true);
      this.map.triggerRepaint();
      return;
    }
    // A new scan (or HRRR run) renames the frames on screen. Until the new
    // tiles arrive, the old ones stand in, so the radar never blinks out.
    const [a, b] = this.last;
    const names = () =>
      [a, b].flatMap((o) => {
        const src = this.sourceAt(o);
        return [src.url, src.sat];
      });
    const before = names();
    this.timeline = t;
    this.epoch++;
    const after = names();
    if (this.standIns.size > 12) this.standIns.clear();
    after.forEach((f, i) => {
      const was = before[i];
      if (f && was && f !== was) this.standIns.set(f, this.standIns.get(was) ?? was);
    });
  }

  /** The radar towers (their reach decides where satellite rain fills in). */
  setSites(sites: readonly { lon: number; lat: number }[]): void {
    this.coverage.setSites(sites);
    this.epoch++;
    this.replan(true);
    this.map.triggerRepaint();
  }

  /** Color rain, snow, mix, and ice apart. */
  setPrecipType(on: boolean): void {
    this.precipType = on;
    this.epoch++;
    this.replan(true);
    this.map.triggerRepaint();
  }

  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    this.rampDirty = true;
    this.epoch++;
    this.replan(true);
    this.map.triggerRepaint();
  }

  setRadarOn(on: boolean): void {
    this.radarOn = on;
    this.epoch++;
    if (on) this.replan(true);
    this.map.triggerRepaint();
  }

  /* ---------- the timeline's view of the radar (TimelineBar's Frames) ---------- */

  /** Every tile in view for the frame at `offset` has arrived (or failed). */
  ready(offset: number): boolean {
    // Radar off: nothing to wait for (the timeline still drives wind and the weather map).
    if (!this.radarOn) return true;
    if (this.inNowcast(offset) && !this.nowSources().every((f) => this.sourceArrived(f))) return false;
    const src = this.sourceAt(offset);
    if (!this.sourceArrived(src)) return false;
    // Playback reaches a frame through the 5-minute frames before it (the MRMS window).
    const before = offset - STEP_H;
    return before < this.timeline.minOffset || framesBetween(this.timeline, this.sourceAt(before), src).every((f) => this.sourceArrived(f));
  }

  private sourceArrived(src: FrameSource): boolean {
    if (!this.arrived(src.url, this.cover(), false)) return false;
    if (src.sat && this.satOn() && !this.arrived(src.sat, this.cover(SAT_MAX_Z), true)) return false;
    return !src.ptype || !this.typesOn() || this.arrived(src.ptype, this.cover(PTYPE_MAX_Z), false);
  }

  /** A moment (hours from now) inside the nowcast's reach. */
  private inNowcast(t: number): boolean {
    return t > 1e-6 && t < NOWCAST_H && this.product === 'reflectivity' && !this.timeline.site && this.timeline.maxOffset > 0;
  }

  /** The two newest observed frames, which the nowcast starts from. */
  private nowSources(): FrameSource[] {
    return [this.sourceAt(-STEP_H), this.sourceAt(0)];
  }

  /** The playhead, hours from now (continuous while fading). */
  private playhead(): number {
    const [a, b, f] = this.last;
    return f > 0 && b <= this.timeline.maxOffset ? a + f * (b - a) : a;
  }

  /** Every tile of `frame` in cover `c` has arrived or failed (satellite: only tiles past radar range). */
  private arrived(frame: string, c: Cover, sat: boolean): boolean {
    for (let x = c.x0; x <= c.x1; x++) {
      for (let y = c.y0; y <= c.y1; y++) {
        if (sat && !this.coverage.open(c.z, x, y)) continue;
        const t = this.tiles.get(tileKey(frame, c.z, x, y));
        if (!t || (t.state !== 'ready' && t.state !== 'failed')) return false;
      }
    }
    return true;
  }

  private bump(frame: string): void {
    if (this.versions.size > 4000) {
      this.versions.clear();
      this.epoch++;
    }
    this.versions.set(frame, (this.versions.get(frame) ?? 0) + 1);
  }

  /** A frame's version, with the one standing in for it while its own tiles load. */
  private version(frame: string | null | undefined): string {
    if (!frame) return '-';
    const standIn = this.standIns.get(frame);
    return `${this.versions.get(frame) ?? 0}.${standIn ? (this.versions.get(standIn) ?? 0) : ''}`;
  }

  /** Precipitation type colors apply: switched on, reflectivity, in Color. */
  private typesOn(): boolean {
    return this.precipType && this.product === 'reflectivity' && this.mode === 'color';
  }

  /** Satellite fill applies: the radar list is known and the radar shows reflectivity. */
  private satOn(): boolean {
    return this.coverage.ready && this.product === 'reflectivity';
  }

  /** Start loading the next `count` frames from `offset`. */
  prefetch(offset: number, direction: 1 | -1, count: number): void {
    const ahead: FrameSource[] = [];
    const offsets: number[] = [];
    // From the frame before: playback reaches the first one through the 5-minute frames leading into it.
    const before = offset - STEP_H * direction;
    let prev: FrameSource | null = before >= this.timeline.minOffset && before <= this.timeline.maxOffset ? this.sourceAt(before) : null;
    for (let k = 0; k < count; k++) {
      const o = offset + k * STEP_H * direction;
      if (o < this.timeline.minOffset || o > this.timeline.maxOffset) break;
      const src = this.sourceAt(o);
      if (prev) {
        const subs = direction > 0 ? framesBetween(this.timeline, prev, src) : framesBetween(this.timeline, src, prev).reverse();
        ahead.push(...subs);
      }
      ahead.push(src);
      offsets.push(o);
      prev = src;
    }
    this.ahead = ahead;
    this.aheadOffsets = offsets;
    this.replan(false);
  }

  /** Show frame `a` fading into frame `b` (f = 0…1). */
  blend(a: number, b: number, f: number): void {
    this.last = [a, b, f];
    const d = this.drawn();
    this.shown = d.fb ? [d.fa, d.fb] : [d.fa];
    this.replan(false);
    this.map.triggerRepaint();
  }

  /**
   * The two frames to draw for the playhead and how far between them: the timeline's pair, or inside the
   * MRMS window the real 5-minute frames on either side of the moment.
   */
  private drawn(): { fa: FrameSource; fb: FrameSource | null; f: number } {
    const [a, b, f] = this.last;
    const fa = this.sourceAt(a);
    if (!(f > 0 && b <= this.timeline.maxOffset)) return { fa, fb: null, f: 0 };
    const fb = this.sourceAt(b);
    const subs = framesBetween(this.timeline, fa, fb);
    if (!subs.length) return { fa, fb, f };
    const chain = [fa, ...subs, fb];
    const at = fa.at + f * (fb.at - fa.at);
    let i = 0;
    while (i < chain.length - 2 && chain[i + 1].at <= at) i++;
    const p = chain[i];
    const q = chain[i + 1];
    return { fa: p, fb: q, f: Math.max(0, Math.min(1, (at - p.at) / (q.at - p.at))) };
  }

  private sourceAt(offset: number): FrameSource {
    return frameSource(this.timeline, offset);
  }

  /* ---------- loading ---------- */

  /** The tiles in view, a zoom finer than the map once it's past the midpoint (crisper storms). */
  private cover(cap = this.timeline.site ? SITE_MAX_Z : MAX_Z): Cover {
    const z = Math.max(MIN_Z, Math.min(cap, Math.floor(this.map.getZoom() + 0.9)));
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
    const sources = [...this.shown, ...this.ahead];
    // The nowcast needs the newest two observed frames while its frames are on screen or coming.
    if (this.inNowcast(this.playhead()) || this.aheadOffsets.some((o) => this.inNowcast(o))) sources.push(...this.nowSources());
    const sat = this.satOn();
    const types = this.typesOn();
    const c = this.cover();
    const cs = this.cover(SAT_MAX_Z);
    const ct = this.cover(PTYPE_MAX_Z);
    const box = (k: Cover) => `${k.z}/${k.x0}/${k.x1}/${k.y0}/${k.y1}`;
    const key = `${sources.map((f) => `${f.url}+${sat ? f.sat : ''}+${types ? f.ptype : ''}`).join(' ')}#${box(c)}#${box(cs)}#${box(ct)}#${this.coverage.version}`;
    if (!force && key === this.planKey) return;
    this.planKey = key;
    const cells = (k: Cover) => {
      const cx = (k.x0 + k.x1) / 2;
      const cy = (k.y0 + k.y1) / 2;
      const out: [number, number][] = [];
      for (let x = k.x0; x <= k.x1; x++) for (let y = k.y0; y <= k.y1; y++) out.push([x, y]);
      return out.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
    };
    const radarCells = cells(c);
    // Satellite tiles only where some of the tile is past radar range.
    const satCells = sat ? cells(cs).filter(([x, y]) => this.coverage.open(cs.z, x, y)) : [];
    const typeCells = types ? cells(ct) : [];
    const want = new Set<string>();
    for (const f of sources) {
      for (const [x, y] of radarCells) want.add(tileKey(f.url, c.z, x, y));
      if (f.sat) for (const [x, y] of satCells) want.add(tileKey(f.sat, cs.z, x, y));
      if (f.ptype) for (const [x, y] of typeCells) want.add(tileKey(f.ptype, ct.z, x, y));
    }
    this.want = [...want];
    this.wantSet = want;
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
    for (const tex of [...Object.values(r.luts), r.ramp, r.scratch, ...r.field, r.sat, r.satTmp, r.cov, r.covGrid, r.now, ...r.type, r.typeTmp])
      gl.deleteTexture(tex);
    gl.deleteFramebuffer(r.fbo);
    gl.deleteVertexArray(r.quad);
    for (const p of [r.decode, r.tile, r.blur, r.composite, r.merge, r.copyBa, r.decodeType, r.typeTile]) gl.deleteProgram(p.prog);
    this.flow.dispose(gl);
    this.nowFlow.dispose(gl);
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
      composite: compile(gl, QUAD_VS, COMPOSITE_FS, [
        'u_field',
        'u_ramp',
        'u_flow',
        'u_flowTexel',
        'u_f',
        'u_opacity',
        'u_now',
        'u_nowFlow',
        'u_nowFlowTexel',
        'u_nowK',
        'u_nowW',
        'u_typeA',
        'u_typeB',
        'u_types',
        'u_mixAmounts',
      ]),
      merge: compile(gl, QUAD_VS, MERGE_FS, ['u_radar', 'u_sat', 'u_cov']),
      copyBa: compile(gl, QUAD_VS, COPY_BA_FS, ['u_src']),
      decodeType: compile(gl, QUAD_VS, DECODE_TYPE_FS, ['u_src', 'u_lut']),
      typeTile: compile(gl, TILE_VS, TYPE_TILE_FS, ['u_matrix', 'u_uv', 'u_tex']),
      type: [texture2d(gl, gl.LINEAR), texture2d(gl, gl.LINEAR)],
      typeTmp: texture2d(gl, gl.LINEAR),
      now: texture2d(gl, gl.LINEAR),
      luts: {},
      ramp: texture2d(gl, gl.LINEAR),
      scratch: texture2d(gl, gl.NEAREST),
      fbo: gl.createFramebuffer()!,
      field: [texture2d(gl, gl.LINEAR), texture2d(gl, gl.LINEAR)],
      fieldFloat: !!gl.getExtension('EXT_color_buffer_float'),
      fieldW: 0,
      fieldH: 0,
      out: 0,
      sat: texture2d(gl, gl.LINEAR),
      satTmp: texture2d(gl, gl.LINEAR),
      cov: texture2d(gl, gl.LINEAR),
      satW: 0,
      satH: 0,
      covGrid: texture2d(gl, gl.LINEAR),
      covVersion: -1,
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
    const data = { mrms: buildMrmsLut, sat: buildSatLut, velocity: buildVelocityLut, n0q: buildLut, ptype: buildPtypeLut }[palette]();
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

      const typed = tilePalette(frame) === 'ptype';
      const prog = typed ? r.decodeType : r.decode;
      const tex = texture2d(gl, gl.LINEAR);
      if (typed) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, null);
      this.target(gl, r, tex, w, h);
      gl.useProgram(prog.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.scratch);
      gl.uniform1i(prog.u.u_src, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lut);
      gl.uniform1i(prog.u.u_lut, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);

      t.tex = tex;
      t.img = null;
      t.state = 'ready';
      this.bump(frame);
      const watched = this.inNowcast(this.playhead()) ? [...this.shown, ...this.nowSources()] : this.shown;
      if (watched.some((f) => f.url === frame || f.sat === frame)) this.shownDecodes++;
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
      this.bump(k.slice(0, k.indexOf('|')));
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
      r.satW = Math.max(1, Math.round(fw / 2));
      r.satH = Math.max(1, Math.round(fh / 2));
      for (const tex of [r.sat, r.satTmp]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (r.fieldFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, r.satW, r.satH, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, r.satW, r.satH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      for (const tex of [r.cov, ...r.type, r.typeTmp]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, r.satW, r.satH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.bindTexture(gl.TEXTURE_2D, r.now);
      if (r.fieldFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, fw, fh, 0, gl.RG, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.nowKey = '';
    }
    return s;
  }

  /** A separable Gaussian over `tex` (w × h) through `tmp`, sigma in that texture's pixels. */
  private blurInPlace(gl: WebGL2RenderingContext, r: Gl, tex: WebGLTexture, tmp: WebGLTexture, w: number, h: number, sigma: number): void {
    const spacing = sigma / 1.75;
    gl.useProgram(r.blur.prog);
    gl.uniform1i(r.blur.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    this.target(gl, r, tmp, w, h);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(r.blur.u.u_step, spacing / w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.target(gl, r, tex, w, h);
    gl.bindTexture(gl.TEXTURE_2D, tmp);
    gl.uniform2f(r.blur.u.u_step, 0, spacing / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Satellite rain for the frames on screen, smoothed at its own (coarse) scale, then merged into the
   * radar field past the radars' reach: field[0] (radar) + satellite → field[1]. False if there's none.
   */
  private drawSatellite(
    gl: WebGL2RenderingContext,
    r: Gl,
    args: CustomRenderMethodInput,
    satA: string | null,
    satB: string | null,
    s: number,
  ): boolean {
    if ((!satA && !satB) || !this.satOn()) return false;
    const cs = this.cover(SAT_MAX_Z);
    this.target(gl, r, r.sat, r.satW, r.satH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.tile.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(r.tile.u.u_tex, 0);
    if (satA) {
      gl.colorMask(true, true, false, false);
      this.drawFrame(gl, r, args, satA, cs);
    }
    if (satB) {
      gl.colorMask(false, false, true, true);
      this.drawFrame(gl, r, args, satB, cs);
    }
    gl.colorMask(true, true, true, true);
    const satTexelCss = 2 * 2 ** (this.map.getZoom() - cs.z);
    this.blurInPlace(gl, r, r.sat, r.satTmp, r.satW, r.satH, Math.max(2 * BLUR_PX, BLUR_PER_TEXEL * satTexelCss) * s * 0.5);

    // The radars' reach, drawn like one world-sized tile.
    if (r.covVersion !== this.coverage.version) {
      gl.bindTexture(gl.TEXTURE_2D, r.covGrid);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, COVERAGE_SIZE, COVERAGE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, this.coverage.grid);
      r.covVersion = this.coverage.version;
    }
    this.target(gl, r, r.cov, r.satW, r.satH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.tile.prog);
    const m = args.getProjectionData({ tileID: { canonical: { z: 0, x: 0, y: 0 }, wrap: 0 }, applyGlobeMatrix: false });
    gl.uniformMatrix4fv(r.tile.u.u_matrix, false, m.mainMatrix as Float32Array);
    gl.uniform4f(r.tile.u.u_uv, 0, 0, 1, 1);
    gl.bindTexture(gl.TEXTURE_2D, r.covGrid);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.target(gl, r, r.field[1], r.fieldW, r.fieldH);
    gl.useProgram(r.merge.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.field[0]);
    gl.uniform1i(r.merge.u.u_radar, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.sat);
    gl.uniform1i(r.merge.u.u_sat, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, r.cov);
    gl.uniform1i(r.merge.u.u_cov, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  /** Draw one frame's tiles into the field (into the bound color channel). */
  private drawFrame(gl: WebGL2RenderingContext, r: Gl, args: CustomRenderMethodInput, frame: string, c: Cover, prog: Program = r.tile): void {
    const draw = (z: number, x: number, y: number, tex: WebGLTexture, uv: [number, number, number, number]) => {
      const m = args.getProjectionData({ tileID: { canonical: { z, x, y }, wrap: 0 }, applyGlobeMatrix: false });
      gl.uniformMatrix4fv(prog.u.u_matrix, false, m.mainMatrix as Float32Array);
      gl.uniform4f(prog.u.u_uv, ...uv);
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
      const rows = velocity ? new Uint8Array(256 * 4 * 4).map((_, i) => buildVelocityRampCached()[i % (256 * 4)]) : buildTypeRamps(this.mode);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, rows);
      this.rampDirty = false;
    }
    this.decodeArrivals(gl, r);
    this.evict(gl);

    const s = this.resizeField(gl, r);
    const { fa, fb, f } = this.drawn();
    this.drawF = fb ? f : 0;
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const view = `${r.fieldW}x${r.fieldH} ${center.lng.toFixed(5)},${center.lat.toFixed(5)},${zoom.toFixed(4)},${this.map.getBearing().toFixed(2)},${this.map.getPitch().toFixed(2)}`;

    // 0. Nowcast: the newest two observed frames, their motion, and "now" kept for carrying along it.
    this.nowcast = null;
    const t = this.playhead();
    if (this.inNowcast(t)) {
      const [n0, n1] = this.nowSources();
      const key = `${n0.url} ${n0.sat} ${n1.url} ${n1.sat} ${view} ${this.shownDecodes}`;
      if (key !== this.nowKey) {
        this.nowKey = key;
        this.fieldKey = ''; // the field is about to hold the nowcast's frames
        const nowOut = r.field[this.buildField(gl, r, args, n0, n1, s)];
        this.nowPairH = Math.max(1, n1.at - n0.at) / 3_600_000;
        this.nowFlowReady =
          r.fieldFloat &&
          this.nowFlow.compute(gl, { field: nowOut, fieldW: r.fieldW, fieldH: r.fieldH, pxKm: pixelKm(center.lat, zoom) / s, minutes: (n1.at - n0.at) / 60_000 });
        this.target(gl, r, r.now, r.fieldW, r.fieldH);
        gl.useProgram(r.copyBa.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, nowOut);
        gl.uniform1i(r.copyBa.u.u_src, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // Without a usable motion it still starts from now, standing still, and fades into the model.
      this.nowcast = { k: this.nowFlowReady ? t / this.nowPairH : 0, w: smoothstep(NOWCAST_HANDOFF_H, NOWCAST_H, t) };
    }

    // 1–2. The frames on screen, built only when something they're made of changed (between frame
    // changes, playback just recolors the same field).
    const v = (f: string | null | undefined) => `${f} ${this.version(f)}`;
    const fieldKey = `${v(fa.url)} ${v(fa.sat)} ${v(fb?.url)} ${v(fb?.sat)} ${view} ${s} ${this.satOn()} ${this.coverage.version} ${this.product} ${this.epoch}`;
    if (fieldKey !== this.fieldKey) {
      this.fieldKey = fieldKey;
      r.out = this.buildField(gl, r, args, fa, fb, s);
    }
    const out = r.field[r.out];
    if (this.typesOn()) {
      const typesKey = `${v(fa.ptype)} ${v(fb?.ptype)} ${view} ${s} ${this.epoch}`;
      if (typesKey !== this.typesKey) {
        this.typesKey = typesKey;
        this.buildTypes(gl, r, args, [fa.ptype, fb?.ptype ?? null], pixelKm(center.lat, zoom) / s);
      }
    } else {
      this.typesKey = '';
    }

    // 3. Gliding: where the rain moves from frame a to frame b, redone with the field.
    // Not for velocity (a couplet's two halves would be dragged apart).
    this.flowOn = false;
    if (fb && !velocity && r.fieldFloat) {
      const key = this.fieldKey;
      if (key === this.flowKey) {
        this.flowOn = this.flowReady;
      } else {
        this.flowKey = key;
        this.flowOn = this.flowReady = this.flow.compute(gl, {
          field: out,
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

  /**
   * What's falling for each frame on screen: the model's precip-type tiles, spread a little past its own
   * precipitation (its rain and the radar's rarely line up exactly), into r.type[0] and r.type[1].
   */
  private buildTypes(gl: WebGL2RenderingContext, r: Gl, args: CustomRenderMethodInput, frames: (string | null)[], fieldPxKm: number): void {
    const ct = this.cover(PTYPE_MAX_Z);
    // Half-size textures: a pixel is two field pixels.
    const sigma = Math.max(3, Math.min(24, PTYPE_SPREAD_KM / (2 * fieldPxKm)));
    frames.forEach((frame, i) => {
      this.target(gl, r, r.type[i], r.satW, r.satH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!frame) return;
      gl.useProgram(r.typeTile.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(r.typeTile.u.u_tex, 0);
      this.drawFrame(gl, r, args, frame, ct, r.typeTile);
      this.blurInPlace(gl, r, r.type[i], r.typeTmp, r.satW, r.satH, sigma);
    });
  }

  /**
   * Build a pair of frames into the field as (strength sum, echo share), frame a → rg, frame b → ba:
   * radar tiles, satellite rain past radar range, then the blur. Returns which field holds the result.
   */
  private buildField(gl: WebGL2RenderingContext, r: Gl, args: CustomRenderMethodInput, fa: FrameSource, fb: FrameSource | null, s: number): 0 | 1 {
    const c = this.cover();
    this.target(gl, r, r.field[0], r.fieldW, r.fieldH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.tile.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(r.tile.u.u_tex, 0);
    gl.colorMask(true, true, false, false);
    this.drawFrame(gl, r, args, fa.url, c);
    if (fb) {
      gl.colorMask(false, false, true, true);
      this.drawFrame(gl, r, args, fb.url, c);
    }
    gl.colorMask(true, true, true, true);

    // Past radar range, the satellite estimate (field[0] + satellite → field[1]).
    const out = this.drawSatellite(gl, r, args, fa.sat, fb?.sat ?? null, s) ? 1 : 0;

    // Blur, horizontal then vertical. Wider when zoomed past the data's resolution.
    // Velocity is smoothed lightly: blurring would average a rotation couplet's inbound and outbound away.
    const texelCss = 2 * 2 ** (this.map.getZoom() - c.z);
    const sigma = this.product === 'velocity' ? Math.max(1, 0.45 * texelCss) * s : Math.max(BLUR_PX, BLUR_PER_TEXEL * texelCss) * s;
    this.blurInPlace(gl, r, r.field[out], r.field[1 - out], r.fieldW, r.fieldH, sigma);
    return out;
  }

  render(gl: WebGL2RenderingContext): void {
    const r = this.res;
    if (!this.radarOn || !r || !r.fieldW) return;
    gl.bindVertexArray(r.quad);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(r.composite.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.field[r.out]);
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
    const now = this.nowcast;
    const nowFlow = now && this.nowFlowReady ? this.nowFlow.result : null;
    const [nw, nh] = this.nowFlow.size;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, r.now);
    gl.uniform1i(r.composite.u.u_now, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, nowFlow ?? this.flow.zero(gl));
    gl.uniform1i(r.composite.u.u_nowFlow, 4);
    gl.uniform2f(r.composite.u.u_nowFlowTexel, nowFlow ? 1 / nw : 0, nowFlow ? 1 / nh : 0);
    gl.uniform1f(r.composite.u.u_nowK, now?.k ?? 0);
    gl.uniform1f(r.composite.u.u_nowW, now ? now.w : 1);
    const types = this.typesOn();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, r.type[0]);
    gl.uniform1i(r.composite.u.u_typeA, 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, r.type[1]);
    gl.uniform1i(r.composite.u.u_typeB, 6);
    gl.uniform1f(r.composite.u.u_types, types ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(r.composite.u.u_f, this.drawF);
    gl.uniform1f(r.composite.u.u_mixAmounts, this.product === 'reflectivity' ? 1 : 0);
    gl.uniform1f(r.composite.u.u_opacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
