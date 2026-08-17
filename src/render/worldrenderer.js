// The terrain renderer. Owns every chunk-section mesh on the GPU: the meshing
// queue and its per-frame budget, per-section frustum culling, the three draw
// passes, and the selection / block-breaking decals drawn over the world.

import { Shader } from './gl.js';
import { CHUNK_VS, CHUNK_FS, LINE_VS, LINE_FS, BREAK_VS, BREAK_FS } from './shaders.js';
import { meshSection } from './mesher.js';
import { mat4, aabbInFrustum, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { CHUNK_SIZE, SECTION_HEIGHT, SECTION_COUNT, MIN_Y, chunkKey } from '../world/chunk.js';
import { FACE_VERTS, FACE_UVS } from '../world/blocks.js';

const PASS_OPAQUE = 0;
const PASS_CUTOUT = 1;
const PASS_TRANSLUCENT = 2;
const PASS_COUNT = 3;

/** 4096 blocks x 24 quads is the most geometry one section can ever emit. */
const MAX_QUADS = 98304;
/** Sections meshed and uploaded per frame. Streaming must never own a frame. */
const MESH_BUDGET = 10;

/** pos3 + uv2 + layer + overlay, all uint16. */
const STRIDE_U16 = 14;
/** sky, block, shade, flags, tintRGB, pad — all uint8. */
const STRIDE_U8 = 8;

/** Cross-shaped plants wander up to 0.15 out of their cell; keep them visible. */
const CULL_MARGIN = 0.5;
const SELECTION_INFLATE = 0.002;
const BREAK_INFLATE = 0.0035;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sectionKey = (cx, cz, si) => `${cx},${cz},${si}`;

/** Fallback fog when `frameInfo` carries none; hoisted so `render` never allocates. */
const DEFAULT_FOG = [0.7, 0.8, 1];

/** The twelve edges of the unit cube, as GL_LINES vertex pairs. */
const LINE_CUBE = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
  0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0,
  0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1,
]);

/** One section's GPU residency: up to three VAOs, one per terrain pass. */
class SectionMesh {
  constructor(cx, cz, si) {
    this.cx = cx;
    this.cz = cz;
    this.si = si;

    // Vertex positions are chunk-local in 1/32 units with y measured from the
    // bottom of the world, so the origin is the chunk column, not the section.
    this.originX = cx * CHUNK_SIZE;
    this.originY = MIN_Y;
    this.originZ = cz * CHUNK_SIZE;

    this.minX = this.originX;
    this.minY = MIN_Y + si * SECTION_HEIGHT;
    this.minZ = this.originZ;
    this.maxX = this.minX + CHUNK_SIZE;
    this.maxY = this.minY + SECTION_HEIGHT;
    this.maxZ = this.minZ + CHUNK_SIZE;

    this.centerX = this.minX + CHUNK_SIZE / 2;
    this.centerY = this.minY + SECTION_HEIGHT / 2;
    this.centerZ = this.minZ + CHUNK_SIZE / 2;

    this.vao = [null, null, null];
    this.bufU16 = [null, null, null];
    this.bufU8 = [null, null, null];
    this.quads = [0, 0, 0];

    /** Squared distance from the camera, refreshed each cull. */
    this.dist = 0;
  }

  get quadCount() { return this.quads[0] + this.quads[1] + this.quads[2]; }
}

export class WorldRenderer {
  constructor(gl, atlas) {
    this.gl = gl;
    this.atlas = atlas;
    this.world = null;

    this.chunkShader = new Shader(gl, CHUNK_VS, CHUNK_FS, 'chunk');
    this.lineShader = new Shader(gl, LINE_VS, LINE_FS, 'line');
    this.breakShader = new Shader(gl, BREAK_VS, BREAK_FS, 'break');

    /** @type {Map<string, SectionMesh>} */
    this._sections = new Map();
    /** @type {Map<string, {chunk:object, si:number, key:string, dist:number}>} */
    this._pending = new Map();
    /** Live section count per chunk column, so `stats.chunks` stays O(1). */
    this._chunkCounts = new Map();

    /** Visible sections per pass, rebuilt every `update`. */
    this._visible = [[], [], []];
    this._sortQueue = [];

    this._drawCalls = 0;
    this._quadsDrawn = 0;
    this._meshTimeMs = 0;

    this._model = mat4.create();
    this._destroyed = false;

    /** `destroy_stage_0..9` layer indices, resolved once the atlas is built. */
    this._breakLayers = null;
    this._breakLayerEpoch = -1;

    this.indexBuffer = this._buildIndexBuffer();
    this._buildLineCube();
    this._buildBreakCube();
  }

  // ================================================================ static GL objects

  /**
   * One shared, static index buffer for every section in the world: quads are
   * always `0,1,2, 0,2,3`, so no section needs its own. Uint32 because a full
   * section can exceed 65535 vertices.
   */
  _buildIndexBuffer() {
    const gl = this.gl;
    const idx = new Uint32Array(MAX_QUADS * 6);
    let i = 0;
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2;
      idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3;
    }
    const buf = gl.createBuffer();
    // Fill it through the default VAO so no section VAO records the binding.
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return buf;
  }

  _buildLineCube() {
    const gl = this.gl;
    this.lineVAO = gl.createVertexArray();
    this.lineVBO = gl.createBuffer();
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
    gl.bufferData(gl.ARRAY_BUFFER, LINE_CUBE, gl.STATIC_DRAW);
    this._ptr(this.lineShader, 'aPos', 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.lineVertexCount = LINE_CUBE.length / 3;
  }

  /** A textured unit cube, wound from `FACE_VERTS` so the winding can't drift. */
  _buildBreakCube() {
    const gl = this.gl;
    const verts = new Float32Array(6 * 4 * 5);
    const idx = new Uint16Array(6 * 6);
    let p = 0;
    let i = 0;
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const pos = FACE_VERTS[f][v];
        const uv = FACE_UVS[f][v];
        verts[p++] = pos[0];
        verts[p++] = pos[1];
        verts[p++] = pos[2];
        verts[p++] = uv[0];
        verts[p++] = uv[1];
      }
      const b = f * 4;
      idx[i++] = b; idx[i++] = b + 1; idx[i++] = b + 2;
      idx[i++] = b; idx[i++] = b + 2; idx[i++] = b + 3;
    }

    this.breakVAO = gl.createVertexArray();
    this.breakVBO = gl.createBuffer();
    this.breakIBO = gl.createBuffer();
    gl.bindVertexArray(this.breakVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.breakVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    this._ptr(this.breakShader, 'aPos', 3, gl.FLOAT, false, 20, 0);
    this._ptr(this.breakShader, 'aUV', 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.breakIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.breakIndexCount = idx.length;
  }

  _ptr(shader, name, size, type, normalized, stride, offset) {
    const loc = shader.attrib(name);
    if (loc < 0) return;
    this.gl.enableVertexAttribArray(loc);
    this.gl.vertexAttribPointer(loc, size, type, normalized, stride, offset);
  }

  // ================================================================ world binding

  setWorld(world) {
    const next = world || null;
    // The same world arrives again whenever render distance changes; throwing
    // away every mesh for that would blank the screen for several seconds.
    if (next === this.world) return;
    this.clear();
    this.world = next;
  }

  /** Drops every mesh and queued rebuild, freeing the GL objects behind them. */
  clear() {
    for (const sec of this._sections.values()) this._freeSection(sec);
    this._sections.clear();
    this._chunkCounts.clear();
    this._pending.clear();
    for (let p = 0; p < PASS_COUNT; p++) this._visible[p].length = 0;
  }

  markSectionDirty(chunk, si) {
    if (!chunk || si < 0 || si >= SECTION_COUNT) return;
    const key = sectionKey(chunk.cx, chunk.cz, si);
    const existing = this._pending.get(key);
    if (existing) { existing.chunk = chunk; return; }
    this._pending.set(key, { chunk, si, key, dist: 0 });
  }

  removeChunk(chunk) {
    if (!chunk) return;
    for (let si = 0; si < SECTION_COUNT; si++) {
      const key = sectionKey(chunk.cx, chunk.cz, si);
      this._pending.delete(key);
      const sec = this._sections.get(key);
      if (sec) this._dropSection(key, sec);
      if (chunk.meshes) chunk.meshes[si] = null;
    }
  }

  // ================================================================ per-frame update

  /** Uploads the nearest queued meshes, then culls and sorts for `render`. */
  update(camera, dtSeconds = 0) {
    const start = now();
    if (this.world) this._drainQueue(camera);
    this._meshTimeMs = now() - start;
    this._cull(camera);
  }

  _drainQueue(camera) {
    const pending = this._pending;
    if (pending.size === 0) return;

    const cam = camera?.pos;
    const cx = cam ? cam[0] : 0;
    const cy = cam ? cam[1] : 0;
    const cz = cam ? cam[2] : 0;

    // Rebuild what the player is standing in first; a chunk that was unloaded
    // while queued is dropped rather than meshed against a stale reference.
    const list = this._sortQueue;
    list.length = 0;
    for (const entry of pending.values()) {
      const chunk = entry.chunk;
      if (this.world.getChunk(chunk.cx, chunk.cz) !== chunk) {
        pending.delete(entry.key);
        continue;
      }
      const dx = chunk.x0 + CHUNK_SIZE / 2 - cx;
      const dy = MIN_Y + entry.si * SECTION_HEIGHT + SECTION_HEIGHT / 2 - cy;
      const dz = chunk.z0 + CHUNK_SIZE / 2 - cz;
      entry.dist = dx * dx + dy * dy + dz * dz;
      list.push(entry);
    }

    if (list.length > MESH_BUDGET) list.sort(nearFirst);
    const count = Math.min(MESH_BUDGET, list.length);
    for (let i = 0; i < count; i++) {
      const entry = list[i];
      pending.delete(entry.key);
      this._buildSection(entry.chunk, entry.si);
    }
    list.length = 0;
  }

  _buildSection(chunk, si) {
    const key = sectionKey(chunk.cx, chunk.cz, si);
    const data = meshSection(this.world, chunk, si);

    if (!data || data.empty) {
      const stale = this._sections.get(key);
      if (stale) this._dropSection(key, stale);
      if (chunk.meshes) chunk.meshes[si] = null;
      return;
    }

    let sec = this._sections.get(key);
    if (!sec) {
      sec = new SectionMesh(chunk.cx, chunk.cz, si);
      this._sections.set(key, sec);
      this._bumpChunk(chunk.cx, chunk.cz, 1);
    }

    this._uploadPass(sec, PASS_OPAQUE, data.opaque);
    this._uploadPass(sec, PASS_CUTOUT, data.cutout);
    this._uploadPass(sec, PASS_TRANSLUCENT, data.translucent);
    this.gl.bindVertexArray(null);

    if (chunk.meshes) chunk.meshes[si] = sec;
  }

  /**
   * Wires one pass of one section: the u16 stream (position/uv/layer/overlay)
   * and the u8 stream (light/shade/flags/tint) share a VAO with the global
   * index buffer, so drawing a section costs one bind and one draw call.
   */
  _uploadPass(sec, pass, data) {
    const gl = this.gl;
    const quads = data ? Math.min(data.quadCount, MAX_QUADS) : 0;
    if (quads <= 0) {
      this._freePass(sec, pass);
      return;
    }

    let vao = sec.vao[pass];
    if (!vao) {
      vao = gl.createVertexArray();
      sec.vao[pass] = vao;
      sec.bufU16[pass] = gl.createBuffer();
      sec.bufU8[pass] = gl.createBuffer();

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sec.bufU16[pass]);
      this._ptr(this.chunkShader, 'aPos', 3, gl.UNSIGNED_SHORT, false, STRIDE_U16, 0);
      this._ptr(this.chunkShader, 'aUV', 2, gl.UNSIGNED_SHORT, false, STRIDE_U16, 6);
      this._ptr(this.chunkShader, 'aLayer', 1, gl.UNSIGNED_SHORT, false, STRIDE_U16, 10);
      this._ptr(this.chunkShader, 'aOverlay', 1, gl.UNSIGNED_SHORT, false, STRIDE_U16, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, sec.bufU8[pass]);
      // Light and tint arrive normalised so the shader reads plain 0..1 floats;
      // the flag bits must not be, or the water animation test never fires.
      this._ptr(this.chunkShader, 'aLight', 3, gl.UNSIGNED_BYTE, true, STRIDE_U8, 0);
      this._ptr(this.chunkShader, 'aFlags', 1, gl.UNSIGNED_BYTE, false, STRIDE_U8, 3);
      this._ptr(this.chunkShader, 'aTint', 3, gl.UNSIGNED_BYTE, true, STRIDE_U8, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    } else {
      gl.bindVertexArray(vao);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, sec.bufU16[pass]);
    gl.bufferData(gl.ARRAY_BUFFER, data.u16, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, sec.bufU8[pass]);
    gl.bufferData(gl.ARRAY_BUFFER, data.u8, gl.STATIC_DRAW);
    sec.quads[pass] = quads;
  }

  _cull(camera) {
    const vis = this._visible;
    for (let p = 0; p < PASS_COUNT; p++) vis[p].length = 0;
    if (!this.world || !camera) return;

    const planes = camera.frustum;
    const cam = camera.pos;
    const cx = cam ? cam[0] : 0;
    const cy = cam ? cam[1] : 0;
    const cz = cam ? cam[2] : 0;

    // Anything past the render distance is fully fogged, so it is wasted work.
    const chunks = settings.get('renderDistance') || 8;
    const reach = chunks * CHUNK_SIZE + CHUNK_SIZE;
    const reachSq = reach * reach;

    for (const sec of this._sections.values()) {
      if (sec.quadCount === 0) continue;

      const dx = cx < sec.minX ? sec.minX - cx : cx > sec.maxX ? cx - sec.maxX : 0;
      const dz = cz < sec.minZ ? sec.minZ - cz : cz > sec.maxZ ? cz - sec.maxZ : 0;
      if (dx * dx + dz * dz > reachSq) continue;

      if (planes && !aabbInFrustum(
        planes,
        sec.minX - CULL_MARGIN, sec.minY - CULL_MARGIN, sec.minZ - CULL_MARGIN,
        sec.maxX + CULL_MARGIN, sec.maxY + CULL_MARGIN, sec.maxZ + CULL_MARGIN,
      )) continue;

      const ex = sec.centerX - cx;
      const ey = sec.centerY - cy;
      const ez = sec.centerZ - cz;
      sec.dist = ex * ex + ey * ey + ez * ez;

      if (sec.quads[PASS_OPAQUE]) vis[PASS_OPAQUE].push(sec);
      if (sec.quads[PASS_CUTOUT]) vis[PASS_CUTOUT].push(sec);
      if (sec.quads[PASS_TRANSLUCENT]) vis[PASS_TRANSLUCENT].push(sec);
    }

    // Near-to-far on the solid passes lets early-Z throw away most of the
    // world; far-to-near on water so overlapping surfaces blend in order.
    vis[PASS_OPAQUE].sort(nearFirst);
    vis[PASS_CUTOUT].sort(nearFirst);
    vis[PASS_TRANSLUCENT].sort(farFirst);
  }

  // ================================================================ drawing

  render(camera, frameInfo) {
    const gl = this.gl;
    this._drawCalls = 0;
    this._quadsDrawn = 0;
    if (!this.world || !camera || !this.atlas?.texture) return;
    const fi = frameInfo || {};

    const sh = this.chunkShader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.vec3('uCameraPos', camera.pos[0], camera.pos[1], camera.pos[2]);
    sh.float('uTime', fi.time ?? 0);
    sh.int('uAtlas', 0);

    sh.float('uSkyLight', fi.skyLight ?? 1);
    sh.float('uGamma', fi.gamma ?? 0.5);
    sh.float('uNightVision', fi.nightVision ?? 0);

    const fog = fi.fogColor || DEFAULT_FOG;
    sh.vec3('uFogColor', fog[0], fog[1], fog[2]);
    sh.float('uFogStart', fi.fogStart ?? 1e6);
    sh.float('uFogEnd', fi.fogEnd ?? (1e6 + 1));
    sh.float('uFogDensity', fi.fogDensity ?? 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    // 1. Opaque: solid cubes, depth written, a hard cutoff that never fires.
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    sh.float('uOpacity', 1);
    sh.float('uAlphaCutoff', 0.5);
    this._drawPass(sh, PASS_OPAQUE);

    // 2. Cutout: leaves, plants, glass — alpha-tested, still depth-written.
    sh.float('uAlphaCutoff', 0.1);
    this._drawPass(sh, PASS_CUTOUT);

    // 3. Translucent: water and ice. No depth write, blended, back to front,
    //    and two-sided so a submerged camera still sees the surface above it.
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    sh.float('uAlphaCutoff', 0.02);
    this._drawPass(sh, PASS_TRANSLUCENT);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  _drawPass(sh, pass) {
    const gl = this.gl;
    const list = this._visible[pass];
    for (let i = 0; i < list.length; i++) {
      const sec = list[i];
      const quads = sec.quads[pass];
      const vao = sec.vao[pass];
      if (!quads || !vao) continue;
      sh.vec3('uChunkOrigin', sec.originX, sec.originY, sec.originZ);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, quads * 6, gl.UNSIGNED_INT, 0);
      this._drawCalls++;
      this._quadsDrawn += quads;
    }
  }

  /** Vanilla's black wireframe around the block under the crosshair. */
  drawSelectionBox(camera, x, y, z, boxes) {
    const gl = this.gl;
    const list = (boxes && boxes.length) ? boxes : unitBoxAt(x, y, z);

    const sh = this.lineShader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.vec4('uColor', 0, 0, 0, 0.4);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.lineWidth(2);

    gl.bindVertexArray(this.lineVAO);
    for (let i = 0; i < list.length; i++) {
      this._boxModel(list[i], SELECTION_INFLATE);
      sh.mat4('uModel', this._model);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }

    gl.lineWidth(1);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  /** Projects `destroy_stage_0..9` over the faces of the block being mined. */
  drawBreakOverlay(camera, x, y, z, stage, boxes) {
    const gl = this.gl;
    if (!this.atlas?.texture) return;
    const s = clamp(Math.round(stage), 0, 9);
    const layer = this._breakLayer(s);
    const list = (boxes && boxes.length) ? boxes : unitBoxAt(x, y, z);

    const sh = this.breakShader.use();
    sh.mat4('uViewProj', camera.viewProj);
    sh.float('uLayer', layer);
    sh.int('uAtlas', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.bindVertexArray(this.breakVAO);
    for (let i = 0; i < list.length; i++) {
      this._boxModel(list[i], BREAK_INFLATE);
      sh.mat4('uModel', this._model);
      gl.drawElements(gl.TRIANGLES, this.breakIndexCount, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  /**
   * Layer index of one crack stage. Resolving it costs a string build and a Map
   * lookup, and mining asks for one every frame, so it is cached until the atlas
   * is rebuilt underneath us.
   */
  _breakLayer(stage) {
    if (!this._breakLayers || this._breakLayerEpoch !== this.atlas.layers) {
      this._breakLayerEpoch = this.atlas.layers;
      const layers = new Int32Array(10);
      for (let s = 0; s < 10; s++) layers[s] = this.atlas.layerOf(`destroy_stage_${s}`);
      this._breakLayers = layers;
    }
    return this._breakLayers[stage];
  }

  /** Maps the unit cube onto `box`, grown by `inflate` so it cannot z-fight. */
  _boxModel(box, inflate) {
    const m = this._model;
    const x0 = box.minX - inflate;
    const y0 = box.minY - inflate;
    const z0 = box.minZ - inflate;
    const sx = Math.max(1e-4, box.maxX - box.minX + inflate * 2);
    const sy = Math.max(1e-4, box.maxY - box.minY + inflate * 2);
    const sz = Math.max(1e-4, box.maxZ - box.minZ + inflate * 2);
    mat4.identity(m);
    mat4.translate(m, m, x0, y0, z0);
    mat4.scale(m, m, sx, sy, sz);
    return m;
  }

  // ================================================================ bookkeeping

  _bumpChunk(cx, cz, delta) {
    const key = chunkKey(cx, cz);
    const n = (this._chunkCounts.get(key) || 0) + delta;
    if (n <= 0) this._chunkCounts.delete(key);
    else this._chunkCounts.set(key, n);
  }

  _dropSection(key, sec) {
    this._freeSection(sec);
    this._sections.delete(key);
    this._bumpChunk(sec.cx, sec.cz, -1);
  }

  _freeSection(sec) {
    for (let p = 0; p < PASS_COUNT; p++) this._freePass(sec, p);
  }

  _freePass(sec, pass) {
    const gl = this.gl;
    if (sec.vao[pass]) { gl.deleteVertexArray(sec.vao[pass]); sec.vao[pass] = null; }
    if (sec.bufU16[pass]) { gl.deleteBuffer(sec.bufU16[pass]); sec.bufU16[pass] = null; }
    if (sec.bufU8[pass]) { gl.deleteBuffer(sec.bufU8[pass]); sec.bufU8[pass] = null; }
    sec.quads[pass] = 0;
  }

  get stats() {
    return {
      chunks: this._chunkCounts.size,
      sections: this._sections.size,
      visible: this._visible[PASS_OPAQUE].length,
      pending: this._pending.size,
      quads: this._quadsDrawn,
      drawCalls: this._drawCalls,
      meshTimeMs: this._meshTimeMs,
    };
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const gl = this.gl;
    this.clear();
    this.world = null;

    if (this.indexBuffer) { gl.deleteBuffer(this.indexBuffer); this.indexBuffer = null; }
    if (this.lineVAO) { gl.deleteVertexArray(this.lineVAO); this.lineVAO = null; }
    if (this.lineVBO) { gl.deleteBuffer(this.lineVBO); this.lineVBO = null; }
    if (this.breakVAO) { gl.deleteVertexArray(this.breakVAO); this.breakVAO = null; }
    if (this.breakVBO) { gl.deleteBuffer(this.breakVBO); this.breakVBO = null; }
    if (this.breakIBO) { gl.deleteBuffer(this.breakIBO); this.breakIBO = null; }

    this.chunkShader.destroy();
    this.lineShader.destroy();
    this.breakShader.destroy();
  }
}

// ---------------------------------------------------------------- helpers

const nearFirst = (a, b) => a.dist - b.dist;
const farFirst = (a, b) => b.dist - a.dist;

// The decals run every frame while a block is targeted, so the fallback shape is
// a reused singleton rather than a fresh object and array per call.
const FALLBACK_BOX = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const FALLBACK_LIST = [FALLBACK_BOX];

/**
 * Fallback shape for blocks with no collision box, such as a snow dusting.
 * Returns the shared one-element list `drawSelectionBox`/`drawBreakOverlay` walk.
 */
function unitBoxAt(x, y, z) {
  FALLBACK_BOX.minX = x; FALLBACK_BOX.minY = y; FALLBACK_BOX.minZ = z;
  FALLBACK_BOX.maxX = x + 1; FALLBACK_BOX.maxY = y + 1; FALLBACK_BOX.maxZ = z + 1;
  return FALLBACK_LIST;
}
