import type { Scene } from './sky';

/**
 * The weather page's sky, drawn by a fragment shader: procedural clouds lit
 * from the sun's side, the sun on its real arc between sunrise and sunset
 * (warm near the horizon), stars and the moon in its current phase at
 * night, layered rain, snow in depth, rolling fog, and lightning that lights
 * the clouds from inside. Scene changes ease over a second. Renders at CSS
 * resolution and ~30 fps; it is a soft background.
 */

type RGB = [number, number, number];
type Kind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

interface Look {
  top: RGB;
  bottom: RGB;
  /** Cloud color on the side facing the light, and away from it. */
  lit: RGB;
  shade: RGB;
  sun: RGB;
  fog: RGB;
}

const hex = (s: string): RGB => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as RGB;
const look = (top: string, bottom: string, lit: string, shade: string, sun: string, fog: string): Look => ({
  top: hex(top),
  bottom: hex(bottom),
  lit: hex(lit),
  shade: hex(shade),
  sun: hex(sun),
  fog: hex(fog),
});

const DAY: Record<Kind, Look> = {
  clear: look('#1f6bd0', '#7cbdf2', '#ffffff', '#c9d6e6', '#fff4d6', '#dfe8f2'),
  cloudy: look('#56687e', '#a6b4c4', '#f4f7fb', '#8c99a9', '#fff1d0', '#d5dbe2'),
  rain: look('#2b3746', '#5b6b7e', '#9ba8b7', '#47525f', '#e8e6dc', '#9aa5b1'),
  storm: look('#121922', '#33414f', '#6c7986', '#1f2832', '#d8dce0', '#5d6873'),
  snow: look('#8796a8', '#d3dbe4', '#ffffff', '#a9b5c3', '#fbf7ee', '#e8edf2'),
  fog: look('#8c949d', '#c9ced3', '#e7eaed', '#aab1b8', '#f6f1e6', '#d9dde1'),
};

const NIGHT: Record<Kind, Look> = {
  clear: look('#040713', '#15214a', '#3a4762', '#141b2a', '#000000', '#2a3448'),
  cloudy: look('#0b111b', '#232d3c', '#3b4658', '#151b26', '#000000', '#2b3341'),
  rain: look('#0b1018', '#212b38', '#323d4c', '#11171f', '#000000', '#29323e'),
  storm: look('#06090e', '#1a222c', '#2b3540', '#0c1016', '#000000', '#222a33'),
  snow: look('#161e2b', '#384354', '#59657a', '#262f3d', '#000000', '#444f5f'),
  fog: look('#191d22', '#363c43', '#4a5057', '#2a2f35', '#000000', '#41474e'),
};

/** Golden hour: warm horizon, peach-lit clouds, an orange sun. */
const GOLDEN = look('#3d63a8', '#f2a45f', '#ffd2a6', '#9c8aa0', '#ffb15e', '#f0c8a8');

const KIND: Record<Scene, Kind> = {
  'clear-day': 'clear',
  'clear-night': 'clear',
  'cloudy-day': 'cloudy',
  'cloudy-night': 'cloudy',
  rain: 'rain',
  storm: 'storm',
  snow: 'snow',
  fog: 'fog',
};

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mixLook = (a: Look, b: Look, t: number): Look => ({
  top: mixRGB(a.top, b.top, t),
  bottom: mixRGB(a.bottom, b.bottom, t),
  lit: mixRGB(a.lit, b.lit, t),
  shade: mixRGB(a.shade, b.shade, t),
  sun: mixRGB(a.sun, b.sun, t),
  fog: mixRGB(a.fog, b.fog, t),
});
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Fraction of the lunar cycle: 0 new, 0.5 full. */
export function moonPhase(ms: number): number {
  const days = (ms - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000;
  return (((days / 29.530588853) % 1) + 1) % 1;
}

export interface SkyState {
  scene: Scene;
  /** Cloud cover 0..1 and precipitation intensity 0..1. */
  clouds: number;
  intensity: number;
  /** Monochrome (Classic theme). */
  mono: boolean;
  /** Where the day is: 0 sunrise, 1 sunset; below 0 or above 1 is night. */
  sunPhase: number;
}

/** Everything the shader takes, eased from one scene to the next. */
interface Params {
  top: RGB;
  bottom: RGB;
  lit: RGB;
  shade: RGB;
  sunColor: RGB;
  fogColor: RGB;
  cloud: number;
  cloudAlpha: number;
  rain: number;
  snow: number;
  fog: number;
  night: number;
  sunVis: number;
  moonVis: number;
  mono: number;
}

/** The look for a state: day and night blended by daylight, warmed near the horizon. */
export function paramsFor(s: SkyState): Params {
  const kind = KIND[s.scene];
  const p = s.sunPhase;
  // Daylight ramps through civil twilight on either side of sunrise and sunset.
  const daylight = smooth(-0.05, 0.04, p) * (1 - smooth(0.96, 1.05, p));
  const edge = Math.min(Math.abs(p), Math.abs(1 - p));
  const golden = (1 - smooth(0.02, 0.16, edge)) * (kind === 'clear' || kind === 'cloudy' ? 1 : 0.35);
  // A cloudy sky is blue between the clouds until it's nearly overcast.
  const gray = kind === 'cloudy' ? smooth(0.45, 1, s.clouds) : 1;
  const day = kind === 'cloudy' ? mixLook(DAY.clear, DAY.cloudy, gray) : DAY[kind];
  const night = kind === 'cloudy' ? mixLook(NIGHT.clear, NIGHT.cloudy, gray) : NIGHT[kind];
  let l = mixLook(night, day, daylight);
  l = mixLook(l, GOLDEN, golden * (kind === 'clear' ? 0.85 : 0.6) * Math.max(daylight, 0.35 * (1 - daylight)));
  // Clear and cloudy skies show their own cover (partly cloudy is half); wet skies are overcast.
  const overcast = kind === 'clear' ? s.clouds * 0.8 : kind === 'cloudy' ? s.clouds : Math.max(0.85, s.clouds);
  return {
    top: l.top,
    bottom: l.bottom,
    lit: l.lit,
    shade: l.shade,
    sunColor: l.sun,
    fogColor: l.fog,
    // A clear sky (no cover at all) pushes the threshold past every cloud.
    cloud: kind === 'fog' ? 0.5 : kind === 'clear' && s.clouds === 0 ? -0.35 : overcast,
    cloudAlpha: kind === 'clear' ? 0.85 : 0.95,
    rain: kind === 'rain' || kind === 'storm' ? 0.35 + 0.65 * s.intensity : 0,
    snow: kind === 'snow' ? 0.45 + 0.55 * s.intensity : 0,
    fog: kind === 'fog' ? 0.75 : kind === 'rain' || kind === 'storm' ? 0.15 : 0,
    night: 1 - daylight,
    sunVis: daylight * (kind === 'clear' || kind === 'cloudy' ? 1 : 0.25),
    moonVis: (1 - daylight) * (kind === 'clear' ? 1 : kind === 'cloudy' ? 0.6 : 0.15),
    mono: s.mono ? 1 : 0,
  };
}

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_top, u_bottom, u_lit, u_shade, u_sunColor, u_fogColor;
uniform float u_cloud, u_cloudAlpha, u_rain, u_snow, u_fog, u_night, u_mono;
uniform vec3 u_sun;      // x, y (0..1), visibility
uniform vec4 u_moon;     // x, y, radius, phase
uniform float u_moonVis;
uniform float u_flash;
uniform vec2 u_flashAt;
uniform vec2 u_bolt[16];
uniform int u_boltN;
uniform float u_boltA;
out vec4 o;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
float dseg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// Streaks in columns; each column has its own speed and phase. y grows upward, so drops fall as t grows.
float rainLayer(vec2 p, float t, float cols, float speed, float density, float len, float width) {
  float sx = (p.x + p.y * 0.14) * cols;
  float id = floor(sx);
  float h = hash11(id + 1.37);
  if (h > density) return 0.0;
  float y = fract(p.y * (1.6 + h * 1.6) + t * speed * (0.75 + 0.5 * h) + h * 7.0);
  float x = abs(fract(sx) - 0.5) * 2.0;
  return (1.0 - y / len) * step(y, len) * smoothstep(width, 0.0, x);
}
float snowLayer(vec2 p, float t, float scale, float speed, float drift) {
  p.y += t * speed;
  p.x += sin(p.y * 2.7 + t * 0.5) * drift;
  vec2 g = p * scale, id = floor(g), f = fract(g) - 0.5;
  float h = hash12(id);
  if (h > 0.55) return 0.0;
  vec2 off = (hash22(id) - 0.5) * 0.6;
  float r = 0.07 + 0.11 * h;
  return smoothstep(r, r * 0.25, length(f - off));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;

  vec3 col = mix(u_bottom, u_top, smoothstep(0.0, 1.0, uv.y));

  // Sun (or its afterglow near the horizon).
  vec2 sp = vec2(u_sun.x * aspect, u_sun.y);
  float sd = length(p - sp);
  vec3 sunLight = u_sunColor * (exp(-sd * 3.2) * 0.28 + exp(-sd * 16.0) * 0.35);
  float disc = smoothstep(0.03, 0.024, sd);

  // Clouds: domain-warped noise, drifting, denser toward the top.
  vec2 cp = vec2(p.x * 0.9, p.y * 1.7) * 2.3 + vec2(t * 0.012, 0.0);
  vec2 warp = vec2(fbm(cp * 0.55 + vec2(0.0, t * 0.004)), fbm(cp * 0.55 + vec2(5.2, 1.3 - t * 0.003)));
  float n = fbm(cp + warp * 1.25);
  // Cover → threshold: a few puffs when mostly clear, half the sky when partly cloudy, a blanket when overcast.
  float lower = mix(0.7, 0.16, u_cloud);
  float dens = smoothstep(lower, lower + 0.13, n * mix(0.86, 1.08, smoothstep(0.05, 0.95, uv.y)));
  // Light: brighter where the cloud thins toward the sun (or toward the top at night / overcast).
  vec2 toLight = normalize(mix(vec2(0.0, 1.0), sp - p + 1e-4, u_sun.z)) * 0.06;
  float n2 = fbm(cp + warp * 1.25 + toLight * 2.5);
  // Thick cores read darker, thin edges facing the light brighter.
  float lit = clamp(0.62 + (n - n2) * 5.0 - (dens - 0.5) * 0.25, 0.0, 1.0);
  vec3 cloud = mix(u_shade, u_lit, lit);
  cloud += u_sunColor * exp(-sd * 3.5) * 0.35 * u_sun.z;

  // Stars, under the clouds and above the lower sky.
  float stars = 0.0;
  vec2 sg = p * 95.0;
  vec2 sid = floor(sg);
  float sh = hash12(sid);
  if (sh > 0.984) {
    float d = length(fract(sg) - hash22(sid + 3.0));
    stars = smoothstep(0.1, 0.0, d) * (0.55 + 0.45 * sin(t * (0.7 + sh * 3.5) + sh * 60.0));
  }
  col += vec3(stars) * u_night * smoothstep(0.25, 0.65, uv.y);

  // Moon, with its phase: the lit side grows right while waxing, shrinks right while waning.
  vec2 mp = vec2(u_moon.x * aspect, u_moon.y);
  vec2 q = (p - mp) / u_moon.z;
  float md = length(q);
  float k = cos(u_moon.w * 6.2831853);
  float term = k * sqrt(max(0.0, 1.0 - q.y * q.y));
  float litSide = u_moon.w < 0.5 ? smoothstep(term - 0.05, term + 0.05, q.x) : smoothstep(-term + 0.05, -term - 0.05, q.x);
  float moonDisc = smoothstep(1.0, 0.94, md);
  vec3 moonCol = mix(vec3(0.09, 0.1, 0.13), vec3(0.93, 0.94, 0.97), litSide);
  col = mix(col, moonCol, moonDisc * u_moonVis);
  col += vec3(0.55, 0.6, 0.75) * exp(-md * 1.4) * 0.08 * u_moonVis * (0.3 + 0.7 * (1.0 - abs(k)));

  // Sun light and disc go on before the clouds so clouds can cover them.
  col += sunLight * u_sun.z;
  col = mix(col, u_sunColor * 1.02 + 0.05, disc * u_sun.z * 0.9);

  col = mix(col, cloud, dens * u_cloudAlpha);

  // Lightning: the cloud lights from inside around the strike, then the bolt.
  float fd = length(p - vec2(u_flashAt.x * aspect, u_flashAt.y));
  col += vec3(0.78, 0.82, 0.95) * u_flash * (0.2 + 0.8 * dens) * (0.35 + exp(-fd * 2.2));
  if (u_boltA > 0.0) {
    float bd = 1e3;
    for (int i = 0; i < 15; i++) {
      if (i >= u_boltN - 1) break;
      bd = min(bd, dseg(p, u_bolt[i] * vec2(aspect, 1.0), u_bolt[i + 1] * vec2(aspect, 1.0)));
    }
    col += vec3(0.86, 0.9, 1.0) * (smoothstep(0.0035, 0.0, bd) + exp(-bd * 55.0) * 0.5) * u_boltA;
  }

  // Fog: low, drifting banks.
  if (u_fog > 0.0) {
    float f = fbm(vec2(p.x * 1.4 + t * 0.02, p.y * 5.0 - t * 0.006));
    float band = smoothstep(0.9, 0.1, uv.y);
    col = mix(col, u_fogColor, clamp(u_fog * ((0.35 + 0.65 * f) * band + 0.2), 0.0, 0.92));
  }

  // Rain: three depths, far to near.
  if (u_rain > 0.0) {
    float r = rainLayer(p, t, 34.0, 1.35, 0.5, 0.2, 0.18) * 0.3
            + rainLayer(p + 3.1, t, 19.0, 1.9, 0.42, 0.24, 0.14) * 0.5
            + rainLayer(p + 7.7, t, 10.0, 2.7, 0.3, 0.28, 0.1) * 0.75;
    col = mix(col, vec3(0.85, 0.9, 0.97), clamp(r * u_rain, 0.0, 0.85));
    // Rain-darkened low sky.
    col *= 1.0 - 0.12 * u_rain * smoothstep(0.6, 0.0, uv.y);
  }

  // Snow: three depths with drift.
  if (u_snow > 0.0) {
    float s = snowLayer(p, t, 26.0, 0.045, 0.02) * 0.45
            + snowLayer(p + 4.2, t, 15.0, 0.07, 0.03) * 0.7
            + snowLayer(p + 9.1, t, 8.0, 0.11, 0.045) * 0.95;
    col = mix(col, vec3(1.0), clamp(s * u_snow, 0.0, 1.0));
  }

  // Classic: the same sky in dim grays.
  if (u_mono > 0.5) col = vec3(dot(col, vec3(0.299, 0.587, 0.114))) * 0.5;

  col *= 1.0 - 0.12 * length(uv - vec2(0.5, 0.55));
  col += (hash12(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0; // dither: no banding
  o = vec4(col, 1.0);
}`;

const FRAME_MS = 1000 / 30;
/** Scene changes ease over about this long, seconds. */
const EASE_S = 1.2;

const NUM_KEYS = ['cloud', 'cloudAlpha', 'rain', 'snow', 'fog', 'night', 'sunVis', 'moonVis', 'mono'] as const;
const RGB_KEYS = ['top', 'bottom', 'lit', 'shade', 'sunColor', 'fogColor'] as const;

export class SkyGL {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private state: SkyState = { scene: 'clear-day', clouds: 0, intensity: 0, mono: false, sunPhase: 0.5 };
  private cur: Params;
  private target: Params;
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private t = Math.random() * 100;
  private flash = 0;
  private flashAge = -1;
  private nextFlash = 2.5;
  private flashAt: [number, number] = [0.5, 0.8];
  private bolt: number[] = [];
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)');

  /** Null when WebGL 2 isn't available (the caller falls back to the 2D sky). */
  static create(canvas: HTMLCanvasElement): SkyGL | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) return null;
    try {
      return new SkyGL(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    const prog = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`sky shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(prog, s);
    }
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`sky program: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    for (const name of [
      'u_res', 'u_time', 'u_top', 'u_bottom', 'u_lit', 'u_shade', 'u_sunColor', 'u_fogColor', 'u_cloud', 'u_cloudAlpha',
      'u_rain', 'u_snow', 'u_fog', 'u_night', 'u_mono', 'u_sun', 'u_moon', 'u_moonVis', 'u_flash', 'u_flashAt', 'u_bolt',
      'u_boltN', 'u_boltA',
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.cur = paramsFor(this.state);
    this.target = this.cur;
  }

  set(state: SkyState): void {
    const first = !this.w;
    this.state = state;
    this.target = paramsFor(state);
    if (first) this.cur = this.target;
    if (!this.raf) this.draw(0);
  }

  start(): void {
    this.resize();
    if (this.still.matches) {
      this.cur = this.target;
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
    this.gl.viewport(0, 0, w, h);
    if (!this.raf) this.draw(0);
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

  private ease(dt: number): void {
    const k = Math.min(1, dt / EASE_S * 3);
    const next = { ...this.cur };
    for (const key of NUM_KEYS) next[key] = this.cur[key] + (this.target[key] - this.cur[key]) * k;
    for (const key of RGB_KEYS) next[key] = mixRGB(this.cur[key], this.target[key], k);
    next.mono = this.target.mono;
    this.cur = next;
  }

  /** Every few seconds in a storm: a double flash, and a bolt during the first. */
  private lightning(dt: number): void {
    if (this.state.scene !== 'storm') {
      this.flash = 0;
      this.flashAge = -1;
      return;
    }
    this.nextFlash -= dt;
    if (this.nextFlash <= 0 && this.flashAge < 0) {
      this.flashAge = 0;
      this.nextFlash = 4 + Math.random() * 7;
      this.flashAt = [0.15 + Math.random() * 0.7, 0.7 + Math.random() * 0.25];
      this.bolt = Math.random() < 0.65 ? boltPath(this.flashAt) : [];
    }
    if (this.flashAge >= 0) {
      this.flashAge += dt;
      const f = this.flashAge;
      this.flash = f < 0.07 ? 0.9 : f < 0.14 ? 0.15 : f < 0.24 ? 0.6 : Math.max(0, 0.6 - (f - 0.24) * 1.8);
      if (f > 0.6) this.flashAge = -1;
    }
  }

  private draw(dt: number): void {
    const { gl, u } = this;
    if (!this.w) return;
    this.t += dt;
    this.ease(dt || 1);
    this.lightning(dt);
    const p = this.cur;
    const phase = this.state.sunPhase;
    // The sun's arc: low on the left at sunrise, high at noon, low on the right at sunset.
    const arc = Math.max(0, Math.min(1, phase));
    const sunY = 0.6 + 0.32 * Math.sin(Math.PI * arc) - (phase < 0 ? -phase : phase > 1 ? phase - 1 : 0) * 2;

    gl.useProgram(this.prog);
    gl.uniform2f(u.u_res, this.w, this.h);
    gl.uniform1f(u.u_time, this.t);
    gl.uniform3fv(u.u_top, p.top);
    gl.uniform3fv(u.u_bottom, p.bottom);
    gl.uniform3fv(u.u_lit, p.lit);
    gl.uniform3fv(u.u_shade, p.shade);
    gl.uniform3fv(u.u_sunColor, p.sunColor);
    gl.uniform3fv(u.u_fogColor, p.fogColor);
    gl.uniform1f(u.u_cloud, p.cloud);
    gl.uniform1f(u.u_cloudAlpha, p.cloudAlpha);
    gl.uniform1f(u.u_rain, p.rain);
    gl.uniform1f(u.u_snow, p.snow);
    gl.uniform1f(u.u_fog, p.fog);
    gl.uniform1f(u.u_night, p.night);
    gl.uniform1f(u.u_mono, p.mono);
    gl.uniform3f(u.u_sun, 0.14 + 0.72 * arc, sunY, p.sunVis);
    gl.uniform4f(u.u_moon, 0.26, 0.8, 0.045, moonPhase(Date.now()));
    gl.uniform1f(u.u_moonVis, p.moonVis);
    gl.uniform1f(u.u_flash, this.flash);
    gl.uniform2f(u.u_flashAt, this.flashAt[0], this.flashAt[1]);
    const n = this.bolt.length / 2;
    if (n) gl.uniform2fv(u.u_bolt, new Float32Array([...this.bolt, ...new Array(32 - this.bolt.length).fill(0)]));
    gl.uniform1i(u.u_boltN, n);
    gl.uniform1f(u.u_boltA, n && this.flashAge >= 0 && this.flashAge < 0.3 ? (this.flashAge < 0.07 ? 1 : 0.55) : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** A jagged bolt from the cloud downward: up to 16 points in 0..1 screen space. */
function boltPath([x, y]: [number, number]): number[] {
  const pts = [x, y];
  let cx = x;
  let cy = y;
  const n = 10 + Math.floor(Math.random() * 6);
  const drop = (y - 0.35 - Math.random() * 0.15) / n;
  for (let i = 0; i < n - 1; i++) {
    cx += (Math.random() - 0.5) * 0.06;
    cy -= drop * (0.6 + Math.random() * 0.8);
    pts.push(cx, cy);
  }
  return pts;
}
