// The game object. Owns every subsystem, runs the fixed-step tick loop and the
// interpolated render loop, streams chunks around the player, and drives the
// screen stack. Everything else reaches the rest of the game through here.

import { MS_PER_TICK, CAMERA, WORLD } from './core/constants.js';
import { mat4, vec3, extractFrustum, clamp, hexToRgb } from './core/math.js';
import { settings } from './core/settings.js';
import { Input } from './core/input.js';
import * as storage from './core/storage.js';
import { Random } from './core/rng.js';

import { World } from './world/world.js';
import { B, BLOCKS, RenderType, IS_FLUID } from './world/blocks.js';
import { CHUNK_SIZE } from './world/chunk.js';
import { WorldGenerator } from './world/worldgen.js';
import { LightEngine } from './world/lighting.js';

import { createContext, glInfo, resizeCanvas } from './render/gl.js';
import { atlas } from './render/atlas.js';
import { WorldRenderer } from './render/worldrenderer.js';
import { SkyRenderer, skyColors } from './render/sky.js';
import { ParticleSystem } from './render/particles.js';
import { EntityRenderer } from './render/entityrenderer.js';
import { skins } from './render/entityskins.js';

import { Player } from './entity/player.js';
import { spawnMob } from './entity/mobs.js';
import { ItemStack } from './item/inventory.js';

import { icons } from './ui/icons.js';
import { Hud } from './ui/hud.js';
import { audio } from './audio/audio.js';

import { LoadingScreen } from './ui/screens/loading.js';
import { MainMenuScreen } from './ui/screens/mainmenu.js';
import { PauseScreen } from './ui/screens/pause.js';
import { DeathScreen } from './ui/screens/death.js';
import { InventoryScreen } from './ui/screens/inventory.js';
import { CraftingTableScreen } from './ui/screens/craftingtable.js';
import { FurnaceScreen } from './ui/screens/furnace.js';
import { ChestScreen } from './ui/screens/chest.js';

import { StoryMode } from './story/story.js';
import { DialogueBox } from './story/dialogue.js';

/** Chunk work budgets per frame. Small enough that streaming never hitches. */
// Per-tick streaming budgets (20 ticks/second). These are what the world can
// catch up at once the loading screen has handed over — walking into fresh
// terrain. `light: 1` meant one chunk lit every 50ms, so a render distance of
// 8 took a quarter of a minute to finish revealing itself.
const BUDGET = {
  generate: 4,
  populate: 4,
  light: 6,
  lightMs: 6,
  meshMarks: 64,
};

export class Game {
  constructor(canvas, uiCanvas) {
    this.canvas = canvas;
    this.uiCanvas = uiCanvas;
    this.gl = createContext(canvas);
    this.ctx = uiCanvas.getContext('2d', { alpha: true });
    this.glInfo = glInfo(this.gl);

    this.settings = settings;
    this.atlas = atlas;
    this.icons = icons;
    this.input = new Input(uiCanvas);
    this.audio = null;                  // created on the first user gesture

    // --- world-scoped, null on the title screen ---
    this.world = null;
    this.player = null;
    this.generator = null;
    this.lighting = null;
    this.story = null;
    this.worldMeta = null;

    // --- renderers, created during boot ---
    this.renderer = null;
    this.sky = null;
    this.particles = null;
    this.entityRenderer = null;
    this.hud = null;
    this.dialogue = null;

    // --- frame state ---
    this.width = 320;
    this.height = 240;
    this.guiScale = 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera = makeCamera();
    this.partialTicks = 0;
    this.time = 0;
    this.fps = 0;
    this.frameTimeMs = 0;
    this.paused = false;
    this.inGame = false;
    this.running = false;
    this.hideHud = false;
    this.debugOverlay = false;

    // --- screens ---
    this.screen = null;
    this.screenStack = [];

    // --- chat + toasts, owned here so every subsystem can post ---
    this.chatLog = [];
    this.toasts = [];
    this.subtitles = [];

    this._accumulator = 0;
    this._last = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._lastFrameAt = 0;
    this._boundFrame = (t) => this.frame(t);

    this._bindEvents();
  }

  // ================================================================ boot

  async boot(onProgress) {
    onProgress?.(0.02, 'Painting textures');
    await atlas.build((p, name) => onProgress?.(0.02 + p * 0.55, `Painting ${name}`));
    atlas.upload(this.gl);

    onProgress?.(0.6, 'Carving mob skins');
    skins.buildSync();
    skins.upload(this.gl);

    onProgress?.(0.7, 'Cutting inventory icons');
    icons.buildSync(atlas);

    onProgress?.(0.82, 'Compiling shaders');
    this.renderer = new WorldRenderer(this.gl, atlas);
    this.sky = new SkyRenderer(this.gl, atlas);
    this.particles = new ParticleSystem(this.gl, atlas);
    this.entityRenderer = new EntityRenderer(this.gl, skins);

    onProgress?.(0.94, 'Building the interface');
    this.hud = new Hud(this);
    this.dialogue = new DialogueBox(this);

    this.resize();
    onProgress?.(1, 'Ready');
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._lastFrameAt = this._last;
    requestAnimationFrame(this._boundFrame);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());

    // The Web Audio context can only start inside a user gesture.
    const wake = () => {
      if (!this.audio) {
        audio.init();
        this.audio = audio;
      } else {
        this.audio.init();
      }
    };
    this.input.on('mousedown', (code, e) => { wake(); this.onMouseDown(code, e); });
    this.input.on('mouseup', (code, e) => this.onMouseUp(code, e));
    this.input.on('keydown', (code, e, repeat) => { wake(); this.onKeyDown(code, e, repeat); });
    this.input.on('wheel', (notches) => this.onWheel(notches));
    this.input.on('lockchange', (locked) => {
      // Losing the pointer while playing means the player alt-tabbed: pause.
      if (!locked && this.inGame && !this.screen && !this.dialogue?.active) this.openScreen(new PauseScreen(this));
    });

    settings.onChange((key) => {
      if (key === 'guiScale' || key === 'renderScale' || key === '*') this.resize();
      if (key === 'renderDistance' && this.world) this.renderer?.setWorld(this.world);
      if (key === 'smoothLighting' || key === 'graphics') this.remeshAll();
    });
  }

  resize() {
    const cssW = Math.max(1, this.uiCanvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.uiCanvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    resizeCanvas(this.canvas, settings.get('renderScale'));

    this.uiCanvas.width = Math.round(cssW * this.dpr);
    this.uiCanvas.height = Math.round(cssH * this.dpr);

    const opt = settings.get('guiScale');
    this.guiScale = opt === 0
      ? clamp(Math.floor(Math.min(cssW / 320, cssH / 240)), 1, 4)
      : clamp(opt, 1, 4);

    this.width = Math.floor(cssW / this.guiScale);
    this.height = Math.floor(cssH / this.guiScale);

    this.screen?.layout?.(this.width, this.height);
    for (const s of this.screenStack) s.layout?.(this.width, this.height);
  }

  // ================================================================ main loop

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._boundFrame);

    const cap = settings.get('maxFramerate');
    if (cap < 260 && now - this._lastFrameAt < 1000 / cap - 0.5) return;
    const frameStart = now;
    const dt = Math.min((now - this._last) / 1000, 0.25);
    this._last = now;
    this._lastFrameAt = now;
    this.time += dt;

    // Fixed 20 Hz simulation with a bounded catch-up, so a stalled tab does not
    // try to simulate a thousand ticks at once.
    this._accumulator += dt * 1000;
    let steps = 0;
    while (this._accumulator >= MS_PER_TICK && steps < 10) {
      this.tick();
      this._accumulator -= MS_PER_TICK;
      steps++;
    }
    if (steps >= 10) this._accumulator = 0;
    this.partialTicks = clamp(this._accumulator / MS_PER_TICK, 0, 1);

    // Look and held-button actions are polled per frame, not per tick, so that
    // aiming stays smooth at high refresh rates.
    this.pollContinuousInput();

    try {
      this.render(dt);
    } catch (e) {
      this.running = false;
      window.__sowmiFatal?.(e);
      throw e;
    }

    this.input.endFrame();

    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    this.frameTimeMs = performance.now() - frameStart;
  }

  get simulationPaused() {
    return this.paused || (this.screen?.pausesGame ?? false);
  }

  tick() {
    this.screen?.tick?.();
    this.dialogue?.tick?.();
    this.tickToasts();

    if (!this.inGame || !this.world || !this.player) return;
    if (this.simulationPaused) return;

    const dialogueBlocking = this.dialogue?.active && this.dialogue.blocksMovement !== false;
    if (!this.screen && !dialogueBlocking) {
      this.player.readInput(this.input);
    } else {
      this.player.moveForward = 0;
      this.player.moveStrafe = 0;
      this.player.jumping = false;
      this.player.sprinting = false;
    }

    this.player.tick();
    this.world.tick(1);
    this.streamChunks();
    this.tickRandomBlocks();
    this.tickMobSpawning();
    this.story?.tick();
  }

  // ================================================================ mob spawning

  /**
   * Natural spawning, on vanilla's once-a-second cadence. Story mode turns this
   * off and spawns its own waves, so the village never fills up with zombies
   * during a conversation.
   */
  tickMobSpawning() {
    if (!this.world.doMobSpawning) return;
    if (this.world.totalTicks % 20 !== 0) return;

    const p = this.player;
    const mobs = this.world.entities.filter((e) => e.isMob);
    const hostile = mobs.filter((e) => e.hostile).length;
    const passive = mobs.length - hostile;

    this.despawnDistantMobs(mobs);

    const night = !this.world.isDay;
    const wantHostile = night && hostile < 24 && this.world.spawnHostiles;
    const wantPassive = passive < 10;
    if (!wantHostile && !wantPassive) return;

    const rng = this.world.rng;
    const sim = settings.get('simulationDistance');

    for (let attempt = 0; attempt < 12; attempt++) {
      const cx = (Math.floor(p.x) >> 4) + rng.int(-sim, sim);
      const cz = (Math.floor(p.z) >> 4) + rng.int(-sim, sim);
      const chunk = this.world.getChunk(cx, cz);
      if (!chunk || !chunk.lit) continue;

      const x = cx * CHUNK_SIZE + rng.below(CHUNK_SIZE);
      const z = cz * CHUNK_SIZE + rng.below(CHUNK_SIZE);
      const y = chunk.getHeight(x & 15, z & 15);
      if (y <= 0 || !this.world.canStandAt(x, y, z)) continue;

      // Never spawn on top of the player, or so far away it is wasted work.
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist < 16 || dist > 64) continue;

      const ground = this.world.getBlock(x, y - 1, z);
      const skyLight = this.world.getSkyLight(x, y, z);
      const blockLight = this.world.getBlockLight(x, y, z);

      if (wantHostile && blockLight <= 7 && (night || skyLight <= 7)) {
        const type = rng.pick(['zombie', 'zombie', 'skeleton', 'creeper', 'spider']);
        this.spawnMobAt(type, x + 0.5, y, z + 0.5);
        return;
      }
      if (wantPassive && skyLight >= 9 && ground === B.GRASS_BLOCK) {
        const type = rng.pick(['pig', 'cow', 'sheep', 'chicken']);
        // Passive mobs arrive in small groups, as they do in vanilla.
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
          this.spawnMobAt(type, x + 0.5 + rng.int(-2, 2), y, z + 0.5 + rng.int(-2, 2));
        }
        return;
      }
    }
  }

  spawnMobAt(type, x, y, z) {
    if (!this.world.canStandAt(Math.floor(x), Math.floor(y), Math.floor(z))) return null;
    return spawnMob(this.world, type, x, y, z);
  }

  despawnDistantMobs(mobs) {
    const p = this.player;
    for (const m of mobs) {
      if (m.persistent) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > 128) m.remove?.() ?? (m.dead = true);
    }
  }

  render(dt) {
    const gl = this.gl;
    resizeCanvas(this.canvas, settings.get('renderScale'));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.inGame && this.world && this.player) {
      this.player.updateFov(dt);
      this.player.updateTargets();
      this.updateCamera();

      const frameInfo = this.buildFrameInfo();
      this.renderer.update(this.camera, dt);
      this.particles.update(dt, this.world);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearColor(frameInfo.fogColor[0], frameInfo.fogColor[1], frameInfo.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      this.sky.render(this.camera, frameInfo, this.world);
      this.renderer.render(this.camera, frameInfo);
      this.entityRenderer.render(this.camera, frameInfo, this.world.entities, this.player);
      this.particles.render(this.camera, frameInfo);

      // The block outline and the crack overlay sit on top of the world.
      const hit = this.player.lookingAt;
      if (hit && !this.hideHud) {
        const boxes = this.world.blockCollisionBoxes(hit.x, hit.y, hit.z, hit.blockId);
        this.renderer.drawSelectionBox(this.camera, hit.x, hit.y, hit.z, boxes);
        if (this.player.breakStage >= 0 && this.player.miningTarget) {
          const t = this.player.miningTarget;
          this.renderer.drawBreakOverlay(this.camera, t.x, t.y, t.z, this.player.breakStage,
            this.world.blockCollisionBoxes(t.x, t.y, t.z));
        }
      }
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    this.renderUI(dt);
  }

  renderUI(dt) {
    const ctx = this.ctx;
    const s = this.guiScale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const mx = Math.floor(this.input.mouseX / this.guiScale);
    const my = Math.floor(this.input.mouseY / this.guiScale);

    // A full screen replaces the HUD rather than layering over it: otherwise
    // the chat log and objective tracker bleed through the options menu, and
    // the inventory ends up with two hotbars — its own and the HUD's.
    if (this.inGame && !this.hideHud && (!this.screen || this.screen.drawsHud)) {
      this.hud.render(ctx, this, this.width, this.height, dt);
    }
    if (this.dialogue?.active) {
      this.dialogue.render(ctx, this.width, this.height, dt);
    }
    if (this.screen) {
      this.screen.render(ctx, mx, my, dt);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ================================================================ camera

  updateCamera() {
    const p = this.player;
    const a = this.partialTicks;
    const cam = this.camera;

    const px = p.prevX + (p.x - p.prevX) * a;
    const py = p.prevY + (p.y - p.prevY) * a;
    const pz = p.prevZ + (p.z - p.prevZ) * a;

    const bob = p.bobOffset(a);
    // The bob offset is in view space, so rotate it onto the camera basis.
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let ex = px + bob[0] * cy;
    let ey = py + p.eyeHeight + bob[1];
    let ez = pz + bob[0] * sy;

    if (p.perspective !== 0) {
      // Pull the camera back along the view ray, stopping short of any wall.
      const dir = p.lookVector();
      const sign = p.perspective === 1 ? -1 : 1;
      const back = [dir[0] * sign, dir[1] * sign, dir[2] * sign];
      let dist = CAMERA.THIRD_PERSON_DISTANCE;
      const hit = this.world.raycast([ex, ey, ez], back, dist);
      if (hit) dist = Math.max(0.5, hit.distance - 0.3);
      ex += back[0] * dist; ey += back[1] * dist; ez += back[2] * dist;
    }

    cam.pos[0] = ex; cam.pos[1] = ey; cam.pos[2] = ez;
    cam.yaw = p.perspective === 2 ? p.yaw + Math.PI : p.yaw;
    cam.pitch = p.perspective === 2 ? -p.pitch : p.pitch;

    const renderDist = settings.get('renderDistance') * CHUNK_SIZE;
    cam.fov = settings.get('fov') * Math.PI / 180 * p.fovModifier;
    cam.aspect = this.canvas.width / Math.max(1, this.canvas.height);
    cam.near = CAMERA.NEAR;
    cam.far = renderDist + CAMERA.FAR_PADDING;

    mat4.perspective(cam.proj, cam.fov, cam.aspect, cam.near, cam.far);
    mat4.fpsView(cam.view, cam.pos, cam.yaw, cam.pitch);
    mat4.multiply(cam.viewProj, cam.proj, cam.view);
    extractFrustum(cam.frustum, cam.viewProj);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const csy = Math.sin(cam.yaw), ccy = Math.cos(cam.yaw);
    vec3.set(cam.forward, -csy * cp, -sp, ccy * cp);
    vec3.set(cam.right, ccy, 0, csy);
    vec3.cross(cam.up, cam.right, cam.forward);
    vec3.scale(cam.up, cam.up, -1);
  }

  buildFrameInfo() {
    const world = this.world;
    const biomeSky = 0x78a7ff;
    const colors = skyColors(world.timeOfDay, biomeSky);

    const eyeBlock = world.getBlock(
      Math.floor(this.camera.pos[0]), Math.floor(this.camera.pos[1]), Math.floor(this.camera.pos[2]));
    const underwater = eyeBlock === B.WATER;
    const inLava = eyeBlock === B.LAVA;

    const renderDist = settings.get('renderDistance') * CHUNK_SIZE;
    let fog = hexToRgb(colors.fog);
    // Vanilla keeps terrain crisp almost to the render boundary and only hazes
    // the last stretch. Starting at 0.55 washed out most of the visible world.
    let fogStart = renderDist * 0.80;
    let fogEnd = renderDist * 1.0;
    let fogDensity = 0;

    if (underwater) { fog = [0.05, 0.16, 0.36]; fogDensity = 0.12; }
    else if (inLava) { fog = [0.6, 0.15, 0.02]; fogDensity = 1.2; }

    return {
      time: this.time,
      timeOfDay: world.timeOfDay,
      skyLight: world.skyLightFactor(),
      fogColor: fog,
      fogStart, fogEnd, fogDensity,
      underwater, inLava,
      gamma: settings.get('brightness'),
      nightVision: 0,
      sky: colors,
      partialTicks: this.partialTicks,
    };
  }

  // ================================================================ chunk streaming

  streamChunks() {
    const world = this.world;
    const p = this.player;
    const cx = Math.floor(p.x) >> 4;
    const cz = Math.floor(p.z) >> 4;
    const r = settings.get('renderDistance');

    // Every stage below is budgeted, so the ORDER decides what the player sees.
    // Chunk iteration is insertion-ordered, which stops matching distance the
    // moment the player moves: hundreds of stale chunks then eat the budget
    // while the chunk underfoot stays unlit and unmeshed.
    const near = (c) => {
      const dx = c.cx - cx, dz = c.cz - cz;
      return dx * dx + dz * dz;
    };

    // 1. Generate the nearest missing chunk, plus a one-chunk apron so that
    //    populate always has its neighbours and trees can cross a border.
    let generated = 0;
    outer:
    for (let ring = 0; ring <= r + 1 && generated < BUDGET.generate; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const c = world.getChunk(cx + dx, cz + dz);
          if (c && c.generated) continue;
          const chunk = world.getOrCreateChunk(cx + dx, cz + dz);
          if (!chunk.generated) {
            this.generator.generateChunk(chunk);
            chunk.generated = true;
            if (++generated >= BUDGET.generate) break outer;
          }
        }
      }
    }

    // 2. Populate only chunks whose 8 neighbours exist, so structures and trees
    //    never get clipped by a chunk that has not been carved yet.
    // Derived from the world each tick rather than from a queue. A queue only
    // ever holds what streamChunks itself generated, so the ring that
    // startWorld generates but does not populate was stranded forever:
    // unpopulated, therefore never lit, therefore never meshed — a permanent
    // hole in the ground beside spawn that you could see the caves through.
    // Scanning cannot go stale, and 400 chunks per tick costs nothing.
    let populated = 0;
    const toPopulate = [];
    for (const chunk of world.chunks.values()) {
      if (chunk.generated && !chunk.populated) toPopulate.push(chunk);
    }
    if (toPopulate.length > 1) toPopulate.sort((a, b) => near(a) - near(b));
    for (const chunk of toPopulate) {
      if (populated >= BUDGET.populate) break;
      // Populate needs all 8 neighbours carved, so trees and structures are
      // never clipped by a chunk that does not exist yet.
      let ready = true;
      for (let dz = -1; dz <= 1 && ready; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = world.getChunk(chunk.cx + dx, chunk.cz + dz);
          if (!n || !n.generated) { ready = false; break; }
        }
      }
      if (!ready) continue;
      this.generator.populateChunk(chunk);
      chunk.populated = true;
      chunk.recomputeHeightMap();
      chunk.markAllDirty();
      populated++;
    }

    // 3. Light freshly populated chunks, nearest first.
    const toLight = [];
    for (const chunk of world.chunks.values()) {
      if (chunk.populated && !chunk.lit) toLight.push(chunk);
    }
    toLight.sort((a, b) => near(a) - near(b));
    for (let i = 0; i < toLight.length && i < BUDGET.light; i++) {
      const chunk = toLight[i];
      this.lighting.initialLight(chunk);
      chunk.lit = true;
      chunk.markAllDirty();
    }
    this.lighting.process(BUDGET.lightMs);

    // 4. Hand dirty sections to the renderer, nearest first.
    // Only clear what was actually handed over: clearing the whole set after the
    // budget broke out of the loop drops the rest on the floor, and nothing ever
    // marks them again, so those sections never get a mesh at all.
    const toMesh = [];
    for (const chunk of world.chunks.values()) {
      if (chunk.lit && chunk.dirtySections.size) toMesh.push(chunk);
    }
    toMesh.sort((a, b) => near(a) - near(b));
    let marks = 0;
    for (const chunk of toMesh) {
      if (marks >= BUDGET.meshMarks) break;
      for (const si of [...chunk.dirtySections]) {
        if (marks >= BUDGET.meshMarks) break;
        this.renderer.markSectionDirty(chunk, si);
        chunk.dirtySections.delete(si);
        marks++;
      }
    }

    // 5. Unload chunks that fell outside the keep radius.
    const keep = r + 3;
    for (const chunk of [...world.chunks.values()]) {
      if (Math.abs(chunk.cx - cx) <= keep && Math.abs(chunk.cz - cz) <= keep) continue;
      this.renderer.removeChunk(chunk);
      world.unloadChunk(chunk.cx, chunk.cz);
    }
  }

  /** Crop growth and grass spread, on vanilla's random-tick cadence. */
  tickRandomBlocks() {
    const p = this.player;
    const radius = Math.min(settings.get('simulationDistance'), 4);
    this.world.randomTick(Math.floor(p.x), Math.floor(p.z), radius, (x, y, z, id) => {
      if (id === B.FARMLAND_WET) {
        const above = this.world.getBlock(x, y + 1, z);
        if (above === B.WHEAT) {
          const meta = this.world.getMeta(x, y + 1, z);
          if (meta < 7) this.world.setBlock(x, y + 1, z, B.WHEAT, meta + 1);
        }
      } else if (id === B.GRASS_BLOCK) {
        // Grass dies when it is covered.
        const above = this.world.getBlock(x, y + 1, z);
        if (BLOCKS[above].opaque && BLOCKS[above].fullCube) this.world.setBlock(x, y, z, B.DIRT);
      }
    });
  }

  remeshAll() {
    if (!this.world) return;
    for (const chunk of this.world.chunks.values()) chunk.markAllDirty();
  }

  // ================================================================ world lifecycle

  async startWorld(opts = {}) {
    const seed = normaliseSeed(opts.seed);
    const story = opts.story !== false;
    const loading = new LoadingScreen(this, `Generating ${opts.name || 'world'}`);
    this.openScreen(loading);
    await nextFrame();

    this.world = new World(seed, {
      difficulty: opts.difficulty || 'normal',
      spawnHostiles: !story,
      doMobSpawning: !story,
    });
    this.generator = new WorldGenerator(this.world, seed);
    this.lighting = new LightEngine(this.world);
    this.world.generator = this.generator;
    this.world.lighting = this.lighting;

    this.worldMeta = {
      id: opts.id || `w${Date.now().toString(36)}`,
      name: opts.name || (story ? 'The Ember of Sowmi' : 'New World'),
      seed, story, lastPlayed: Date.now(), difficulty: this.world.difficulty,
    };

    if (opts.data) this.world.loadSerialized(opts.data.world);

    loading.setProgress(0.1, 'Shaping the land');
    await nextFrame();

    // Pick the spawn before building anything: both queries are pure functions
    // of the seed, so we only generate terrain around a spot worth standing on
    // instead of dropping the player into whatever happens to be at the origin.
    const spawn = opts.data?.player
      ? { x: 0, z: 0 }
      : this.generator.findSpawnPoint();
    this.spawnX = spawn.x;
    this.spawnZ = spawn.z;
    const scx = spawn.x >> 4;
    const scz = spawn.z >> 4;

    // Build the whole visible world on the loading screen, not after the player
    // is already standing in it. Streaming only 7x7 chunks here and leaving the
    // other ~280 to trickle in at one lit chunk per tick meant you spawned into
    // a half-drawn world full of holes for the better part of a minute.
    // Generation needs a one-chunk apron so populate always has its neighbours.
    const viewR = Math.max(4, settings.get('renderDistance'));
    const genR = viewR + 1;
    const rings = [];
    for (let dz = -genR; dz <= genR; dz++) {
      for (let dx = -genR; dx <= genR; dx++) rings.push([dx, dz, Math.max(Math.abs(dx), Math.abs(dz))]);
    }
    // Nearest first, so if anything is ever cut short it is the far edge.
    rings.sort((a, b) => a[2] - b[2]);

    let done = 0;
    for (const [dx, dz] of rings) {
      const chunk = this.world.getOrCreateChunk(scx + dx, scz + dz);
      if (!chunk.generated) { this.generator.generateChunk(chunk); chunk.generated = true; }
      if (++done % 24 === 0) {
        loading.setProgress(0.05 + (done / rings.length) * 0.35, 'Shaping the land');
        await nextFrame();
      }
    }

    loading.setProgress(0.4, 'Growing the world');
    await nextFrame();
    done = 0;
    for (const [dx, dz] of rings) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) > viewR) continue;
      const chunk = this.world.getChunk(scx + dx, scz + dz);
      if (chunk && !chunk.populated) {
        this.generator.populateChunk(chunk);
        chunk.populated = true;
        chunk.recomputeHeightMap();
      }
      if (++done % 24 === 0) {
        loading.setProgress(0.4 + (done / rings.length) * 0.2, 'Growing the world');
        await nextFrame();
      }
    }

    // findSpawnPoint runs on pure noise, before a single tree exists, so it can
    // happily pick a spot that populate then buries under a canopy — you spawn
    // nose-first into leaves with no ground in sight. Now that the terrain is
    // real, nudge the spawn to somewhere with sky overhead and room to stand.
    if (!opts.data?.player) {
      // The *walkable* ground, ignoring anything that grew on it. getHeight()
      // counts leaves, so measuring from it would only tell us the sky is clear
      // above the treetops — which it always is.
      const groundOf = (x, z) => {
        for (let y = this.world.getHeight(x, z); y > WORLD.SEA_LEVEL - 8; y--) {
          const id = this.world.getBlock(x, y - 1, z);
          if (id === B.AIR) continue;
          const def = BLOCKS[id];
          if (def.render !== RenderType.CUBE) continue;                // plants, slabs
          if (def.name.endsWith('_leaves') || def.name.endsWith('_log')) continue;
          return { y, solid: !IS_FLUID[id], name: def.name };
        }
        return null;
      };
      // A column is open when nothing hangs over the ground you would stand on.
      const openColumn = (x, z, need = 8) => {
        const g0 = groundOf(x, z);
        if (!g0 || !g0.solid || g0.y <= WORLD.SEA_LEVEL) return null;
        for (let dy = 0; dy < need; dy++) {
          if (this.world.getBlock(x, g0.y + dy, z) !== B.AIR) return null;
        }
        return g0;
      };
      // Sky overhead is not enough: a beach at the foot of a cliff scores full
      // marks on that alone, and you spawn with your nose against a dirt wall.
      // Neighbours must also sit at roughly the same height, i.e. be somewhere
      // you could actually walk.
      const openness = (x, z) => {
        const here = openColumn(x, z);
        if (!here) return -1;
        let score = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const n = openColumn(x + dx, z + dz, 5);
            if (n && Math.abs(n.y - here.y) <= 2) score++;
          }
        }
        return score;                                        // out of 25
      };
      let best = { x: this.spawnX, z: this.spawnZ, score: openness(this.spawnX, this.spawnZ) };
      for (let r = 2; r <= 96 && best.score < 23; r += 2) {
        const steps = Math.max(10, Math.round(r * 1.4));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = this.spawnX + Math.round(Math.cos(a) * r);
          const z = this.spawnZ + Math.round(Math.sin(a) * r);
          const s = openness(x, z);
          if (s > best.score) best = { x, z, score: s };
        }
      }
      if (best.score > 0) { this.spawnX = best.x; this.spawnZ = best.z; }
      // Take the standing height from the SAME survey. Deriving it from
      // generator.surfaceHeight() instead reads the raw noise, which disagrees
      // with the blocks actually placed wherever a cave, a beach or the
      // sea-level flattening moved the surface — and that buried the player
      // inside the hillside, looking out at the underside of the world.
      const g0 = openColumn(this.spawnX, this.spawnZ) || groundOf(this.spawnX, this.spawnZ);
      this.spawnY = g0 ? g0.y : null;
    }

    loading.setProgress(0.6, 'Letting the light in');
    await nextFrame();
    done = 0;
    const toLight = [...this.world.chunks.values()].filter((c) => c.populated && !c.lit);
    for (const chunk of toLight) {
      this.lighting.initialLight(chunk);
      chunk.lit = true;
      if (++done % 16 === 0) {
        loading.setProgress(0.6 + (done / Math.max(1, toLight.length)) * 0.15, 'Letting the light in');
        await nextFrame();
      }
    }
    let guard = 0;
    while (this.lighting.pending > 0 && guard++ < 4000) {
      this.lighting.process(8);
      if (guard % 20 === 0) { loading.setProgress(0.75, 'Letting the light in'); await nextFrame(); }
    }

    loading.setProgress(0.75, 'Waking up');
    await nextFrame();

    const px = this.spawnX + 0.5;
    const pz = this.spawnZ + 0.5;

    // findSpawnPoint reports the terrain surface, which ignores whatever grew on
    // top of it. Searching down from the sky instead would land the player on a
    // canopy, so start from the ground and clear the sapling-height pocket the
    // player occupies — otherwise you spawn standing on leaves or inside a trunk.
    const groundY = this.spawnY ?? (this.generator.surfaceHeight(this.spawnX, this.spawnZ) + 1);
    for (let dy = 0; dy < 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bx = this.spawnX + dx, by = groundY + dy, bz = this.spawnZ + dz;
          const id = this.world.getBlock(bx, by, bz);
          if (id === B.AIR) continue;
          const def = BLOCKS[id];
          // Only vegetation gets cleared; never carve into built terrain.
          if (def.name.endsWith('_leaves') || def.name.endsWith('_log') ||
              def.render === RenderType.CROSS || def.render === RenderType.CROP) {
            this.world.setBlock(bx, by, bz, B.AIR);
          }
        }
      }
    }

    const spawnY = this.world.canStandAt(this.spawnX, groundY, this.spawnZ)
      ? groundY
      : this.world.findSpawnY(this.spawnX, this.spawnZ, groundY + 4);
    this.player = new Player(this.world, px, spawnY, pz, this);
    this.player.spawnPoint = [px, spawnY, pz];
    this.world.addEntity(this.player);
    if (opts.data?.player) this.player.fromJSON(opts.data.player);

    this.renderer.setWorld(this.world);
    this.particles.clear();
    this.remeshAll();
    this.bindWorldEvents();

    if (story) {
      this.story = new StoryMode(this);
      loading.setProgress(0.85, 'Building Emberhold');
      await nextFrame();
      this.story.start();
      if (opts.data?.story) this.story.load(opts.data.story);
    } else {
      this.story = null;
      this.player.inventory.addToHotbarFirst(new ItemStack('wooden_pickaxe', 1));
      this.player.inventory.addToHotbarFirst(new ItemStack('bread', 3));
    }

    // Mesh everything that is going to be visible before handing over. The old
    // 24 update() calls covered under 100 sections of the ~2000 in view, so the
    // player was dropped into a world that was still assembling itself.
    loading.setProgress(0.9, 'Meshing the world');
    await nextFrame();
    this.updateCamera();
    for (let pass = 0; pass < 600; pass++) {
      this.streamChunks();
      this.renderer.update(this.camera, 0.016);
      const left = this.renderer.stats.pending;
      const dirty = left + (this.lighting.pending > 0 ? 1 : 0);
      if (pass > 4 && dirty === 0) break;
      if (pass % 25 === 0) {
        loading.setProgress(0.9 + Math.min(0.09, pass / 600 * 0.09), 'Meshing the world');
        await nextFrame();
      }
    }

    this.inGame = true;
    this.paused = false;
    this.openScreen(null);
    this.input.requestLock();
    this.audio?.startMusic(story ? 'overworld' : 'overworld');
    this.chat(`§eWelcome to ${this.worldMeta.name}.`);
    return this;
  }

  /**
   * Forwards world events to the story engine and keeps the renderer in step
   * with edits made by anything other than the player.
   */
  bindWorldEvents() {
    this._unbindWorld?.();
    this._unbindWorld = this.world.on((event, payload) => {
      switch (event) {
        case 'blockChanged': {
          const chunk = this.world.getChunk(payload.x >> 4, payload.z >> 4);
          if (chunk) for (const si of chunk.dirtySections) this.renderer?.markSectionDirty(chunk, si);
          break;
        }
        case 'mobKilled':
          this.story?.onEvent('mobKilled', payload);
          break;
        case 'entityRemoved':
          if (payload?.isMob && payload.dead) this.story?.onEvent('mobKilled', payload);
          break;
        default:
          break;
      }
    });
  }

  saveWorld() {
    if (!this.world || !this.worldMeta) return false;
    const data = {
      world: this.world.serialize({ onlyModified: true }),
      player: this.player.toJSON(),
      story: this.story?.save() ?? null,
    };
    this.worldMeta.lastPlayed = Date.now();
    const okMeta = storage.saveWorldMeta(this.worldMeta);
    const okData = storage.saveWorldData(this.worldMeta.id, data);
    if (okMeta && okData) this.toast('World saved', this.worldMeta.name);
    else this.toast('Could not save', 'Storage is full');
    return okMeta && okData;
  }

  loadWorld(meta) {
    const data = storage.loadWorldData(meta.id);
    return this.startWorld({ ...meta, data });
  }

  quitToTitle() {
    if (this.inGame) this.saveWorld();
    this.inGame = false;
    this.world = null;
    this.player = null;
    this.story = null;
    this.generator = null;
    this.lighting = null;
    this.renderer?.setWorld(null);
    this.particles?.clear();
    this.chatLog.length = 0;
    this.input.releaseLock();
    this.audio?.startMusic('menu');
    this.openScreen(new MainMenuScreen(this));
  }

  respawn() {
    if (!this.player) return;
    const [sx, sy, sz] = this.player.spawnPoint;
    const y = this.world.findSpawnY(Math.floor(sx), Math.floor(sz), sy + 8);
    this.player.respawn(sx, y, sz);
    this.openScreen(null);
    this.input.requestLock();
  }

  // ================================================================ screens

  openScreen(screen) {
    if (this.screen === screen) return screen;
    if (screen === null) {
      for (const s of this.screenStack) s.onClose?.();
      this.screenStack.length = 0;
      this.screen?.onClose?.();
      this.screen = null;
      this.input.textMode = false;
      if (this.inGame) this.input.requestLock();
      return null;
    }
    if (this.screen) this.screenStack.push(this.screen);
    this.screen = screen;
    screen.parent = screen.parent ?? this.screenStack[this.screenStack.length - 1] ?? null;
    screen.init?.(this.width, this.height);
    screen.layout?.(this.width, this.height);
    this.input.releaseLock();
    return screen;
  }

  closeScreen() {
    const closing = this.screen;
    closing?.onClose?.();
    this.screen = this.screenStack.pop() ?? null;
    this.input.textMode = false;
    if (!this.screen) {
      if (this.inGame) this.input.requestLock();
    } else {
      this.screen.layout?.(this.width, this.height);
    }
    return this.screen;
  }

  openContainer(kind, pos = null) {
    if (!this.player) return null;
    let screen = null;
    if (kind === 'inventory') screen = new InventoryScreen(this);
    else if (kind === 'crafting') screen = new CraftingTableScreen(this, pos);
    else if (kind === 'furnace') screen = new FurnaceScreen(this, pos);
    else if (kind === 'chest') screen = new ChestScreen(this, pos);
    if (screen) this.openScreen(screen);
    return screen;
  }

  // ================================================================ input dispatch

  onKeyDown(code, e, repeat) {
    if (this.dialogue?.active && !this.screen) {
      if (this.dialogue.onKeyDown(code)) return;
    }
    if (this.screen) {
      if (this.screen.onKeyDown?.(code, e)) return;
      if (code === 'Escape' && this.screen.closeOnEscape !== false) {
        this.closeScreen();
        return;
      }
      return;
    }
    if (repeat) return;

    if (code === 'Escape') {
      if (this.inGame) this.openScreen(new PauseScreen(this));
      return;
    }

    const action = this.input.actionFor(code);
    if (!action || !this.inGame || !this.player) return;

    switch (action) {
      case 'inventory': this.openContainer('inventory'); break;
      case 'drop': this.player.dropHeld(e?.shiftKey === true); break;
      case 'debug': this.debugOverlay = !this.debugOverlay; break;
      case 'hideHud': this.hideHud = !this.hideHud; break;
      case 'perspective': this.player.perspective = (this.player.perspective + 1) % 3; break;
      case 'screenshot': this.screenshot(); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'questLog': this.story?.toggleQuestLog?.(); break;
      case 'objectives': if (this.hud) this.hud.showObjectives = !this.hud.showObjectives; break;
      default:
        if (action.startsWith('hotbar')) {
          const n = Number(action.slice(6));
          if (n >= 1 && n <= 9) this.player.selectSlot(n - 1);
        }
    }
  }

  onMouseDown(code, e) {
    const mx = Math.floor(this.input.mouseX / this.guiScale);
    const my = Math.floor(this.input.mouseY / this.guiScale);
    const button = Number(code.slice(5));

    if (this.screen) { this.screen.onMouseDown?.(mx, my, button); return; }
    if (this.dialogue?.active) { this.dialogue.onMouseDown?.(mx, my) ?? this.dialogue.advance?.(); return; }
    if (!this.inGame || !this.player) return;
    if (!this.input.locked) { this.input.requestLock(); return; }

    if (button === 0) {
      // Left click attacks what is under the crosshair, or starts mining.
      if (this.player.lookingAtEntity) this.player.attack(this.player.lookingAtEntity);
      else this.player.swing();
    } else if (button === 2) {
      this.player.use();
    } else if (button === 1) {
      this.player.pickBlock();
    }
  }

  onMouseUp(code, e) {
    const mx = Math.floor(this.input.mouseX / this.guiScale);
    const my = Math.floor(this.input.mouseY / this.guiScale);
    if (this.screen) { this.screen.onMouseUp?.(mx, my, Number(code.slice(5))); return; }
    if (code === 'Mouse0') this.player?.stopMining();
  }

  onWheel(notches) {
    if (this.screen) { this.screen.onWheel?.(notches); return; }
    if (this.inGame && this.player) this.player.scrollHotbar(notches);
  }

  /** Per-frame continuous input: look and held mouse buttons. */
  pollContinuousInput() {
    if (!this.inGame || !this.player || this.screen || this.simulationPaused) return;
    if (this.input.locked) {
      const { dx, dy } = this.input.takeLook();
      if (dx || dy) this.player.look(dx, dy);
    }
    const attacking = this.input.action('attack') && this.input.locked && !this.dialogue?.active;
    this.player.tickMining(attacking);
    if (this.input.action('use') && this.player.useCooldown <= 0 && !this.dialogue?.active) {
      this.player.use();
    }
  }

  interactWithEntity(entity) {
    if (entity?.dialogueId && this.story) return this.story.talkTo(entity);
    return false;
  }

  // ================================================================ feedback

  toast(title, subtitle = '') {
    this.toasts.push({ title, subtitle, age: 0, life: 100 });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  tickToasts() {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      if (++this.toasts[i].age >= this.toasts[i].life) this.toasts.splice(i, 1);
    }
    for (let i = this.chatLog.length - 1; i >= 0; i--) {
      this.chatLog[i].age++;
      if (this.chatLog[i].age > 400 && this.chatLog.length > 40) this.chatLog.splice(i, 1);
    }
    for (let i = this.subtitles.length - 1; i >= 0; i--) {
      if (++this.subtitles[i].age > 60) this.subtitles.splice(i, 1);
    }
  }

  chat(text) {
    this.chatLog.push({ text: String(text), age: 0 });
    if (this.chatLog.length > 100) this.chatLog.shift();
  }

  subtitle(text) {
    if (!settings.get('showSubtitles')) return;
    this.subtitles.push({ text, age: 0 });
    if (this.subtitles.length > 4) this.subtitles.shift();
  }

  /** Safe sound wrapper — audio may not exist until the first click. */
  playSound(name, opts = {}) {
    if (!this.audio?.ready) return;
    if (this.player && opts.x !== undefined) {
      this.audio.setListener([this.player.x, this.player.eyeY, this.player.z], this.player.lookVector());
    }
    this.audio.play(name, opts);
  }

  onPlayerHurt(amount, source) {
    this.hud?.onHurt?.(amount, source);
    this.subtitle('Player hurt');
  }

  onPlayerDeath() {
    this.story?.onEvent('playerDied', {});
    this.openScreen(new DeathScreen(this));
  }

  onHeldItemChanged() {
    this.hud?.onHeldItemChanged?.();
  }

  // ================================================================ misc

  screenshot() {
    try {
      // The GL canvas is not preserved between frames, so compose both layers.
      const out = document.createElement('canvas');
      out.width = this.canvas.width;
      out.height = this.canvas.height;
      const c = out.getContext('2d');
      c.drawImage(this.canvas, 0, 0);
      c.drawImage(this.uiCanvas, 0, 0, out.width, out.height);
      const url = out.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `sowmicraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      this.toast('Screenshot saved');
    } catch {
      this.toast('Screenshot failed');
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }
}

// ---------------------------------------------------------------- helpers

function makeCamera() {
  return {
    pos: new Float32Array(3),
    yaw: 0, pitch: 0,
    fov: Math.PI / 3, aspect: 16 / 9, near: 0.05, far: 256,
    view: mat4.create(), proj: mat4.create(), viewProj: mat4.create(),
    frustum: new Float32Array(24),
    forward: new Float32Array(3), right: new Float32Array(3), up: new Float32Array(3),
  };
}

/** Accepts a number, a numeric string, or any text — matching vanilla. */
function normaliseSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return (Math.random() * 0xffffffff) >>> 0;
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed).trim();
  if (/^-?\d+$/.test(s)) return Math.abs(Number(s)) >>> 0;
  return Random.fromString(s).int(0, 0xffffffff) >>> 0;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
