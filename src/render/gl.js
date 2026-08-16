// Thin WebGL2 helpers. Everything the renderer needs and nothing it doesn't.

export function createContext(canvas) {
  const attrs = {
    alpha: false,
    antialias: false,          // pixel art; MSAA just blurs block edges
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: true,
  };
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) {
    throw new Error(
      'WebGL2 is not available in this browser.\n' +
      'SowmiCraft needs WebGL2 — try a recent Chrome, Edge, Firefox or Safari, ' +
      'and make sure hardware acceleration is enabled.',
    );
  }
  return gl;
}

export function compileShader(gl, type, source, label = '') {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = source.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed (${label}):\n${log}\n\n${numbered}`);
  }
  return sh;
}

export function createProgram(gl, vsSource, fsSource, label = 'program') {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, `${label}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed (${label}):\n${log}`);
  }
  return prog;
}

/**
 * Wraps a program with cached uniform/attribute locations and typed setters.
 */
export class Shader {
  constructor(gl, vs, fs, label = 'shader') {
    this.gl = gl;
    this.label = label;
    this.program = createProgram(gl, vs, fs, label);
    this.uniforms = new Map();
    this.attribs = new Map();

    const nu = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(name, gl.getUniformLocation(this.program, info.name));
    }
    const na = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(this.program, i);
      if (!info) continue;
      this.attribs.set(info.name, gl.getAttribLocation(this.program, info.name));
    }
  }

  use() { this.gl.useProgram(this.program); return this; }
  loc(name) { return this.uniforms.get(name) ?? null; }
  attrib(name) { return this.attribs.has(name) ? this.attribs.get(name) : -1; }

  int(name, v) { const l = this.loc(name); if (l) this.gl.uniform1i(l, v); return this; }
  float(name, v) { const l = this.loc(name); if (l) this.gl.uniform1f(l, v); return this; }
  vec2(name, x, y) { const l = this.loc(name); if (l) this.gl.uniform2f(l, x, y); return this; }
  vec3(name, x, y, z) {
    const l = this.loc(name);
    if (!l) return this;
    if (typeof x === 'number') this.gl.uniform3f(l, x, y, z);
    else this.gl.uniform3fv(l, x);
    return this;
  }
  vec4(name, x, y, z, w) {
    const l = this.loc(name);
    if (!l) return this;
    if (typeof x === 'number') this.gl.uniform4f(l, x, y, z, w);
    else this.gl.uniform4fv(l, x);
    return this;
  }
  mat4(name, m) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  floats(name, arr) { const l = this.loc(name); if (l) this.gl.uniform1fv(l, arr); return this; }

  destroy() { this.gl.deleteProgram(this.program); }
}

/** Grows a Float32Array/Uint8Array-backed buffer as vertices are appended. */
export class DynamicBuffer {
  constructor(ArrayType, initial = 1024) {
    this.ArrayType = ArrayType;
    this.data = new ArrayType(initial);
    this.length = 0;
  }
  ensure(extra) {
    if (this.length + extra <= this.data.length) return;
    let cap = this.data.length || 1024;
    while (cap < this.length + extra) cap *= 2;
    const next = new this.ArrayType(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push(...values) {
    this.ensure(values.length);
    for (let i = 0; i < values.length; i++) this.data[this.length++] = values[i];
  }
  reset() { this.length = 0; }
  view() { return this.data.subarray(0, this.length); }
}

/** Reports GPU capabilities, shown on the debug screen. */
export function glInfo(gl) {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
  };
}

/** Resizes the drawing buffer to the CSS size times `scale`; returns true on change. */
export function resizeCanvas(canvas, scale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
