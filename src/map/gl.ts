/** Small WebGL2 helpers shared by the radar's passes. */

export interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

/** A full-target quad: v_uv runs 0…1 over the render target. */
export const QUAD_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }`;

/** One direction of a 9-tap Gaussian (sigma ≈ 1.75 steps), on all four channels. */
export const GAUSS9_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_step;
in vec2 v_uv;
out vec4 o;
const float W[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
void main() {
  vec4 acc = texture(u_tex, v_uv) * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 d = u_step * float(i);
    acc += (texture(u_tex, v_uv + d) + texture(u_tex, v_uv - d)) * W[i];
  }
  o = acc;
}`;

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`radar shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`radar program: ${gl.getProgramInfoLog(prog)}`);
  const u: Program['u'] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
}

export function texture2d(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Render into `tex` (w × h) through `fbo`. */
export function target(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, tex: WebGLTexture, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
}
