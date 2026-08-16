// The sky: gradient dome, sun and moon riding the day/night arc, a hashed
// starfield and the drifting voxel cloud layer at WORLD.CLOUD_HEIGHT.
// `skyColors` is the shared source of truth — the terrain pass fogs to it.

import { Shader, DynamicBuffer } from './gl.js';
import { SKY_VS, SKY_FS, CELESTIAL_VS, CELESTIAL_FS, CLOUD_VS, CLOUD_FS } from './shaders.js';
import { clamp, lerp, mixHex, hexToRgb, smoothstep, TAU } from '../core/math.js';
import { WORLD } from '../core/constants.js';
import { hash2f } from '../core/rng.js';
import { settings } from '../core/settings.js';

// ---------------------------------------------------------------- palette

const DAY_TOP = 0x78a7ff;
const DAY_HORIZON = 0xc2d9ff;
// Twilight is its own anchor: without it the ramp slides through a muddy grey
// instead of the indigo-over-mauve that makes dusk read as dusk.
const TWILIGHT_TOP = 0x18244f;
const TWILIGHT_HORIZON = 0x7c6a84;
const NIGHT_TOP = 0x0a1236;
const NIGHT_HORIZON = 0x141e44;
const MIDNIGHT_TOP = 0x000004;
const MIDNIGHT_HORIZON = 0x05091c;
const DUSK_BAND = 0xfc9a45;
const DAWN_BAND = 0xffb072;

/**
 * `world.skyLightFactor()` is `sin(dayAngle) * 2 + 0.5` clamped to [0.2, 1], so
 * daylight saturates at sin = 0.25 and full night begins at NIGHT_START.
 * Anchoring the colour ramp to those same two elevations keeps the sky and the
 * block light in step instead of drifting minutes apart.
 */
const DAY_ELEVATION = 0.25;
const NIGHT_DEPTH = -Math.sin((WORLD.NIGHT_START / WORLD.DAY_LENGTH_TICKS) * TAU);

/** Tilt of the celestial plane, in radians. Also keeps the sun off the zenith,
 *  where the billboard basis and the sunset azimuth would both degenerate. */
const ARC_TILT = 0.15;
const TILT_COS = Math.cos(ARC_TILT);
const TILT_SIN = Math.sin(ARC_TILT);

const SUN_SIZE = 30;
const MOON_SIZE = 26;

const CLOUD_CELL = 12;          // blocks per cloud cell
const CLOUD_THICKNESS = 4;
const CLOUD_RADIUS_CELLS = 18;
const CLOUD_SPEED = 0.6;        // blocks per second, on +X
const CLOUD_ALPHA = 0.8;

/** Time of day as an angle: 0 = sunrise, PI/2 = noon, PI = sunset. */
function dayAngle(timeOfDay) {
  const d = WORLD.DAY_LENGTH_TICKS;
  return ((((timeOfDay % d) + d) % d) / d) * TAU;
}

/** Sun elevation (unit-sphere Y) for a time of day. */
function sunElevation(timeOfDay) {
  return Math.sin(dayAngle(timeOfDay)) * TILT_COS;
}

/** Unit direction from the camera toward the sun, written into `out`. */
function sunDirection(timeOfDay, out) {
  const a = dayAngle(timeOfDay);
  const s = Math.sin(a);
  out[0] = Math.cos(a);
  out[1] = s * TILT_COS;
  out[2] = s * TILT_SIN;
  return out;
}

/**
 * The whole cycle in one place.
 * @param {number} timeOfDay ticks, 0 = sunrise, 6000 = noon, 18000 = midnight
 * @param {number|null} biomeSkyTint 0xRRGGBB, blended in during daylight
 * @returns {{top:number, horizon:number, sunset:number, sunsetStrength:number,
 *            starAlpha:number, fog:number}} colours as 0xRRGGBB
 */
export function skyColors(timeOfDay, biomeSkyTint = null) {
  const angle = dayAngle(timeOfDay);
  const elev = Math.sin(angle) * TILT_COS;

  // 0 at the moment night fully sets in, 1 once the sun is high enough that
  // block light has already saturated.
  const dayT = smoothstep(clamp((elev + NIGHT_DEPTH) / (DAY_ELEVATION + NIGHT_DEPTH), 0, 1));
  // How deep into the night we are: 0 at dusk's end, 1 at midnight.
  const midnightT = smoothstep(clamp((-elev - NIGHT_DEPTH) / (TILT_COS - NIGHT_DEPTH), 0, 1));

  const nightTop = mixHex(NIGHT_TOP, MIDNIGHT_TOP, midnightT);
  const nightHorizon = mixHex(NIGHT_HORIZON, MIDNIGHT_HORIZON, midnightT);

  let top;
  let horizon;
  if (dayT < 0.35) {
    const u = smoothstep(dayT / 0.35);
    top = mixHex(nightTop, TWILIGHT_TOP, u);
    horizon = mixHex(nightHorizon, TWILIGHT_HORIZON, u);
  } else {
    const u = smoothstep((dayT - 0.35) / 0.65);
    top = mixHex(TWILIGHT_TOP, DAY_TOP, u);
    horizon = mixHex(TWILIGHT_HORIZON, DAY_HORIZON, u);
  }

  if (biomeSkyTint != null) {
    // Biome only recolours the lit sky; at night everything converges on black.
    const w = 0.4 * dayT;
    top = mixHex(top, biomeSkyTint, w);
    horizon = mixHex(horizon, mixHex(biomeSkyTint, 0xffffff, 0.45), w * 0.7);
  }

  // The band is strongest with the sun exactly on the horizon and gone by the
  // time it is a quarter of the way up.
  const nearHorizon = clamp(1 - Math.abs(elev) / 0.45, 0, 1);
  const sunsetStrength = 0.9 * smoothstep(nearHorizon);
  // Rising sun (cos > 0) gets the warmer pink; the setting sun gets the orange.
  const sunset = Math.cos(angle) > 0 ? DAWN_BAND : DUSK_BAND;

  const starAlpha = clamp((-elev - 0.04) / 0.34, 0, 1);

  // SKY_FS shades the horizon as mix(horizon, top, pow(0.5, 0.65)) ~= 0.64, so
  // fogging to roughly that mix is what makes the terrain meet the sky cleanly.
  let fog = mixHex(horizon, top, 0.6);
  fog = mixHex(fog, sunset, sunsetStrength * 0.3);

  return { top, horizon, sunset, sunsetStrength, starAlpha, fog };
}

// ---------------------------------------------------------------- geometry

function buildDome(rings, segments) {
  const pos = new Float32Array((rings + 1) * (segments + 1) * 3);
  const idx = new Uint16Array(rings * segments * 6);
  let p = 0;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * TAU;
      pos[p++] = sp * Math.cos(th);
      pos[p++] = cp;
      pos[p++] = sp * Math.sin(th);
    }
  }
  let i = 0;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      idx[i++] = a; idx[i++] = b; idx[i++] = a + 1;
      idx[i++] = a + 1; idx[i++] = b; idx[i++] = b + 1;
    }
  }
  return { pos, idx };
}

/** Smooth value noise over the cloud cell grid; deterministic from hash2f. */
function cloudValue(cx, cz, scale, seed) {
  const x = cx / scale;
  const z = cz / scale;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = smoothstep(x - x0);
  const v = smoothstep(z - z0);
  const a = hash2f(x0, z0, seed);
  const b = hash2f(x0 + 1, z0, seed);
  const c = hash2f(x0, z0 + 1, seed);
  const d = hash2f(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** True when a cloud cell is filled. ~45% coverage in fat, rounded banks. */
function cloudy(cx, cz) {
  const n = cloudValue(cx, cz, 7, 0x51f1) * 0.6
          + cloudValue(cx, cz, 3, 0x9e37) * 0.28
          + cloudValue(cx, cz, 1.5, 0x1b27) * 0.12;
  return n > 0.52;
}

// ---------------------------------------------------------------- renderer

export class SkyRenderer {
  constructor(gl, atlas) {
    this.gl = gl;
    this.atlas = atlas;

    this.skyShader = new Shader(gl, SKY_VS, SKY_FS, 'sky');
    this.celestialShader = new Shader(gl, CELESTIAL_VS, CELESTIAL_FS, 'celestial');
    this.cloudShader = new Shader(gl, CLOUD_VS, CLOUD_FS, 'cloud');

    this._sunDir = new Float32Array(3);
    this._layers = null;        // resolved once the atlas has been built

    // --- dome ---
    const dome = buildDome(16, 32);
    this.domeCount = dome.idx.length;
    this.domeVAO = gl.createVertexArray();
    this.domeVBO = gl.createBuffer();
    this.domeIBO = gl.createBuffer();
    gl.bindVertexArray(this.domeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.domeVBO);
    gl.bufferData(gl.ARRAY_BUFFER, dome.pos, gl.STATIC_DRAW);
    this._attrib(this.skyShader, 'aPos', 3, 12, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.domeIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, dome.idx, gl.STATIC_DRAW);

    // --- sun/moon billboard ---
    this.quadVAO = gl.createVertexArray();
    this.quadVBO = gl.createBuffer();
    this.quadIBO = gl.createBuffer();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this._attrib(this.celestialShader, 'aCorner', 2, 8, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    // --- clouds ---
    this.cloudData = new DynamicBuffer(Float32Array, 1 << 16);
    this.cloudVertices = 0;
    this.cloudVAO = gl.createVertexArray();
    this.cloudVBO = gl.createBuffer();
    gl.bindVertexArray(this.cloudVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVBO);
    this._attrib(this.cloudShader, 'aPos', 3, 24, 0);
    this._attrib(this.cloudShader, 'aNormal', 3, 24, 12);
    gl.bindVertexArray(null);

    this._cloudCX = NaN;
    this._cloudCZ = NaN;
    this._cloudMode = '';
  }

  _attrib(shader, name, size, stride, offset) {
    const loc = shader.attrib(name);
    if (loc < 0) return;
    this.gl.enableVertexAttribArray(loc);
    this.gl.vertexAttribPointer(loc, size, this.gl.FLOAT, false, stride, offset);
  }

  /** Atlas layers are resolved lazily — the atlas is painted after startup. */
  _celestialLayers() {
    if (!this._layers && this.atlas?.layers) {
      this._layers = { sun: this.atlas.layerOf('sun'), moon: this.atlas.layerOf('moon') };
    }
    return this._layers;
  }

  render(camera, frameInfo = {}, world = null) {
    const gl = this.gl;
    const timeOfDay = frameInfo.timeOfDay ?? world?.timeOfDay ?? 0;
    const tint = frameInfo.skyTint ?? world?.skyTint ?? null;
    const underwater = !!frameInfo.underwater;

    const sc = skyColors(timeOfDay, tint);
    const dir = sunDirection(timeOfDay, this._sunDir);
    const elev = dir[1];

    // Submerged, everything collapses to the fog colour — no sun, no clouds.
    const top = underwater ? sc.fog : sc.top;
    const horizon = underwater ? sc.fog : sc.horizon;
    const sunsetStrength = underwater ? 0 : sc.sunsetStrength;
    const starAlpha = underwater ? 0 : sc.starAlpha;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const sky = this.skyShader.use();
    sky.mat4('uViewProj', camera.viewProj);
    sky.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
    sky.vec3('uSkyTop', hexToRgb(top));
    sky.vec3('uSkyHorizon', hexToRgb(horizon));
    sky.vec3('uSunsetColor', hexToRgb(sc.sunset));
    sky.float('uSunsetStrength', sunsetStrength);
    sky.vec3('uSunDir', dir[0], dir[1], dir[2]);
    sky.float('uStarAlpha', starAlpha);
    gl.bindVertexArray(this.domeVAO);
    gl.drawElements(gl.TRIANGLES, this.domeCount, gl.UNSIGNED_SHORT, 0);

    const layers = this._celestialLayers();
    if (!underwater && layers && this.atlas.texture) {
      gl.enable(gl.BLEND);
      const cel = this.celestialShader.use();
      cel.mat4('uViewProj', camera.viewProj);
      cel.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
      cel.int('uAtlas', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);
      gl.bindVertexArray(this.quadVAO);

      const sunAlpha = clamp((elev + 0.18) / 0.18, 0, 1);
      if (sunAlpha > 0.01) {
        // Additive: the sun is a light source, not a sticker on the sky.
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        cel.vec3('uDir', dir[0], dir[1], dir[2]);
        cel.float('uSize', SUN_SIZE);
        cel.float('uLayer', layers.sun);
        cel.float('uAlpha', sunAlpha);
        cel.vec3('uColor', hexToRgb(mixHex(0xfff7e0, 0xff8c3a, sc.sunsetStrength)));
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }

      const moonAlpha = clamp((-elev + 0.18) / 0.18, 0, 1) * (0.45 + 0.55 * sc.starAlpha);
      if (moonAlpha > 0.01) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        cel.vec3('uDir', -dir[0], -dir[1], -dir[2]);
        cel.float('uSize', MOON_SIZE);
        cel.float('uLayer', layers.moon);
        cel.float('uAlpha', moonAlpha);
        cel.vec3('uColor', hexToRgb(0xdce4ff));
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
    }

    if (!underwater) this._renderClouds(camera, frameInfo, elev, sc);

    // Hand the terrain pass a clean, conventional state.
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  _renderClouds(camera, frameInfo, elev, sc) {
    const mode = settings.get('clouds');
    if (mode === 'off') return;
    const gl = this.gl;

    // `time` is the frame clock in seconds; fall back to the wall clock so the
    // clouds still drift if a caller omits it.
    const seconds = frameInfo.time ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    const shift = seconds * CLOUD_SPEED;
    const baseCX = Math.floor((camera.pos[0] - shift) / CLOUD_CELL);
    const baseCZ = Math.floor(camera.pos[2] / CLOUD_CELL);
    if (baseCX !== this._cloudCX || baseCZ !== this._cloudCZ || mode !== this._cloudMode) {
      this._buildClouds(baseCX, baseCZ, mode === 'fancy');
      this._cloudCX = baseCX;
      this._cloudCZ = baseCZ;
      this._cloudMode = mode;
    }
    if (!this.cloudVertices) return;

    const light = clamp(0.18 + 0.82 * clamp((elev + 0.3) / 0.45, 0, 1), 0, 1);
    let color = mixHex(0x20263f, 0xffffff, light);
    color = mixHex(color, sc.sunset, sc.sunsetStrength * 0.35);

    const reach = CLOUD_RADIUS_CELLS * CLOUD_CELL;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);   // clouds read as solid banks from inside too

    const sh = this.cloudShader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.vec3('uOffset', baseCX * CLOUD_CELL + shift, WORLD.CLOUD_HEIGHT, baseCZ * CLOUD_CELL);
    sh.vec3('uColor', hexToRgb(color));
    sh.float('uAlpha', CLOUD_ALPHA);
    sh.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
    sh.float('uFadeStart', reach * 0.5);
    sh.float('uFadeEnd', reach * 0.92);

    gl.bindVertexArray(this.cloudVAO);
    gl.drawArrays(gl.TRIANGLES, 0, this.cloudVertices);
  }

  /** Rebuilds the cell grid anchored at (baseCX, baseCZ); local coords only. */
  _buildClouds(baseCX, baseCZ, fancy) {
    const buf = this.cloudData;
    buf.reset();
    const S = CLOUD_CELL;
    const H = fancy ? CLOUD_THICKNESS : 0;
    const R = CLOUD_RADIUS_CELLS;

    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        if (!cloudy(baseCX + i, baseCZ + j)) continue;
        const x0 = i * S;
        const x1 = x0 + S;
        const z0 = j * S;
        const z1 = z0 + S;

        quad(buf, x0, H, z0, x0, H, z1, x1, H, z1, x1, H, z0, 0, 1, 0);
        if (!fancy) continue;

        quad(buf, x0, 0, z1, x0, 0, z0, x1, 0, z0, x1, 0, z1, 0, -1, 0);
        if (!cloudy(baseCX + i + 1, baseCZ + j)) {
          quad(buf, x1, 0, z0, x1, H, z0, x1, H, z1, x1, 0, z1, 1, 0, 0);
        }
        if (!cloudy(baseCX + i - 1, baseCZ + j)) {
          quad(buf, x0, 0, z1, x0, H, z1, x0, H, z0, x0, 0, z0, -1, 0, 0);
        }
        if (!cloudy(baseCX + i, baseCZ + j + 1)) {
          quad(buf, x1, 0, z1, x1, H, z1, x0, H, z1, x0, 0, z1, 0, 0, 1);
        }
        if (!cloudy(baseCX + i, baseCZ + j - 1)) {
          quad(buf, x0, 0, z0, x0, H, z0, x1, H, z0, x1, 0, z0, 0, 0, -1);
        }
      }
    }

    const view = buf.view();
    this.cloudVertices = view.length / 6;
    const gl = this.gl;
    gl.bindVertexArray(this.cloudVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVBO);
    gl.bufferData(gl.ARRAY_BUFFER, view, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteVertexArray(this.domeVAO);
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteVertexArray(this.cloudVAO);
    gl.deleteBuffer(this.domeVBO);
    gl.deleteBuffer(this.domeIBO);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteBuffer(this.quadIBO);
    gl.deleteBuffer(this.cloudVBO);
    this.skyShader.destroy();
    this.celestialShader.destroy();
    this.cloudShader.destroy();
  }
}

/** Appends one quad (two triangles, flat normal) to the cloud vertex stream. */
function quad(buf, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) {
  buf.ensure(36);
  const a = buf.data;
  let o = buf.length;
  a[o++] = ax; a[o++] = ay; a[o++] = az; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  a[o++] = bx; a[o++] = by; a[o++] = bz; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  a[o++] = cx; a[o++] = cy; a[o++] = cz; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  a[o++] = ax; a[o++] = ay; a[o++] = az; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  a[o++] = cx; a[o++] = cy; a[o++] = cz; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  a[o++] = dx; a[o++] = dy; a[o++] = dz; a[o++] = nx; a[o++] = ny; a[o++] = nz;
  buf.length = o;
}
