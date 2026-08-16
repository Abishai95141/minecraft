// Draws every entity in the world: batches by model, poses each one through
// render/models.js, flashes it red while it is hurt, billboards dropped items
// from the block atlas, and lays a soft shadow quad on the ground beneath it.

import { Shader } from './gl.js';
import { ENTITY_VS, ENTITY_FS } from './shaders.js';
import { MODELS, buildModelMesh, animate } from './models.js';
import { atlas } from './atlas.js';
import { SHADOW_SKIN } from './entityskins.js';
import { mat4, clamp, lerp, aabbInFrustum } from '../core/math.js';
import { settings } from '../core/settings.js';
import { lightCurve } from '../core/constants.js';
import { BLOCKS, IS_SOLID, IS_FULL_CUBE } from '../world/blocks.js';
import { drawText, measure, LINE_HEIGHT } from '../ui/font.js';

/** Beyond this an entity is a couple of pixels; skip the pose maths entirely. */
const MAX_DISTANCE = 96;
/** How far below an entity we look for a floor to cast its shadow onto. */
const SHADOW_DROP = 5;
const NAMEPLATE_DISTANCE = 24;
/** floats per vertex in a model mesh: pos3, uv2, normal3, part1. */
const STRIDE_FLOATS = 9;

// ---------------------------------------------------------------- helper meshes

function buildMesh(gl, attribs, verts) {
  const data = new Float32Array(verts);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const stride = STRIDE_FLOATS * 4;
  const bind = (loc, size, offset) => {
    if (loc === undefined || loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  };
  bind(attribs.aPos, 3, 0);
  bind(attribs.aUV, 2, 12);
  bind(attribs.aNormal, 3, 20);
  bind(attribs.aPart, 1, 32);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    vao,
    vbo,
    vertexCount: data.length / STRIDE_FLOATS,
    destroy() { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); },
  };
}

/** Two triangles from four corners given CCW as seen from outside. */
function pushFace(out, c, n) {
  const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    out.push(c[i][0], c[i][1], c[i][2], uv[i][0], uv[i][1], n[0], n[1], n[2], 0);
  }
}

/** A 1x1 quad in the XZ plane, used for ground shadows. */
function groundQuad(gl, attribs) {
  const v = [];
  pushFace(v, [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]], [0, 1, 0]);
  return buildMesh(gl, attribs, v);
}

/** A 1x1 upright quad facing +Z, used for flat item sprites. */
function uprightQuad(gl, attribs) {
  const v = [];
  pushFace(v, [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [0, 0, 1]);
  return buildMesh(gl, attribs, v);
}

/** A 1x1 cube whose every face samples the whole texture — block drops. */
function unitCube(gl, attribs) {
  const v = [];
  const a = 0.5;
  pushFace(v, [[-a, -a, a], [a, -a, a], [a, a, a], [-a, a, a]], [0, 0, 1]);
  pushFace(v, [[a, -a, -a], [-a, -a, -a], [-a, a, -a], [a, a, -a]], [0, 0, -1]);
  pushFace(v, [[a, -a, a], [a, -a, -a], [a, a, -a], [a, a, a]], [1, 0, 0]);
  pushFace(v, [[-a, -a, -a], [-a, -a, a], [-a, a, a], [-a, a, -a]], [-1, 0, 0]);
  pushFace(v, [[-a, a, a], [a, a, a], [a, a, -a], [-a, a, -a]], [0, 1, 0]);
  pushFace(v, [[-a, -a, -a], [a, -a, -a], [a, -a, a], [-a, -a, a]], [0, -1, 0]);
  return buildMesh(gl, attribs, v);
}

// ---------------------------------------------------------------- entity queries

/** The model key an entity draws with, or null when it is not a model at all. */
function modelFor(e) {
  if (e.isPlayer || e.type === 'player') return 'player';
  if (e.model && MODELS[e.model]) return e.model;
  if (e.type && MODELS[e.type]) return e.type;
  return null;
}

/** Prefer a skin named after the exact mob, so a husk is not just a zombie. */
function skinFor(skins, e, modelName) {
  if (e.skin && skins.has(e.skin)) return e.skin;
  if (e.type && skins.has(e.type)) return e.type;
  return modelName;
}

function atlasHas(name) {
  return !!(name && atlas.index && atlas.index.has(name));
}

/** The side texture of a block, however its `tex` field happens to be written. */
function blockTexture(id) {
  const b = BLOCKS[id];
  if (!b) return null;
  const t = b.tex;
  let key = null;
  if (typeof t === 'string') key = t;
  else if (t && typeof t === 'object') key = t.side ?? t.north ?? t.top ?? null;
  if (!key || !atlasHas(key)) key = b.name;
  return atlasHas(key) ? key : null;
}

/**
 * Atlas texture for a dropped stack or an arrow. Writes `spriteKey` and
 * `spriteCube` into the caller's record and returns true, or returns false to
 * fall back to a model. The record is pooled, so this allocates nothing.
 */
function spriteTexture(e, rec) {
  if (e.type === 'arrow') {
    if (!atlasHas('arrow')) return false;
    rec.spriteKey = 'arrow';
    rec.spriteCube = false;
    return true;
  }
  const stack = e.stack;
  if (!stack || stack.isEmpty) return false;
  const def = stack.item;
  if (!def) return false;

  // Full cubes tumble as little blocks; everything else is a flat sprite.
  if (def.block && IS_FULL_CUBE[def.block]) {
    const key = blockTexture(def.block);
    if (key) {
      rec.spriteKey = key;
      rec.spriteCube = true;
      return true;
    }
  }
  const flat = def.tex || def.name;
  if (atlasHas(flat)) {
    rec.spriteKey = flat;
    rec.spriteCube = false;
    return true;
  }
  const fallback = def.block ? blockTexture(def.block) : null;
  if (!fallback) return false;
  rec.spriteKey = fallback;
  rec.spriteCube = false;
  return true;
}

/** Vanilla's light curve on the CPU, matching what the chunk shader does. */
function brightnessAt(world, x, y, z, frameInfo) {
  let level = 15;
  if (world) {
    const bx = Math.floor(x);
    const by = Math.floor(y + 0.6);
    const bz = Math.floor(z);
    const sky = (world.getSkyLight(bx, by, bz) ?? 15) * (frameInfo.skyLight ?? 1);
    const block = world.getBlockLight(bx, by, bz) ?? 0;
    level = Math.max(sky, block);
  }
  let b = lightCurve(level, 0.05);
  b = lerp(b, b * 0.6 + 0.4, (frameInfo.gamma ?? 0) * 0.55);
  b = Math.max(b, frameInfo.nightVision ?? 0);
  return clamp(b + 0.03, 0, 1);
}

/** Highest solid block top under a position, or null when there is nothing near. */
function groundBelow(world, x, y, z) {
  if (!world) return null;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const start = Math.floor(y + 0.05);
  for (let i = 0; i <= SHADOW_DROP; i++) {
    const id = world.getBlock(bx, start - i, bz);
    if (id && IS_SOLID[id]) return start - i + 1;
  }
  return null;
}

function nameplateFor(e) {
  if (e.customName) return e.customName;
  if (e.nameTag) return e.nameTag;
  if (e.showName) return e.displayName || e.name || null;
  if (e.isNpc || e.type === 'npc') return e.name || e.displayName || null;
  return null;
}

// ---------------------------------------------------------------- renderer

export class EntityRenderer {
  constructor(gl, skins) {
    this.gl = gl;
    this.skins = skins;
    this.shader = new Shader(gl, ENTITY_VS, ENTITY_FS, 'entity');

    const attribs = {
      aPos: this.shader.attrib('aPos'),
      aUV: this.shader.attrib('aUV'),
      aNormal: this.shader.attrib('aNormal'),
      aPart: this.shader.attrib('aPart'),
    };
    this.attribs = attribs;

    /** @type {Map<string, object>} model name -> static VAO */
    this.meshes = new Map();
    for (const name of Object.keys(MODELS)) {
      this.meshes.set(name, buildModelMesh(gl, MODELS[name], attribs));
    }
    this.shadowMesh = groundQuad(gl, attribs);
    this.spriteMesh = uprightQuad(gl, attribs);
    this.cubeMesh = unitCube(gl, attribs);

    // uParts wants all 16 slots; sprites only ever use slot 0.
    this.flatParts = new Float32Array(16 * 16);
    for (let i = 0; i < 16; i++) {
      const o = i * 16;
      this.flatParts[o] = 1;
      this.flatParts[o + 5] = 1;
      this.flatParts[o + 10] = 1;
      this.flatParts[o + 15] = 1;
    }

    this._model = mat4.create();
    /** @type {Map<string, object[]>} */
    this._batches = new Map();
    this._sprites = [];
    this._visible = [];
    // Per-entity records are pooled: the collect pass runs every frame and has
    // no business handing the GC a fresh object per mob.
    this._pool = [];
    this._used = 0;
    this.stats = { entities: 0, sprites: 0, shadows: 0 };
  }

  // ------------------------------------------------------------ main pass

  render(camera, frameInfo = {}, entities = null, player = null) {
    this.stats.entities = 0;
    this.stats.sprites = 0;
    this.stats.shadows = 0;
    if (!camera || !entities || entities.length === 0) return;

    const skins = this.skins;
    if (!skins || !skins.texture) return;

    const gl = this.gl;
    const pt = clamp(frameInfo.partialTicks ?? 0, 0, 1);
    const firstPerson = !player || (player.perspective ?? 0) === 0;
    const world = player?.world ?? entities[0]?.world ?? null;

    this._collect(camera, entities, player, firstPerson, pt);
    if (this._visible.length === 0) return;

    const sh = this.shader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
    sh.int('uSkins', 0);
    sh.float('uAlpha', 1);
    const fog = frameInfo.fogColor || [0.7, 0.8, 1];
    sh.vec3('uFogColor', fog[0], fog[1], fog[2]);
    sh.float('uFogStart', frameInfo.fogStart ?? 1e6);
    sh.float('uFogEnd', frameInfo.fogEnd ?? 1e6 + 1);
    sh.float('uFogDensity', frameInfo.fogDensity ?? 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, skins.texture);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    this._drawModels(sh, world, frameInfo, pt);
    if (this._sprites.length) this._drawSprites(sh, camera, world, frameInfo, pt);
    if (settings.get('entityShadows')) this._drawShadows(sh, world, skins);

    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Next free pooled record. It is only claimed once the entity survives every
   * cull, so a rejected entity costs nothing and the pool settles at the peak
   * number of entities ever visible at once.
   */
  _record() {
    let rec = this._pool[this._used];
    if (!rec) {
      rec = { e: null, x: 0, y: 0, z: 0, yaw: 0, sprite: false, spriteKey: null, spriteCube: false };
      this._pool.push(rec);
    }
    return rec;
  }

  /** Buckets the visible entities by model, interpolating each one once. */
  _collect(camera, entities, player, firstPerson, pt) {
    for (const list of this._batches.values()) list.length = 0;
    this._sprites.length = 0;
    this._visible.length = 0;
    this._used = 0;

    const cx = camera.pos[0];
    const cy = camera.pos[1];
    const cz = camera.pos[2];
    const maxSq = MAX_DISTANCE * MAX_DISTANCE;

    for (const e of entities) {
      if (!e) continue;
      if (e === player && firstPerson) continue;

      const dxr = e.x - cx;
      const dyr = e.y - cy;
      const dzr = e.z - cz;
      if (dxr * dxr + dyr * dyr + dzr * dzr > maxSq) continue;

      const rec = this._record();
      const sprite = spriteTexture(e, rec);
      const modelName = sprite ? null : modelFor(e);
      if (!sprite && !modelName) continue;

      // A bare {x,y,z} entity has nothing to interpolate; read it in place.
      const it = e.interpolate ? e.interpolate(pt) : e;

      // Pad the box generously: arms swing well outside a mob's collision box.
      const half = Math.max(e.width ?? 0.6, 0.6) * 0.5 + 0.75;
      const top = (e.height ?? 1.8) + 0.9;
      if (!aabbInFrustum(camera.frustum,
        it.x - half, it.y - 0.6, it.z - half,
        it.x + half, it.y + top, it.z + half)) continue;

      rec.e = e;
      rec.x = it.x;
      rec.y = it.y;
      rec.z = it.z;
      rec.yaw = it.yaw ?? 0;
      rec.sprite = sprite;
      this._used++;
      this._visible.push(rec);
      if (sprite) {
        this._sprites.push(rec);
      } else {
        let list = this._batches.get(modelName);
        if (!list) { list = []; this._batches.set(modelName, list); }
        list.push(rec);
      }
    }
  }

  _drawModels(sh, world, frameInfo, pt) {
    const gl = this.gl;
    const skins = this.skins;
    for (const [name, list] of this._batches) {
      if (list.length === 0) continue;
      const mesh = this.meshes.get(name);
      if (!mesh) continue;
      gl.bindVertexArray(mesh.vao);

      for (const rec of list) {
        const e = rec.e;
        sh.float('uLayer', skins.layerOf(skinFor(skins, e, name)));
        sh.float('uBrightness', this._brightness(e, world, rec, frameInfo));
        this._setOverlay(sh, e);

        const m = this._model;
        mat4.identity(m);
        mat4.translate(m, m, rec.x, rec.y, rec.z);
        mat4.rotateY(m, m, -rec.yaw);
        sh.mat4('uModel', m);
        sh.mat4('uParts', animate(name, e, pt));

        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
        this.stats.entities++;
      }
    }
  }

  _brightness(e, world, rec, frameInfo) {
    const b = brightnessAt(world, rec.x, rec.y, rec.z, frameInfo);
    // The warden carries its own light, so it never dissolves into a dark room.
    return e.boss || e.type === 'hollow_warden' ? Math.max(b, 0.55) : b;
  }

  _setOverlay(sh, e) {
    if ((e.hurtTime ?? 0) > 0) { sh.vec4('uOverlayColor', 1, 0.28, 0.24, 0.4); return; }
    const fuse = e.fuseTime ?? e.fuse ?? 0;
    if (fuse > 0) {
      // Creepers wash out to white on a rising throb before they go off.
      const swell = clamp(fuse / (e.maxFuse ?? 30), 0, 1);
      const throb = Math.sin(fuse * 1.6) * 0.5 + 0.5;
      sh.vec4('uOverlayColor', 1, 1, 1, swell * (0.2 + 0.5 * throb));
      return;
    }
    sh.vec4('uOverlayColor', 0, 0, 0, 0);
  }

  /** Dropped stacks and arrows, drawn straight off the block atlas. */
  _drawSprites(sh, camera, world, frameInfo, pt) {
    const gl = this.gl;
    if (!atlas.texture) return;

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.texture);
    gl.disable(gl.CULL_FACE);
    sh.mat4('uParts', this.flatParts);
    sh.vec4('uOverlayColor', 0, 0, 0, 0);

    const cx = camera.pos[0];
    const cz = camera.pos[2];
    let bound = null;

    for (const rec of this._sprites) {
      const e = rec.e;
      const mesh = rec.spriteCube ? this.cubeMesh : this.spriteMesh;
      if (bound !== mesh) { gl.bindVertexArray(mesh.vao); bound = mesh; }

      const bob = e.prevBob !== undefined ? lerp(e.prevBob, e.bob, pt) : 0;
      const lift = e.stack ? Math.sin(bob) * 0.06 + 0.16 : 0;
      const m = this._model;
      mat4.identity(m);
      mat4.translate(m, m, rec.x, rec.y + lift, rec.z);
      if (rec.spriteCube && e.prevSpin !== undefined) {
        mat4.rotateY(m, m, lerp(e.prevSpin, e.spin, pt));
      } else {
        // Flat sprites always turn their face to the camera.
        mat4.rotateY(m, m, Math.atan2(cx - rec.x, cz - rec.z));
      }
      const s = rec.spriteCube ? 0.4 : 0.45;
      mat4.scale(m, m, s, s, s);
      sh.mat4('uModel', m);

      sh.float('uLayer', atlas.layerOf(rec.spriteKey));
      sh.float('uBrightness', brightnessAt(world, rec.x, rec.y, rec.z, frameInfo));
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      this.stats.sprites++;
    }

    gl.enable(gl.CULL_FACE);
  }

  _drawShadows(sh, world, skins) {
    if (!world) return;
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, skins.texture);
    gl.bindVertexArray(this.shadowMesh.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    // The quad sits on the floor, so nudge it toward the eye to beat z-fighting.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1.5, -1.5);

    sh.float('uLayer', skins.layerOf(SHADOW_SKIN));
    sh.float('uBrightness', 1);
    sh.vec4('uOverlayColor', 0, 0, 0, 0);
    sh.mat4('uParts', this.flatParts);

    for (const rec of this._visible) {
      const e = rec.e;
      if (e.noShadow) continue;
      const gy = groundBelow(world, rec.x, rec.y, rec.z);
      if (gy === null) continue;

      const drop = rec.y - gy;
      if (drop < -0.5 || drop > SHADOW_DROP) continue;
      const fade = clamp(1 - drop / SHADOW_DROP, 0, 1);
      const size = clamp((e.width ?? 0.6) * 1.7, 0.4, 3.5) * (0.7 + fade * 0.3);

      const m = this._model;
      mat4.identity(m);
      mat4.translate(m, m, rec.x, gy + 0.02, rec.z);
      mat4.scale(m, m, size, 1, size);
      sh.mat4('uModel', m);
      sh.float('uAlpha', 0.6 * fade);
      gl.drawArrays(gl.TRIANGLES, 0, this.shadowMesh.vertexCount);
      this.stats.shadows++;
    }

    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    sh.float('uAlpha', 1);
  }

  // ------------------------------------------------------------ 2D pass

  /**
   * Nameplates, drawn on the UI canvas after the world. `ctx` arrives already
   * scaled by the GUI scale, so everything here is in GUI pixels.
   */
  renderNameplates(ctx, camera, entities, guiScale = 1) {
    if (!ctx || !camera || !entities) return;
    const t = ctx.getTransform ? ctx.getTransform() : null;
    const scale = t && t.a ? t.a : guiScale;
    const w = ctx.canvas.width / scale;
    const h = ctx.canvas.height / scale;
    const m = camera.viewProj;
    const maxSq = NAMEPLATE_DISTANCE * NAMEPLATE_DISTANCE;

    for (const e of entities) {
      if (!e || e.isPlayer) continue;
      const label = nameplateFor(e);
      if (!label) continue;

      const dx = e.x - camera.pos[0];
      const dy = e.y - camera.pos[1];
      const dz = e.z - camera.pos[2];
      if (dx * dx + dy * dy + dz * dz > maxSq) continue;

      const px = e.x;
      const py = e.y + (e.height ?? 1.8) + 0.55;
      const pz = e.z;
      const clipW = m[3] * px + m[7] * py + m[11] * pz + m[15];
      if (clipW <= 0.001) continue;
      const clipX = m[0] * px + m[4] * py + m[8] * pz + m[12];
      const clipY = m[1] * px + m[5] * py + m[9] * pz + m[13];

      const sx = Math.round((clipX / clipW * 0.5 + 0.5) * w);
      const sy = Math.round((0.5 - clipY / clipW * 0.5) * h);
      if (sx < -80 || sy < -20 || sx > w + 80 || sy > h + 20) continue;

      const tw = measure(label);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(sx - tw / 2 - 2, sy - 2, tw + 4, LINE_HEIGHT);
      drawText(ctx, label, sx, sy, { color: 0xffffff, align: 'center', shadow: false });
    }
  }

  destroy() {
    for (const mesh of this.meshes.values()) mesh.destroy();
    this.meshes.clear();
    this.shadowMesh.destroy();
    this.spriteMesh.destroy();
    this.cubeMesh.destroy();
    this.shader.destroy();
    this._batches.clear();
    this._sprites.length = 0;
    this._visible.length = 0;
    this._pool.length = 0;
    this._used = 0;
  }
}
