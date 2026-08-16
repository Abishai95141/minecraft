// Billboarded particles as one instanced draw call. Physics is vanilla-shaped
// (gravity 0.04/tick, drag 0.98, cheap per-axis block collision) and colours
// come out of the block atlas, so a broken block throws its own texture around.

import { Shader } from './gl.js';
import { PARTICLE_VS, PARTICLE_FS } from './shaders.js';
import { clamp } from '../core/math.js';
import { TPS, LIGHT_TABLE } from '../core/constants.js';
import { fx } from '../core/rng.js';
import { settings } from '../core/settings.js';
import { B, BLOCKS, FACE_NORMALS, IS_SOLID, IS_FULL_CUBE } from '../world/blocks.js';

const MAX_PARTICLES = 4000;
const FLOATS_PER_INSTANCE = 10;   // center3, size2, color4, light1

const GRAVITY = 0.04;
const DRAG = 0.98;
const GROUND_FRICTION = 0.7;
const HALF_EXTENT = 0.06;         // particles are points with a whisker of body
const MAX_CATCHUP_TICKS = 5;

const F_COLLIDE = 1;
const F_EMISSIVE = 2;
const F_SHRINK = 4;

/** Density multipliers for the `particles` option. */
const DENSITY = { all: 1, decreased: 0.5, minimal: 0.15 };

/**
 * Per-type defaults. `gravity` and `drag` are multipliers on the shared
 * constants; a negative gravity is what makes smoke and flame climb.
 */
const TYPES = {
  blockBreak: {
    count: 1, size: [0.07, 0.13], life: [16, 36], gravity: 1, drag: 1,
    color: null, spread: 0.16, rise: [0.04, 0.24], collide: true, vary: 0.12,
  },
  blockDust: {
    count: 4, size: [0.05, 0.09], life: [10, 22], gravity: 0.6, drag: 0.98,
    color: null, spread: 0.08, rise: [0, 0.1], collide: true, vary: 0.15,
  },
  splash: {
    count: 6, size: [0.05, 0.09], life: [8, 18], gravity: 1, drag: 1,
    color: 0x4b7be5, spread: 0.14, rise: [0.12, 0.32], collide: false, vary: 0.1,
  },
  bubble: {
    count: 4, size: [0.04, 0.07], life: [16, 40], gravity: -0.5, drag: 0.87,
    color: 0xbfe2ff, spread: 0.03, rise: [0.02, 0.06], collide: false, vary: 0.05,
  },
  smoke: {
    count: 3, size: [0.1, 0.18], life: [30, 70], gravity: -0.12, drag: 0.95,
    color: 0x4a4a4a, spread: 0.02, rise: [0.01, 0.05], collide: false, vary: 0.25,
  },
  flame: {
    count: 2, size: [0.08, 0.14], life: [16, 28], gravity: -0.1, drag: 0.96,
    color: 0xffa82b, spread: 0.02, rise: [0.01, 0.05], collide: false,
    emissive: true, shrink: true, vary: 0.12,
  },
  crit: {
    count: 6, size: [0.05, 0.09], life: [8, 16], gravity: 0.5, drag: 0.92,
    color: 0xffe07a, spread: 0.2, rise: [0.05, 0.25], collide: false,
    emissive: true, shrink: true, vary: 0.1,
  },
  damage: {
    count: 4, size: [0.1, 0.14], life: [12, 22], gravity: 0.35, drag: 0.94,
    color: 0x9e0b10, spread: 0.12, rise: [0.1, 0.24], collide: false, vary: 0.1,
  },
  heart: {
    count: 1, size: [0.16, 0.2], life: [24, 30], gravity: -0.05, drag: 0.96,
    color: 0xff4b63, spread: 0.04, rise: [0.04, 0.08], collide: false, vary: 0.05,
  },
  note: {
    count: 1, size: [0.14, 0.18], life: [20, 30], gravity: -0.05, drag: 0.97,
    color: 0x62c462, spread: 0.03, rise: [0.05, 0.09], collide: false, vary: 0,
  },
  ember: {
    count: 3, size: [0.04, 0.08], life: [30, 80], gravity: 0.12, drag: 0.98,
    color: 0xff7a26, spread: 0.05, rise: [0.02, 0.12], collide: true,
    emissive: true, shrink: true, vary: 0.2,
  },
  portal: {
    count: 6, size: [0.06, 0.12], life: [20, 44], gravity: -0.04, drag: 0.99,
    color: 0x9c4bd6, spread: 0.22, rise: [-0.1, 0.1], collide: false,
    emissive: true, shrink: true, vary: 0.2,
  },
};

/** Full-saturation hue ramp, used for note particles. */
function hueColor(h) {
  const t = ((h % 1) + 1) % 1;
  const k = (n) => {
    const v = (n + t * 6) % 6;
    return clamp(Math.min(v, 4 - v, 1), 0, 1);
  };
  return ((Math.round(k(5) * 255) << 16) | (Math.round(k(3) * 255) << 8) | Math.round(k(1) * 255)) >>> 0;
}

export class ParticleSystem {
  constructor(gl, atlas) {
    this.gl = gl;
    this.atlas = atlas;

    this.n = 0;
    this._cursor = 0;
    this._acc = 0;
    this._tick = 0;

    const cap = MAX_PARTICLES;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.cr = new Float32Array(cap);
    this.cg = new Float32Array(cap);
    this.cb = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.light = new Float32Array(cap);
    this.flags = new Uint8Array(cap);

    this.instanceData = new Float32Array(cap * FLOATS_PER_INSTANCE);

    this.shader = new Shader(gl, PARTICLE_VS, PARTICLE_FS, 'particle');

    this.vao = gl.createVertexArray();
    this.cornerVBO = gl.createBuffer();
    this.instanceVBO = gl.createBuffer();
    this.ibo = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    this._attrib('aCorner', 2, 8, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    this._attrib('aCenter', 3, stride, 0, 1);
    this._attrib('aSize', 2, stride, 12, 1);
    this._attrib('aColor', 4, stride, 20, 1);
    this._attrib('aLight', 1, stride, 36, 1);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    // Nothing in the atlas is a particle sprite, so the textured path stays off
    // and these two attributes ride on their constant generic values.
    this._uvRectLoc = this.shader.attrib('aUVRect');
    this._layerLoc = this.shader.attrib('aLayer');
  }

  _attrib(name, size, stride, offset, divisor) {
    const loc = this.shader.attrib(name);
    if (loc < 0) return;
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, divisor);
  }

  get count() { return this.n; }

  clear() { this.n = 0; this._cursor = 0; this._acc = 0; }

  /** Live-particle ceiling for the current quality setting. */
  get _budget() {
    return Math.max(400, Math.round(MAX_PARTICLES * (DENSITY[settings.get('particles')] ?? 1)));
  }

  /**
   * Emits `opts.count` particles of `type` at (x,y,z).
   * opts: {count, vx, vy, vz, spread, color, size, life, gravity, drag,
   *        collide, blockId, face, note, alpha}
   * @returns {number} how many were actually spawned
   */
  spawn(type, x, y, z, opts = {}) {
    const def = TYPES[type] || TYPES.smoke;
    const wanted = opts.count ?? def.count;
    const density = DENSITY[settings.get('particles')] ?? 1;

    // Fractional budgets resolve probabilistically so "Minimal" genuinely thins
    // single-particle effects out instead of rounding every one of them back up.
    const exact = wanted * density;
    let n = Math.floor(exact);
    if (fx.next() < exact - n) n++;
    if (n <= 0) return 0;

    let spawned = 0;
    for (let k = 0; k < n; k++) {
      const i = this._alloc();
      if (i < 0) break;
      this._init(i, def, x, y, z, opts);
      spawned++;
    }
    return spawned;
  }

  /** 4x4x4 grid burst, each shard coloured from the block's own texture. */
  blockBreak(x, y, z, blockId) {
    const def = BLOCKS[blockId];
    const tex = def?.breakParticleTex || def?.faceTex?.[2] || 'stone';
    const shape = TYPES.blockBreak;
    const density = DENSITY[settings.get('particles')] ?? 1;
    const step = 0.25;

    let spawned = 0;
    for (let ix = 0; ix < 4; ix++) {
      for (let iy = 0; iy < 4; iy++) {
        for (let iz = 0; iz < 4; iz++) {
          if (fx.next() >= density) continue;
          const i = this._alloc();
          if (i < 0) return spawned;
          const ox = (ix + 0.5) * step;
          const oy = (iy + 0.5) * step;
          const oz = (iz + 0.5) * step;
          this._init(i, shape, x + ox, y + oy, z + oz, {
            color: this._samplePixel(tex),
            // Shards fly out of the block centre, the way vanilla's do.
            vx: (ox - 0.5) * 0.4,
            vy: (oy - 0.5) * 0.4 + 0.05,
            vz: (oz - 0.5) * 0.4,
          });
          spawned++;
        }
      }
    }
    return spawned;
  }

  /** The small puff thrown off the face a player is currently mining. */
  blockHit(x, y, z, face, blockId) {
    const def = BLOCKS[blockId];
    const n = FACE_NORMALS[face] || FACE_NORMALS[2];
    const tex = def?.faceTex?.[face] ?? def?.breakParticleTex ?? 'stone';
    const density = DENSITY[settings.get('particles')] ?? 1;

    const wanted = 2 * density;
    let count = Math.floor(wanted);
    if (fx.next() < wanted - count) count++;

    let spawned = 0;
    for (let k = 0; k < count; k++) {
      const i = this._alloc();
      if (i < 0) break;
      // Sit just off the face, jittered across the two tangent axes.
      const px = x + (n[0] !== 0 ? (n[0] > 0 ? 1.06 : -0.06) : fx.float(0.15, 0.85));
      const py = y + (n[1] !== 0 ? (n[1] > 0 ? 1.06 : -0.06) : fx.float(0.15, 0.85));
      const pz = z + (n[2] !== 0 ? (n[2] > 0 ? 1.06 : -0.06) : fx.float(0.15, 0.85));
      this._init(i, TYPES.blockDust, px, py, pz, {
        color: this._samplePixel(tex),
        vx: n[0] * 0.06,
        vy: n[1] * 0.06 + 0.04,
        vz: n[2] * 0.06,
      });
      spawned++;
    }
    return spawned;
  }

  _samplePixel(tex) {
    return this.atlas?.samplePixel ? this.atlas.samplePixel(tex, fx.below(16), fx.below(16)) : 0x808080;
  }

  /**
   * Claims a slot. Past the budget it evicts the shortest-lived of four
   * candidates, so a huge burst degrades gracefully instead of tanking a frame.
   */
  _alloc() {
    const cap = this._budget;
    if (this.n < cap) return this.n++;
    let best = 0;
    let bestLeft = Infinity;
    for (let k = 0; k < 4; k++) {
      if (this._cursor >= this.n) this._cursor = 0;
      const i = this._cursor++;
      const left = this.life[i] - this.age[i];
      if (left < bestLeft) { bestLeft = left; best = i; }
    }
    return best;
  }

  _init(i, def, x, y, z, opts) {
    const spread = opts.spread ?? def.spread;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = (opts.vx ?? 0) + fx.float(-spread, spread);
    this.vy[i] = (opts.vy ?? 0) + fx.float(def.rise[0], def.rise[1]);
    this.vz[i] = (opts.vz ?? 0) + fx.float(-spread, spread);

    let hex = opts.color ?? def.color ?? 0x808080;
    if (opts.note !== undefined) hex = hueColor(opts.note);
    const jitter = def.vary ? 1 + fx.float(-def.vary, def.vary) : 1;
    this.cr[i] = clamp((((hex >> 16) & 255) / 255) * jitter, 0, 1);
    this.cg[i] = clamp((((hex >> 8) & 255) / 255) * jitter, 0, 1);
    this.cb[i] = clamp(((hex & 255) / 255) * jitter, 0, 1);
    this.alpha[i] = opts.alpha ?? 1;

    this.size[i] = opts.size ?? fx.float(def.size[0], def.size[1]);
    this.age[i] = 0;
    this.life[i] = opts.life ?? fx.float(def.life[0], def.life[1]);
    this.grav[i] = (opts.gravity ?? def.gravity) * GRAVITY;
    this.drag[i] = (opts.drag ?? def.drag) * DRAG;

    let flags = 0;
    if (opts.collide ?? def.collide) flags |= F_COLLIDE;
    if (def.emissive) flags |= F_EMISSIVE;
    if (def.shrink) flags |= F_SHRINK;
    this.flags[i] = flags;

    this.light[i] = (flags & F_EMISSIVE) ? 1 : (opts.light ?? 0.6);
  }

  /** @param {number} dt seconds since the last frame */
  update(dt, world) {
    this._acc = Math.min(this._acc + dt * TPS, MAX_CATCHUP_TICKS);
    while (this._acc >= 1) {
      this._acc -= 1;
      this._step(world);
    }
  }

  _step(world) {
    this._tick++;
    const phase = this._tick & 3;

    for (let i = 0; i < this.n;) {
      this.age[i] += 1;
      if (this.age[i] >= this.life[i]) {
        const last = --this.n;
        if (i !== last) this._copy(last, i);
        continue;
      }

      let vx = this.vx[i];
      let vy = this.vy[i] - this.grav[i];
      let vz = this.vz[i];

      let x = this.px[i] + vx;
      let y = this.py[i] + vy;
      let z = this.pz[i] + vz;

      if (world && (this.flags[i] & F_COLLIDE)) {
        // Resolve one axis at a time, testing the leading edge of the particle's
        // little box. Cheap, stable, and it never lets a shard sink into stone.
        const ex = vx > 0 ? HALF_EXTENT : -HALF_EXTENT;
        const ey = vy > 0 ? HALF_EXTENT : -HALF_EXTENT;
        const ez = vz > 0 ? HALF_EXTENT : -HALF_EXTENT;
        if (solidAt(world, x + ex, this.py[i], this.pz[i])) { x = this.px[i]; vx = 0; }
        if (solidAt(world, x, y + ey, this.pz[i])) {
          y = this.py[i];
          if (vy < 0) { vx *= GROUND_FRICTION; vz *= GROUND_FRICTION; }
          vy = 0;
        }
        if (solidAt(world, x, y, z + ez)) { z = this.pz[i]; vz = 0; }
      }

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      const d = this.drag[i];
      this.vx[i] = vx * d;
      this.vy[i] = vy * d;
      this.vz[i] = vz * d;

      // Relighting is spread over four ticks; nobody sees a one-tick lag.
      if (world && !(this.flags[i] & F_EMISSIVE) && (i & 3) === phase) {
        const level = world.getLightLevel(Math.floor(x), Math.floor(y), Math.floor(z));
        this.light[i] = LIGHT_TABLE[clamp(level | 0, 0, 15)];
      }
      i++;
    }
  }

  _copy(from, to) {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.cr[to] = this.cr[from]; this.cg[to] = this.cg[from]; this.cb[to] = this.cb[from];
    this.alpha[to] = this.alpha[from];
    this.size[to] = this.size[from];
    this.age[to] = this.age[from]; this.life[to] = this.life[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.light[to] = this.light[from];
    this.flags[to] = this.flags[from];
  }

  render(camera, frameInfo = {}) {
    if (this.n === 0) return;
    const gl = this.gl;

    const right = camera.right || [1, 0, 0];
    const up = camera.up || [0, 1, 0];

    const data = this.instanceData;
    let o = 0;
    let drawn = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      // Everything fades out over its last quarter rather than blinking away.
      const a = this.alpha[i] * Math.min(1, (1 - t) * 4);
      if (a <= 0.004) continue;
      const s = this.size[i] * ((this.flags[i] & F_SHRINK) ? 1 - t * 0.6 : 1);
      data[o++] = this.px[i];
      data[o++] = this.py[i];
      data[o++] = this.pz[i];
      data[o++] = s;
      data[o++] = s;
      data[o++] = this.cr[i];
      data[o++] = this.cg[i];
      data[o++] = this.cb[i];
      data[o++] = a;
      data[o++] = Math.max(this.light[i], 0.06);
      drawn++;
    }
    if (drawn === 0) return;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, o);

    const sh = this.shader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.vec3('uRight', right[0], right[1], right[2]);
    sh.vec3('uUp', up[0], up[1], up[2]);
    sh.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
    sh.int('uAtlas', 0);
    sh.float('uUseTexture', 0);

    const fog = frameInfo.fogColor || [0.7, 0.8, 1];
    sh.vec3('uFogColor', fog[0], fog[1], fog[2]);
    sh.float('uFogStart', frameInfo.fogStart ?? 1e6);
    sh.float('uFogEnd', frameInfo.fogEnd ?? 1e6 + 1);
    sh.float('uFogDensity', frameInfo.fogDensity ?? 0);

    if (this.atlas?.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);
    }
    // The untextured path never reads these, but leaving them undefined would
    // be sloppy; generic attribute values are context state, so set them here.
    if (this._uvRectLoc >= 0) gl.vertexAttrib4f(this._uvRectLoc, 0, 0, 1, 1);
    if (this._layerLoc >= 0) gl.vertexAttrib1f(this._layerLoc, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, drawn);

    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.cornerVBO);
    gl.deleteBuffer(this.instanceVBO);
    gl.deleteBuffer(this.ibo);
    this.shader.destroy();
  }
}

/** True when (x,y,z) sits inside a whole solid block. */
function solidAt(world, x, y, z) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const id = world.getBlock(bx, by, bz);
  if (id === B.AIR || id === undefined) return false;
  return IS_SOLID[id] === 1 && IS_FULL_CUBE[id] === 1;
}
