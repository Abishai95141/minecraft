// The story engine: builds Emberhold and the places the chain sends you, runs
// the seven quests, keeps the objective tracker, waypoint, boss bar and toasts
// the HUD reads, routes every conversation, and saves the whole thing.

import {
  ObjectiveType, Place, instantiateQuests, activeObjective, questIndexById,
} from './quests.js';
import { DIALOGUE, hasNode } from './dialogue.js';
import { spawnNpcs } from './npc.js';
import { generateVillage, generateRuinedTower, generateDungeon } from '../world/structures.js';
import { spawnMob } from '../entity/mobs.js';
import { ItemStack } from '../item/inventory.js';
import { ITEMS } from '../item/items.js';
import { B } from '../world/blocks.js';
import { Random } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { PauseScreen } from '../ui/screens/pause.js';
import { CreditsScreen } from '../ui/screens/credits.js';

/** Emberhold always sits in the origin chunk: story mode wakes you inside it. */
const VILLAGE_CX = 0;
const VILLAGE_CZ = 0;

/** The dead ring around the village, and how far the rekindling pushes it back. */
const BLIGHT_INNER = 13;
const BLIGHT_OUTER = 32;
const HEAL_SPEED = 0.62;          // blocks of radius per tick
const HEAL_BUDGET = 110;          // block writes per tick

/** The mine Torvin sends you to: due east, a sloping lit adit. */
const MINE_OFFSET = 26;
const MINE_LENGTH = 34;

/** Where the two far structures stand, relative to the plaza centre. */
const TOWER_OFFSET = [-54, -34];
const HOLLOW_OFFSET = [22, 74];

/** Siege pacing for chapter four. */
const SIEGE_TARGET = 6;
const SIEGE_MAX_SPAWNS = 12;
const SIEGE_WAVE_GAP = 85;

/** Which named position each speaker owns. */
const NPC_PLACE = {
  elder_sowmi: Place.ELDER,
  torvin: Place.TORVIN,
  mira: Place.MIRA,
  pim: Place.PIM,
};

/** Ground the blight and the healing are allowed to touch. */
const WITHERABLE_GRASS = new Set([B.GRASS_BLOCK, B.PODZOL, B.MYCELIUM]);
const WITHERABLE_STONE = new Set([B.STONE, B.GRANITE, B.DIORITE, B.ANDESITE]);
const LOOSE_PLANTS = new Set([
  B.GRASS_PLANT, B.TALL_GRASS, B.FERN, B.DANDELION, B.POPPY,
  B.BLUE_ORCHID, B.CORNFLOWER, B.RED_MUSHROOM, B.BROWN_MUSHROOM,
]);
/** Blocks that count as "the ground" when probing a column. */
const GROUND_LIKE = new Set([
  B.GRASS_BLOCK, B.DIRT, B.COARSE_DIRT, B.PODZOL, B.MYCELIUM, B.WITHERED_GRASS,
  B.STONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.WITHERED_STONE, B.DEEPSLATE,
  B.SAND, B.RED_SAND, B.SANDSTONE, B.GRAVEL, B.CLAY, B.SNOW_BLOCK,
  B.COBBLESTONE, B.MOSSY_COBBLESTONE, B.STONE_BRICKS, B.VILLAGE_PATH,
]);

export class StoryMode {
  constructor(game) {
    this.game = game;
    this.world = game?.world || null;
    this.rng = new Random(((this.world?.seed ?? 0) ^ 0x5077e1) >>> 0);
    this.fxRng = this.rng.fork('ember:fx');

    this.quests = instantiateQuests();
    this.index = 0;
    this.started = false;
    this.finished = false;

    this.flags = Object.create(null);
    this.places = Object.create(null);
    this.npcs = [];
    this.lanterns = [];

    this.village = null;
    this.mine = null;
    this.tower = null;
    this.hollow = null;
    this.towerSite = [0, 0];
    this.hollowSite = [0, 0];

    /** What the compass points at: { x, y, z, label, place } or null. */
    this.waypoint = null;
    /** What a boss bar should show: { kind, title, subtitle, progress, color }. */
    this.bossBar = null;

    this.siege = null;
    this.siegeMobs = [];
    this.warden = null;
    this.heal = null;

    this.ticks = 0;
    this._music = null;
    this._hinted = null;
    this._counted = new Set();
    this._talkingTo = null;
    this._creditsIn = -1;
    this._unbind = null;

    for (const q of this.quests) for (const o of q.objectives) this._retitle(o);
  }

  // ================================================================ read-only

  get currentQuest() {
    if (this.finished) return null;
    return this.quests[this.index] || null;
  }

  get objectives() {
    return this.currentQuest?.objectives || [];
  }

  get activeObjective() {
    return activeObjective(this.currentQuest);
  }

  get progressText() {
    if (this.finished) return 'The Ember burns again.';
    const q = this.currentQuest;
    if (!q) return '';
    const o = activeObjective(q);
    return o ? o.text : q.title;
  }

  get chapter() { return this.index + 1; }

  // ================================================================ lifecycle

  /** Builds Emberhold, stands the player up in it, and opens chapter one. */
  start() {
    if (this.started) return this;
    const world = this.game?.world;
    if (!world) return this;
    this.world = world;
    this.started = true;

    // The story spawns its own waves; nothing else may wander in mid-sentence.
    world.spawnHostiles = false;
    world.doMobSpawning = false;
    world.timeOfDay = 11700;                 // late afternoon, sunset imminent

    this._buildVillage();
    this._buildMine();
    this._blight();
    this._relightVillage();
    this._placePlayer();
    this._spawnVillagers();
    this._bindWorld();

    this._begin(0);
    return this;
  }

  /** Restores a saved run. game.js calls this immediately after `start()`. */
  load(data) {
    if (!data || typeof data !== 'object' || !this.started) return this;

    this.flags = Object.assign(Object.create(null), data.flags || {});
    for (const saved of data.quests || []) {
      const q = this.quests.find((x) => x.id === saved.id);
      if (!q) continue;
      q.done = !!saved.done;
      q.started = !!saved.started;
      for (const so of saved.objectives || []) {
        const o = q.objectives.find((x) => x.id === so.id);
        if (!o) continue;
        o.progress = clamp(so.progress | 0, 0, o.count);
        o.done = !!so.done;
        this._retitle(o);
      }
    }

    this.finished = !!data.finished;
    this.index = clamp(data.index | 0, 0, this.quests.length - 1);
    this.game?.dialogue?.close?.();
    this._restoreWorldState();

    if (this.finished) {
      this.waypoint = null;
      this.bossBar = null;
      return this;
    }
    this._begin(this.index, { silent: true, keepProgress: true });
    return this;
  }

  save() {
    return {
      v: 1,
      index: this.index,
      finished: this.finished,
      flags: { ...this.flags },
      quests: this.quests.map((q) => ({
        id: q.id,
        done: q.done,
        started: q.started,
        objectives: q.objectives.map((o) => ({ id: o.id, progress: o.progress, done: o.done })),
      })),
    };
  }

  /** Re-does the world-side consequences of everything already achieved. */
  _restoreWorldState() {
    if (this.index >= questIndexById('what_mira_knew') || this.flags.has_key) this.revealTower();
    if (this.index >= questIndexById('deep_hollow') || this.flags.warden_slain) this.revealHollow();
    if (this.flags.core_placed) {
      this._setCoreBlock(true);
      this.lightLanterns();
      this._healEverything();
    }
  }

  // ================================================================ world build

  /**
   * Makes sure every chunk a structure is about to write into exists and has
   * had its trees placed — populating afterwards would drop an oak on a roof.
   */
  _prepareArea(x0, z0, x1, z1) {
    const world = this.world;
    const gen = world?.generator;
    if (!gen) return;
    const cx0 = x0 >> 4, cx1 = x1 >> 4;
    const cz0 = z0 >> 4, cz1 = z1 >> 4;

    // One extra ring of terrain, so every chunk we populate has all eight
    // neighbours — the same rule game.js streams by.
    for (let cz = cz0 - 1; cz <= cz1 + 1; cz++) {
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
        const chunk = world.getOrCreateChunk(cx, cz);
        if (!chunk.generated) {
          gen.generateChunk(chunk);
          chunk.generated = true;
        }
      }
    }
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = world.getChunk(cx, cz);
        if (!chunk || chunk.populated) continue;
        gen.populateChunk(chunk);
        chunk.populated = true;
        chunk.recomputeHeightMap();
        chunk.markAllDirty();
      }
    }
  }

  /**
   * The outer ring `_prepareArea` generated but deliberately left bare would
   * never light or mesh, because game.js only lights populated chunks — so it
   * would read as a hole in the world. Flag it done and let it stream in.
   */
  _settleArea(x0, z0, x1, z1) {
    const world = this.world;
    for (let cz = (z0 >> 4) - 1; cz <= (z1 >> 4) + 1; cz++) {
      for (let cx = (x0 >> 4) - 1; cx <= (x1 >> 4) + 1; cx++) {
        const chunk = world.getChunk(cx, cz);
        if (!chunk || !chunk.generated || chunk.populated) continue;
        chunk.populated = true;
        chunk.recomputeHeightMap();
        chunk.markAllDirty();
      }
    }
  }

  _buildVillage() {
    // generateVillage writes across (ox +- 40); ox is 8 in the origin chunk.
    this._prepareArea(-32, -32, 48, 48);
    this.village = generateVillage(this.world, VILLAGE_CX, VILLAGE_CZ, this.rng.fork('emberhold'));
    this._settleArea(-32, -32, 48, 48);

    const c = this.village.center;
    const ped = this.village.pedestal;
    this.places[Place.VILLAGE] = c.slice();
    this.places[Place.PEDESTAL] = [ped[0] + 0.5, ped[1] + 1, ped[2] + 0.5];

    const ox = Math.floor(c[0]), oz = Math.floor(c[2]);
    this.towerSite = [ox + TOWER_OFFSET[0], oz + TOWER_OFFSET[1]];
    this.hollowSite = [ox + HOLLOW_OFFSET[0], oz + HOLLOW_OFFSET[1]];
    // The waypoints exist before the structures do, so the compass can point
    // at them the moment a chapter names them.
    this.places[Place.TOWER] = [this.towerSite[0] + 0.5, c[1], this.towerSite[1] + 0.5];
    this.places[Place.TOWER_TOP] = this.places[Place.TOWER].slice();
    this.places[Place.HOLLOW] = [this.hollowSite[0] + 0.5, c[1], this.hollowSite[1] - 15.5];
    this.places[Place.HOLLOW_DEEP] = [this.hollowSite[0] + 0.5, c[1] - 22, this.hollowSite[1] + 0.5];

    this._raiseLanterns();
  }

  /**
   * Eleven lanterns around the plaza — four on the dais corners from the village
   * template, seven more on posts of our own. Pim counts them, so the number
   * matters more than it looks.
   */
  _raiseLanterns() {
    const c = this.village.center;
    const ox = Math.floor(c[0]), oz = Math.floor(c[2]);
    const baseY = Math.floor(c[1]) - 1;

    this.lanterns = [];
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      this.lanterns.push([ox + lx, baseY + 3, oz + lz]);
    }
    for (const [lx, lz] of [[-8, -3], [-8, 3], [-3, -8], [3, -8], [8, 3], [3, 8], [-3, 8]]) {
      const x = ox + lx, z = oz + lz;
      this.world.setBlockFast(x, baseY, z, B.COBBLESTONE, 0);
      this.world.setBlockFast(x, baseY + 1, z, B.OAK_FENCE, 0);
      this.world.setBlockFast(x, baseY + 2, z, B.OAK_FENCE, 0);
      this.world.setBlockFast(x, baseY + 3, z, B.EMBER_LANTERN, 0);
      this.lanterns.push([x, baseY + 3, z]);
    }
  }

  /**
   * The adit east of the fence line: a lined tunnel dropping a block every
   * second step, timbered, torch-lit, with coal near the top and iron below.
   */
  _buildMine() {
    const world = this.world;
    const c = this.village.center;
    const mx = Math.floor(c[0]) + MINE_OFFSET;
    const mz = Math.floor(c[2]) - 1;

    this._prepareArea(mx - 8, mz - 8, mx + MINE_LENGTH + 8, mz + 8);
    const rng = this.rng.fork('emberhold:mine');
    const surfaceY = this._groundY(mx, mz) ?? Math.floor(c[1]) - 1;

    const seal = (x, y, z) => {
      const id = world.getBlock(x, y, z);
      if (id === B.AIR || id === B.WATER || id === B.LAVA) world.setBlockFast(x, y, z, B.STONE, 0);
    };

    let deepest = [mx, surfaceY, mz];
    for (let i = 0; i <= MINE_LENGTH; i++) {
      const x = mx + i;
      const y = surfaceY - (i >> 1);
      deepest = [x, y, mz];

      // Plug anything the tunnel would otherwise open into, but never build a
      // stone box above the daylight line.
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 4; dy++) {
          const by = y + dy;
          if (by > surfaceY && i > 1) continue;
          seal(x, by, mz + dz);
        }
      }
      for (let dz = -1; dz <= 1; dz++) {
        world.setBlockFast(x, y, mz + dz, B.COBBLESTONE, 0);
        for (let dy = 1; dy <= 3; dy++) world.setBlockFast(x, y + dy, mz + dz, B.AIR, 0);
      }

      // Pit props every six paces, outside the walkable box.
      if (i > 1 && i % 6 === 0) {
        for (let dy = 1; dy <= 3; dy++) {
          world.setBlockFast(x, y + dy, mz - 2, B.OAK_LOG, 0);
          world.setBlockFast(x, y + dy, mz + 2, B.OAK_LOG, 0);
        }
        for (let dz = -1; dz <= 1; dz++) world.setBlockFast(x, y + 4, mz + dz, B.OAK_PLANKS, 0);
      }
      // Wall torches on the north face; meta 4 means "held up by the -Z side".
      if (i > 1 && i % 6 === 3) world.setBlockFast(x, y + 3, mz - 1, B.WALL_TORCH, 4);

      // Coal from the top down, iron once the adit is properly under the hill.
      if (i >= 3 && i % 3 === 0 && i <= 24) {
        const side = rng.bool(0.5) ? -2 : 2;
        world.setBlockFast(x, y + 1, mz + side, B.COAL_ORE, 0);
        world.setBlockFast(x, y + 2, mz + side, B.COAL_ORE, 0);
      }
      if (i >= 14 && (i - 14) % 3 === 0) {
        const side = rng.bool(0.5) ? -2 : 2;
        world.setBlockFast(x, y + 1, mz + side, B.IRON_ORE, 0);
        world.setBlockFast(x, y + 2, mz - side, B.IRON_ORE, 0);
      }
    }

    // The face at the bottom: a wider cut with the last of the iron in it.
    const [ex, ey] = deepest;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = 0; dx <= 4; dx++) {
        for (let dy = -1; dy <= 4; dy++) seal(ex + dx, ey + dy, mz + dz);
      }
    }
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = 0; dx <= 3; dx++) {
        world.setBlockFast(ex + dx, ey, mz + dz, B.COBBLESTONE, 0);
        for (let dy = 1; dy <= 3; dy++) world.setBlockFast(ex + dx, ey + dy, mz + dz, B.AIR, 0);
      }
    }
    for (const [dx, dz] of [[3, -2], [3, 2], [2, -3], [2, 3]]) {
      world.setBlockFast(ex + dx, ey + 1, mz + dz, B.IRON_ORE, 0);
      world.setBlockFast(ex + dx, ey + 2, mz + dz, B.COAL_ORE, 0);
    }
    world.setBlockFast(ex + 1, ey + 3, mz - 2, B.WALL_TORCH, 4);
    world.setBlockFast(ex + 1, ey + 3, mz + 2, B.WALL_TORCH, 5);

    // A framed mouth so the mine reads as a doorway rather than a hole.
    for (let dy = 1; dy <= 4; dy++) {
      world.setBlockFast(mx - 1, surfaceY + dy, mz - 2, B.OAK_LOG, 0);
      world.setBlockFast(mx - 1, surfaceY + dy, mz + 2, B.OAK_LOG, 0);
    }
    for (let dz = -2; dz <= 2; dz++) world.setBlockFast(mx - 1, surfaceY + 4, mz + dz, B.OAK_LOG, 0);
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlockFast(mx - 1, surfaceY, mz + dz, B.VILLAGE_PATH, 0);
      for (let dy = 1; dy <= 3; dy++) world.setBlockFast(mx - 1, surfaceY + dy, mz + dz, B.AIR, 0);
    }
    world.setBlockFast(mx - 2, surfaceY + 1, mz - 2, B.TORCH, 0);
    world.setBlockFast(mx - 2, surfaceY + 1, mz + 2, B.TORCH, 0);

    this.mine = {
      mouth: [mx - 1, surfaceY + 1, mz],
      face: [ex + 2, ey + 1, mz],
    };
    this.places[Place.MINE] = [mx - 0.5, surfaceY + 1, mz + 0.5];
    this.places[Place.MINE_DEEP] = [ex + 2.5, ey + 1, mz + 0.5];
    this._settleArea(mx - 8, mz - 8, mx + MINE_LENGTH + 8, mz + 8);
  }

  /** Ashfall: a ring of dead ground with a ragged outer edge. */
  _blight() {
    const world = this.world;
    const c = this.village.center;
    const ox = Math.floor(c[0]), oz = Math.floor(c[2]);
    const rng = this.rng.fork('emberhold:blight');
    const span = BLIGHT_OUTER - BLIGHT_INNER;

    for (let z = oz - BLIGHT_OUTER; z <= oz + BLIGHT_OUTER; z++) {
      for (let x = ox - BLIGHT_OUTER; x <= ox + BLIGHT_OUTER; x++) {
        const d = Math.hypot(x - ox, z - oz);
        if (d < BLIGHT_INNER || d > BLIGHT_OUTER) continue;
        // Fades out rather than stopping on a circle.
        if (rng.next() < ((d - BLIGHT_INNER) / span) * 0.6) continue;

        const y = this._groundY(x, z);
        if (y === null) continue;
        const id = world.getBlock(x, y, z);
        if (WITHERABLE_GRASS.has(id)) world.setBlockFast(x, y, z, B.WITHERED_GRASS, 0);
        else if (WITHERABLE_STONE.has(id)) world.setBlockFast(x, y, z, B.WITHERED_STONE, 0);
        else continue;
        if (LOOSE_PLANTS.has(world.getBlock(x, y + 1, z))) world.setBlockFast(x, y + 1, z, B.AIR, 0);
      }
    }
  }

  /**
   * The plaza and its immediate surroundings have to be lit before the loading
   * screen lets go, or chapter one opens on a black hole where the village is.
   * Everything further out streams in during the first couple of seconds.
   */
  _relightVillage() {
    const world = this.world;
    const lighting = world.lighting;
    for (let cz = -3; cz <= 3; cz++) {
      for (let cx = -3; cx <= 3; cx++) {
        const chunk = world.getChunk(cx, cz);
        if (!chunk || !chunk.populated) continue;
        chunk.recomputeHeightMap();
        if (lighting && !chunk.lit) {
          lighting.initialLight(chunk);
          chunk.lit = true;
        }
        chunk.markAllDirty();
      }
    }
    let guard = 0;
    while (lighting && lighting.pending > 0 && guard++ < 80) lighting.process(6);
  }

  /** Wakes the player on the south step of the dais, looking at the pedestal. */
  _placePlayer() {
    const p = this.game.player;
    if (!p || !this.village) return;
    const c = this.village.center;
    const x = Math.floor(c[0]) + 4;
    const z = Math.floor(c[2]) + 5;
    const y = this.world.findSpawnY(x, z, Math.floor(c[1]) + 14);

    p.x = x + 0.5; p.y = y; p.z = z + 0.5;
    p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.fallDistance = 0;
    p.spawnPoint = [p.x, y, p.z];
    p.lookAt(c[0], c[1] + 2, c[2]);
    p.prevYaw = p.yaw;
    p.prevPitch = p.pitch;
  }

  _spawnVillagers() {
    const spawns = (this.village?.npcSpawns || []).map((s) => ({ ...s }));

    // Nobody stands in their own doorway: shift the two who are posted at one
    // a stride further out into the street.
    for (const s of spawns) {
      const building = this._buildingFor(s.role);
      if (!building || !building.door || !building.doorOutside) continue;
      const dx = building.doorOutside[0] - building.door[0];
      const dz = building.doorOutside[2] - building.door[2];
      s.x = building.doorOutside[0] + dx * 1.5;
      s.z = building.doorOutside[2] + dz * 1.5;
      s.y = building.floorY + 1;
    }

    this.npcs = spawnNpcs(this.world, spawns);
    for (const npc of this.npcs) {
      const key = NPC_PLACE[npc.dialogueId];
      if (key) this.places[key] = [npc.x, npc.y, npc.z];
    }
  }

  _buildingFor(role) {
    const list = this.village?.buildings || [];
    if (role === 'blacksmith') return list.find((b) => b.kind === 'blacksmith') || null;
    if (role === 'scholar') return list.find((b) => b.kind === 'large_house') || null;
    return null;
  }

  _bindWorld() {
    this._unbind?.();
    this._unbind = this.world.on((event, payload) => {
      if (event === 'bossDefeated') this._onBossDefeated(payload?.mob);
      else if (event === 'bossPhase') this._onBossPhase(payload);
    });
  }

  // ================================================================ far places

  /** Builds Mira's tower. Idempotent unless `force` asks for a rebuild. */
  revealTower(force = false) {
    if (this.tower && !force) return this.tower;
    const [tx, tz] = this.towerSite;
    this._prepareArea(tx - 14, tz - 14, tx + 14, tz + 14);
    this.tower = generateRuinedTower(this.world, tx, tz, this.rng.fork('emberhold:tower'));
    this._settleArea(tx - 14, tz - 14, tx + 14, tz + 14);

    this.places[Place.TOWER] = this.tower.center.slice();
    this.places[Place.TOWER_TOP] = [
      this.tower.lootPos[0] + 0.5, this.tower.lootPos[1], this.tower.lootPos[2] + 0.5,
    ];
    return this.tower;
  }

  /** Cuts the arch, the shaft and the chamber under the south track. */
  revealHollow(force = false) {
    if (this.hollow && !force) return this.hollow;
    const [hx, hz] = this.hollowSite;
    this._prepareArea(hx - 16, hz - 24, hx + 16, hz + 16);
    this.hollow = generateDungeon(this.world, hx, 22, hz, this.rng.fork('emberhold:hollow'));
    this._settleArea(hx - 16, hz - 24, hx + 16, hz + 16);

    this.places[Place.HOLLOW] = this.hollow.entrance.slice();
    this.places[Place.HOLLOW_DEEP] = this.hollow.center.slice();

    // The key opens the way: the runes around the corridor mouth wake up.
    if (this.flags.has_key || this.index >= questIndexById('deep_hollow')) this._wakeRunes();
    return this.hollow;
  }

  _wakeRunes() {
    if (!this.hollow) return;
    const [cx, , cz] = this.hollow.center;
    const floorY = this.hollow.floorY;
    const x = Math.round(cx - 0.5);
    const z = Math.round(cz - 0.5) - 8;
    // The runic doorway at the corridor mouth: jambs at x+-2, lintel one higher.
    this._litRunes(x - 2, floorY + 1, z, x + 2, floorY + 4, z);

    // And the arch on the surface, which is the one the player is standing in
    // front of when the narration says the runes go out downward.
    const e = this.hollow.entrance;
    if (!e) return;
    const ax = Math.round(e[0] - 0.5), ay = Math.round(e[1]), az = Math.round(e[2] - 0.5);
    this._litRunes(ax - 3, ay, az - 3, ax + 3, ay + 3, az + 3);
  }

  /** Swaps every dormant rune in an inclusive box for its awakened twin. */
  _litRunes(x0, y0, z0, x1, y1, z1) {
    const world = this.world;
    if (!world) return;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (world.getBlock(x, y, z) !== B.RUNE_STONE) continue;
          world.setBlock(x, y, z, B.RUNE_STONE_LIT, 0, { skipUpdates: true });
        }
      }
    }
  }

  // ================================================================ quest flow

  _begin(i, opts = {}) {
    const q = this.quests[i];
    if (!q) { this._finish(); return; }

    this.index = i;
    q.started = true;
    this._hinted = null;

    if (!opts.keepProgress) {
      for (const o of q.objectives) { o.progress = 0; o.done = false; this._retitle(o); }
    }

    if (q.music) this.setMusic(q.music);
    try { q.onStart?.(this); } catch (e) { console.warn('story: onStart failed', e); }

    if (!opts.silent) {
      this.game?.toast?.(q.title, activeObjective(q)?.title || q.description);
      this.chat(`§6${q.title}`);
      this.game?.playSound?.('experience', { volume: 0.6, pitch: 1.2 });
      if (q.dialogue && hasNode(q.dialogue.speaker, q.dialogue.node)) {
        this.game?.dialogue?.start(q.dialogue.speaker, q.dialogue.node, {});
      }
    }
    this._updateWaypoint();
  }

  _checkCompletion() {
    const q = this.currentQuest;
    if (!q || q.done) return;
    // Never resolve a chapter out from under a conversation: the next one would
    // clobber the box mid-sentence.
    if (this.game?.dialogue?.active) return;
    for (const o of q.objectives) if (!o.done) return;
    this._complete(q);
  }

  _complete(q) {
    q.done = true;
    try { q.onComplete?.(this); } catch (e) { console.warn('story: onComplete failed', e); }
    for (const r of q.rewards || []) this.give(r.item, r.count ?? 1);

    this.game?.toast?.('Chapter complete', q.title);
    this.chat(`§a${q.title} §7- complete.`);
    this.game?.playSound?.('quest_complete', { volume: 0.9 });

    if (this.index >= this.quests.length - 1) this._finish();
    else this._begin(this.index + 1);
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.waypoint = null;
    this.bossBar = null;
    this._hinted = null;
    this.setMusic('menu');
    this.chat('§6The Ember of Sowmi §7- the end.');
    this._creditsIn = 90;
  }

  /** Public: jump the chain forward, either to `questId` or to the next link. */
  advance(questId) {
    const i = questId ? questIndexById(questId) : this.index + 1;
    if (i < 0 || i >= this.quests.length) { this._finish(); return null; }
    const cur = this.quests[this.index];
    if (cur && i > this.index) cur.done = true;
    this._begin(i);
    return this.quests[i];
  }

  /** Public: force an objective of the current chapter to done. */
  completeObjective(id) {
    const q = this.currentQuest;
    if (!q) return false;
    const o = q.objectives.find((x) => x.id === id);
    if (!o || o.done) return false;
    this._setProgress(o, o.count);
    return true;
  }

  /** Public: wipe a chapter's progress so it can be attempted again. */
  failQuest(id) {
    const i = id ? questIndexById(id) : this.index;
    const q = this.quests[i];
    if (!q || q.done) return false;
    for (const o of q.objectives) { o.progress = 0; o.done = false; this._retitle(o); }
    this._hinted = null;

    if (q.id === 'long_night') {
      this.endSiege();
      this.beginSiege();
    } else if (q.id === 'deep_hollow') {
      this.warden?.remove?.();
      this.warden = null;
      this.bossBar = null;
      this.flags.warden_spawned = false;
      this.setMusic('overworld');
    }
    this.game?.toast?.('Chapter failed', q.title);
    this.chat(`§c${q.title} §7- begin again.`);
    return true;
  }

  // ================================================================ objectives

  _retitle(o) {
    if (!o.title) o.title = o.text;
    o.text = o.count > 1 ? `${o.title} (${Math.min(o.progress, o.count)}/${o.count})` : o.title;
    o.label = o.text;
    o.complete = o.done;
  }

  _setProgress(o, value) {
    if (o.done) return;
    const v = clamp(Math.floor(value), 0, o.count);
    if (v <= o.progress) return;
    o.progress = v;
    if (o.progress >= o.count) {
      o.done = true;
      this._retitle(o);
      this.chat(`§a✓ §7${o.title}`);
      this.game?.playSound?.('orb', { volume: 0.7, pitch: 1.3 });
      this._hinted = null;
    } else {
      this._retitle(o);
    }
  }

  _pollObjectives() {
    const q = this.currentQuest;
    if (!q) return;
    const player = this.game?.player;
    const inv = player?.inventory;

    for (const o of q.objectives) {
      if (o.done) continue;
      if (o.type === ObjectiveType.COLLECT && inv) {
        let n = 0;
        for (const name of o.items || []) n += inv.countOf(name);
        this._setProgress(o, n);
      } else if (o.type === ObjectiveType.REACH && player) {
        const p = this.place(o.place);
        if (!p) continue;
        const r = o.radius ?? 8;
        const dx = player.x - p[0], dz = player.z - p[2];
        const dy = Math.abs(player.y - p[1]);
        if (dx * dx + dz * dz <= r * r && dy <= (o.height ?? Math.max(10, r))) {
          this._setProgress(o, o.count);
        }
      } else if (o.type === ObjectiveType.FLAG) {
        if (this.flags[o.flag]) this._setProgress(o, o.count);
      }
    }

    // One hint toast per step, the first time that step becomes the live one.
    const active = activeObjective(q);
    if (active && active !== this._hinted) {
      this._hinted = active;
      if (active.hint) this.game?.toast?.(active.title, active.hint);
    }
  }

  // ================================================================ events

  /** game.js and entity/player.js funnel gameplay here. */
  onEvent(type, payload) {
    if (!this.started) return;
    switch (type) {
      case 'blockBroken':
        this._onBlockBroken(payload);
        break;
      case 'blockPlaced':
        this._onBlockPlaced(payload);
        break;
      case 'mobKilled':
        this._onMobKilled(payload);
        break;
      case 'itemPicked':
        this._onItemPicked(payload);
        break;
      case 'itemUsed':
        if (payload?.item === 'village_bread') this.chat('§7Honey, and a little too much of it. Pim would be pleased.');
        break;
      case 'npcTalked':
        this._creditTalk(typeof payload === 'string' ? payload : payload?.id);
        break;
      case 'areaEntered':
        if (payload?.place) this.flag(`entered_${payload.place}`);
        break;
      case 'playerDied':
        this._onPlayerDied();
        break;
      default:
        break;
    }
  }

  _onBlockBroken(payload) {
    const q = this.currentQuest;
    if (!q || !payload) return;
    for (const o of q.objectives) {
      if (o.done || o.type !== ObjectiveType.MINE) continue;
      if (!o.blocks || !o.blocks.includes(payload.block)) continue;
      this._setProgress(o, o.progress + 1);
    }
  }

  _onBlockPlaced(payload) {
    if (payload?.block === 'crafting_table') this.flag('placed_table');
  }

  _onMobKilled(mob) {
    const type = mob?.mobType || mob?.type;
    if (!type) return;
    // game.js can report a kill twice (the event and the removal), so count the
    // entity, not the notification.
    const key = mob.id ?? mob;
    if (this._counted.has(key)) return;
    this._counted.add(key);
    if (this._counted.size > 256) this._counted.clear();

    if (type === 'withered_husk' && this.siege?.active) this.siege.killed++;
    if (type === 'hollow_warden') this._onBossDefeated(mob);

    const q = this.currentQuest;
    if (!q) return;
    for (const o of q.objectives) {
      if (o.done || o.type !== ObjectiveType.KILL || o.mob !== type) continue;
      this._setProgress(o, o.progress + 1);
    }
  }

  _onItemPicked(payload) {
    const name = payload?.item;
    if (name === 'ember_core') {
      this.flag('has_core');
      this.chat('§dThe Ember Core is warm straight through the glove.');
    } else if (name === 'miras_journal') {
      this.flag('journal_taken');
    }
  }

  _onPlayerDied() {
    const q = this.currentQuest;
    if (!q) return;
    if (q.id === 'long_night' || q.id === 'deep_hollow') this.failQuest(q.id);
  }

  _onBossPhase(payload) {
    if (!payload?.mob || payload.mob !== this.warden) return;
    const names = ['', 'It is only standing up.', 'It has stopped pretending.', 'It is not going back down.'];
    this.chat(`§5${names[clamp(payload.phase | 0, 1, 3)]}`);
    this.game?.playSound?.('hollow_warden_idle', { volume: 1.2, pitch: 0.9 });
  }

  _onBossDefeated(mob) {
    if (this.flags.warden_slain) return;
    this.flag('warden_slain');
    this.bossBar = null;
    this.warden = null;
    this.setMusic('overworld');
    this.chat('§6The Hollow Warden comes apart. Something small and hot rolls free of it.');
    const p = mob || this.game?.player;
    if (p) this.game?.particles?.spawn('ember', p.x, p.y + 1, p.z, { count: 60, spread: 1.6 });
    this.game?.playSound?.('level_up', { volume: 1 });
  }

  // ================================================================ dialogue

  /** game.js: returns truthy when the interaction was a conversation. */
  talkTo(entity) {
    const id = entity?.dialogueId;
    if (!id || !DIALOGUE[id]) return false;
    const box = this.game?.dialogue;
    if (!box) return false;
    if (box.active) return true;

    const nodeId = this._nodeFor(id);
    if (!nodeId) return false;

    entity.setTalking?.(true);
    this.game?.playSound?.('villager_hmm', {
      x: entity.x, y: entity.y + 1.4, z: entity.z,
      volume: 0.7, pitch: entity.voicePitch ?? 1,
    });
    this._talkingTo = entity;

    const ok = box.start(id, nodeId, {
      onEnd: () => {
        entity.setTalking?.(false);
        this._talkingTo = null;
        this._creditTalk(id);
      },
    });
    if (!ok) {
      entity.setTalking?.(false);
      this._talkingTo = null;
      return false;
    }
    return true;
  }

  /** Which line of theirs the player has earned right now. */
  _nodeFor(id) {
    const q = this.currentQuest;
    const qid = q?.id ?? null;
    const f = this.flags;
    const o = activeObjective(q);
    let node = 'waiting';

    if (id === 'elder_sowmi') {
      if (!f.met_sowmi) node = 'intro';
      else if (this.finished) node = 'ending';
      else if (qid === 'old_ways') node = 'old_ways';
      else if (qid === 'iron_and_ash') node = 'send_torvin';
      else if (qid === 'long_night') node = 'night';
      else if (qid === 'what_mira_knew' || qid === 'deep_hollow') node = 'after_night';
      else if (qid === 'rekindle') node = 'rekindle';
    } else if (id === 'torvin') {
      if (this.finished) node = 'ending';
      else if (qid === 'iron_and_ash') {
        if (o?.id === 'talk_torvin') node = 'intro';
        else if (o?.id === 'return_torvin') node = 'ret';
        else node = 'waiting_ore';
      } else if (qid === 'long_night') node = 'night';
      else if (f.held_the_night) node = 'after_night';
    } else if (id === 'mira') {
      if (this.finished) node = 'ending';
      else if (qid === 'what_mira_knew') {
        if (o?.id === 'talk_mira') node = 'intro';
        else if (f.journal_read) node = 'journal_read';
        else node = 'waiting_journal';
      } else if (qid === 'deep_hollow' || qid === 'rekindle') node = 'journal_read';
    } else if (id === 'pim') {
      if (this.finished) node = 'ending';
      else if (!f.pim_bread) node = 'intro';
      else if (qid === 'long_night') node = 'night';
      else if (qid === 'deep_hollow') node = 'hollow';
    }

    if (hasNode(id, node)) return node;
    return hasNode(id, 'waiting') ? 'waiting' : null;
  }

  _creditTalk(npcId) {
    if (!npcId) return;
    const q = this.currentQuest;
    if (!q) return;
    const o = activeObjective(q);
    if (o && o.type === ObjectiveType.TALK && o.npc === npcId) this._setProgress(o, o.count);
  }

  /** DialogueBox reports every node it opens; tags are the story's cue sheet. */
  onDialogueNode(speakerId, nodeId, node) {
    const tag = node?.tag;
    if (!tag) return;
    switch (tag) {
      case 'sowmi_sends_you':
        this.flag('met_sowmi');
        break;
      case 'torvin_sends_you':
        // Iron will not come out of the rock for a wooden pick, so he equips you
        // before he sends you, and keeps the heirloom for when you come back.
        if (!this.flags.got_stone_pick) {
          this.flag('got_stone_pick');
          this.give('stone_pickaxe', 1);
          this.give('torch', 8);
        }
        break;
      case 'torvin_gift':
        this.flag('torvin_gift');
        break;
      case 'mira_sends_you':
        this.flag('mira_sends_you');
        break;
      case 'mira_advice':
        this.flag('mira_advice');
        break;
      case 'pim_bread':
        if (!this.flags.pim_bread) {
          this.flag('pim_bread');
          this.give('village_bread', 2);
        }
        break;
      case 'journal_read':
        if (!this.flags.journal_read) {
          this.flag('journal_read');
          this.give('hollow_key', 1);
          this.chat('§bThe way in is the arch on the south track.');
        }
        break;
      default:
        break;
    }
  }

  /** A choice may carry its own flag; the panel has already made the click. */
  onDialogueChoice(speakerId, nodeId, index, choice) {
    if (choice?.flag) this.flag(choice.flag);
  }

  onDialogueEnd(speakerId) {
    if (this._talkingTo && this._talkingTo.dialogueId === speakerId) {
      this._talkingTo.setTalking?.(false);
      this._talkingTo = null;
    }
  }

  /** Opens the journal itself; the node's tag hands over the key. */
  readJournal() {
    const box = this.game?.dialogue;
    if (!box || box.active) return false;
    this.game?.playSound?.('chest_open', { volume: 0.6, pitch: 1.4 });
    return box.start('journal', 'read', {});
  }

  // ================================================================ chapter IV

  beginSiege() {
    const world = this.world;
    if (!world) return;
    if (world.timeOfDay < 13800 || world.timeOfDay > 22000) world.timeOfDay = 14200;

    const q = this.quests[questIndexById('long_night')];
    this.siege = {
      active: true,
      ticks: 0,
      limit: q?.timeLimit ?? 90 * 20,
      spawned: 0,
      killed: 0,
      next: 40,
    };
    this.siegeMobs = [];
    this.setMusic('boss');
    this.game?.playSound?.('boss_roar', { volume: 1.2, pitch: 1.35 });
    this.chat('§cSomething is coming up out of the grey.');
  }

  endSiege() {
    this.siege = null;
    this.bossBar = null;
    for (const m of this.siegeMobs) {
      if (!m || m.dead) continue;
      this.game?.particles?.spawn('smoke', m.x, m.y + 1, m.z, { count: 12 });
      m.remove?.();
    }
    this.siegeMobs = [];
    this.setMusic('overworld');
  }

  _tickSiege() {
    const s = this.siege;
    if (!s || !s.active) return;
    s.ticks++;
    const remain = Math.max(0, s.limit - s.ticks);

    this.bossBar = {
      kind: 'siege',
      title: 'The Long Night',
      subtitle: `${Math.min(s.killed, SIEGE_TARGET)} / ${SIEGE_TARGET} driven off - ${Math.ceil(remain / 20)}s`,
      progress: s.limit > 0 ? remain / s.limit : 0,
      color: 0x9a3b3b,
    };

    this.siegeMobs = this.siegeMobs.filter((m) => m && !m.dead);
    if (--s.next <= 0) {
      s.next = SIEGE_WAVE_GAP;
      if (s.spawned < SIEGE_MAX_SPAWNS && remain > 80 && this.siegeMobs.length < 5) {
        this._spawnHusks(s.spawned === 0 ? 3 : 2);
      }
    }

    if (remain <= 0) {
      s.active = false;
      this.chat('§7The eastern sky greys. What is left of them goes back into the ground.');
      const q = this.currentQuest;
      if (q && q.id === 'long_night') for (const o of q.objectives) this._setProgress(o, o.count);
    }
  }

  _spawnHusks(n) {
    const world = this.world;
    const c = this.village?.center;
    const player = this.game?.player;
    if (!world || !c) return;
    const rng = this.fxRng;

    for (let i = 0; i < n; i++) {
      let placed = null;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(19, 27);
        const x = Math.floor(c[0] + Math.cos(a) * r);
        const z = Math.floor(c[2] + Math.sin(a) * r);
        const y = world.findSpawnY(x, z, Math.floor(c[1]) + 18);
        if (!world.canStandAt(x, y, z)) continue;
        placed = spawnMob(world, 'withered_husk', x + 0.5, y, z + 0.5);
      }
      if (!placed) continue;
      placed.persistent = true;
      if (player) placed.target = player;
      this.siegeMobs.push(placed);
      this.siege.spawned++;
      this.game?.particles?.spawn('smoke', placed.x, placed.y + 1, placed.z, { count: 8 });
    }
  }

  // ================================================================ chapter VI

  _tickBoss() {
    const q = this.currentQuest;
    if (!q || q.id !== 'deep_hollow' || !this.hollow) {
      if (this.bossBar?.kind === 'warden') this.bossBar = null;
      return;
    }
    const player = this.game?.player;
    if (!player) return;

    if (!this.warden && !this.flags.warden_slain) {
      const c = this.hollow.center;
      const dx = player.x - c[0], dz = player.z - c[2];
      // Twelve blocks: far enough into the chamber that it is behind them.
      if (dx * dx + dz * dz < 144 && Math.abs(player.y - c[1]) < 12) this._spawnWarden();
      return;
    }

    if (this.warden) {
      if (this.warden.dead || !this.warden.isAlive) {
        this._onBossDefeated(this.warden);
        return;
      }
      this.bossBar = {
        kind: 'warden',
        title: 'The Hollow Warden',
        subtitle: this.warden.slamCharge > 0 ? 'It has gone still.' : `Phase ${this.warden.phase ?? 1}`,
        progress: clamp(this.warden.health / Math.max(1, this.warden.maxHealth), 0, 1),
        color: 0x6a2fa0,
      };
    }
  }

  _spawnWarden() {
    const c = this.hollow.center;
    const mob = spawnMob(this.world, 'hollow_warden', c[0], c[1], c[2] + 3);
    if (!mob) return;
    mob.persistent = true;
    mob.target = this.game?.player || null;
    this.warden = mob;
    this.flag('warden_spawned');
    this.setMusic('boss');
    this.game?.toast?.('The Hollow Warden', 'It was never a guard.');
    this.chat('§5Something stands up in the dark, and keeps standing up.');
    this.game?.playSound?.('boss_roar', { volume: 2, pitch: 0.85 });
    this.game?.particles?.spawn('portal', c[0], c[1] + 1, c[2] + 3, { count: 50, spread: 2 });
  }

  // ================================================================ chapter VII

  /** Fires the moment the player carries the core onto the dais. */
  placeCore() {
    const player = this.game?.player;
    const ped = this.places[Place.PEDESTAL];
    if (!player || !ped || this.flags.core_placed) return false;
    if (!player.inventory.consume('ember_core', 1)) return false;

    this.flag('core_placed');
    this._setCoreBlock(false);
    this.lightLanterns();
    this._beginHealing();
    if (this.world) this.world.timeOfDay = 23100;

    this.game?.particles?.spawn('ember', ped[0], ped[1] + 1, ped[2], { count: 120, spread: 2.4 });
    this.game?.playSound?.('level_up', { volume: 1.2 });
    this.game?.playSound?.('fire', { volume: 0.9, x: ped[0], y: ped[1], z: ped[2] });
    this.game?.dialogue?.start('narrator', 'ending', {});
    return true;
  }

  _setCoreBlock(quiet) {
    const ped = this.village?.pedestal;
    if (!ped || !this.world) return;
    if (this.world.getBlock(ped[0], ped[1] + 1, ped[2]) === B.EMBER_CORE_BLOCK) return;
    this.world.setBlock(ped[0], ped[1] + 1, ped[2], B.EMBER_CORE_BLOCK, 0, { skipUpdates: quiet });
  }

  /** Every lantern on the plaza catches at once. */
  lightLanterns() {
    const world = this.world;
    if (!world) return;
    for (const [x, y, z] of this.lanterns) {
      if (world.getBlock(x, y, z) !== B.EMBER_LANTERN) continue;
      world.setBlock(x, y, z, B.EMBER_LANTERN_LIT, 0, { skipUpdates: true });
      this.game?.particles?.spawn('flame', x + 0.5, y + 0.6, z + 0.5, { count: 6 });
    }
  }

  _witheredColumns() {
    const world = this.world;
    const c = this.village?.center;
    if (!world || !c) return [];
    const ox = Math.floor(c[0]), oz = Math.floor(c[2]);
    const reach = BLIGHT_OUTER + 3;
    const out = [];
    for (let z = oz - reach; z <= oz + reach; z++) {
      for (let x = ox - reach; x <= ox + reach; x++) {
        const y = this._groundY(x, z);
        if (y === null) continue;
        const id = world.getBlock(x, y, z);
        if (id !== B.WITHERED_GRASS && id !== B.WITHERED_STONE) continue;
        out.push({ x, y, z, d: Math.hypot(x - ox, z - oz) });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  _beginHealing() {
    const list = this._witheredColumns();
    this.heal = list.length ? { list, i: 0, radius: 0 } : null;
  }

  /** Used on load: the ring is already open, so put the ground back at once. */
  _healEverything() {
    for (const c of this._witheredColumns()) this._healColumn(c);
    this.heal = null;
  }

  _healColumn(c) {
    const world = this.world;
    const id = world.getBlock(c.x, c.y, c.z);
    if (id === B.WITHERED_GRASS) {
      world.setBlock(c.x, c.y, c.z, B.GRASS_BLOCK, 0, { skipUpdates: true });
      if (this.fxRng.bool(0.16) && world.getBlock(c.x, c.y + 1, c.z) === B.AIR) {
        world.setBlock(c.x, c.y + 1, c.z, B.GRASS_PLANT, 0, { skipUpdates: true });
      }
    } else if (id === B.WITHERED_STONE) {
      world.setBlock(c.x, c.y, c.z, B.STONE, 0, { skipUpdates: true });
    }
  }

  _tickHeal() {
    const h = this.heal;
    if (!h) return;
    h.radius += HEAL_SPEED;
    let budget = HEAL_BUDGET;
    while (h.i < h.list.length && budget > 0) {
      const c = h.list[h.i];
      if (c.d > h.radius) break;
      h.i++;
      budget--;
      this._healColumn(c);
      if ((h.i & 31) === 0) {
        this.game?.particles?.spawn('ember', c.x + 0.5, c.y + 1.2, c.z + 0.5, { count: 3 });
      }
    }
    if (h.i >= h.list.length) {
      this.heal = null;
      this.chat('§aThe green runs out past the fence line, and keeps going.');
    }
  }

  // ================================================================ per-tick

  tick() {
    if (!this.started || !this.world) return;
    this.ticks++;

    if ((this.ticks & 31) === 0) this._ensureWorld();

    this._pollObjectives();
    this._tickScripted();
    this._tickSiege();
    this._tickBoss();
    this._tickHeal();
    this._updateIndicators();
    this._updateWaypoint();
    this._checkCompletion();

    if (this._creditsIn > 0 && --this._creditsIn === 0) this._rollCredits();
  }

  /** The two moments the player triggers by standing somewhere holding something. */
  _tickScripted() {
    const q = this.currentQuest;
    const player = this.game?.player;
    const box = this.game?.dialogue;
    if (!q || !player) return;

    if (q.id === 'what_mira_knew' && !this.flags.journal_read &&
        player.inventory.hasItems('miras_journal', 1)) {
      // The chest is looted through a container screen, which never fires the
      // pickup event, so this is the only place the flag can be raised.
      this.flag('journal_taken');
      if (!box?.active) { this.readJournal(); return; }
    }
    if (q.id === 'deep_hollow' && this.flags.has_key && !this.flags.runes_woken && this.hollow) {
      const e = this.hollow.entrance;
      if (Math.hypot(player.x - e[0], player.z - e[2]) < 6) {
        this.flag('runes_woken');
        this._wakeRunes();
        if (!box?.active && hasNode('narrator', 'hollow_gate')) {
          this.game?.dialogue?.start('narrator', 'hollow_gate', {});
        }
      }
    }
    if (q.id === 'rekindle' && !this.flags.core_placed && player.inventory.hasItems('ember_core', 1)) {
      const ped = this.places[Place.PEDESTAL];
      if (ped) {
        const dx = player.x - ped[0], dz = player.z - ped[2];
        if (dx * dx + dz * dz <= 3.4 * 3.4 && Math.abs(player.y - ped[1]) <= 5) this.placeCore();
      }
    }
  }

  /** Puts back anything a chunk reload or a stray accident took away. */
  _ensureWorld() {
    const world = this.world;
    if (!world) return;

    for (const npc of this.npcs) {
      if (!npc.dead) continue;
      npc.dead = false;
      npc.health = npc.maxHealth;
      npc.x = npc.post[0]; npc.y = npc.post[1]; npc.z = npc.post[2];
      npc.prevX = npc.x; npc.prevY = npc.y; npc.prevZ = npc.z;
      world.addEntity(npc);
    }

    const ped = this.village?.pedestal;
    if (ped && world.getChunk(ped[0] >> 4, ped[2] >> 4) &&
        world.getBlock(ped[0], ped[1], ped[2]) !== B.BEACON_PEDESTAL) {
      world.setBlock(ped[0], ped[1], ped[2], B.BEACON_PEDESTAL, 0, { skipUpdates: true });
    }

    // Only restock the tower while the journal is genuinely still up there —
    // rebuilding it afterwards would hand out a second copy of a unique item.
    if (this.tower && !this.flags.journal_taken && !this.flags.journal_read && !this.flags.has_key) {
      const p = this.tower.lootPos;
      if (world.getChunk(p[0] >> 4, p[2] >> 4) && world.getBlock(p[0], p[1], p[2]) !== B.CHEST) {
        this.revealTower(true);
      }
    }
    // Same rule below ground, and one more: once the Warden is up, the player
    // is standing in the chamber. Recutting it around them would be worse than
    // a missing spawner, and would re-roll the loot besides.
    if (this.hollow && !this.flags.warden_slain && !this.flags.warden_spawned && !this.warden) {
      const p = this.hollow.spawnerPos;
      if (world.getChunk(p[0] >> 4, p[2] >> 4) && world.getBlock(p[0], p[1], p[2]) !== B.MONSTER_SPAWNER) {
        this.revealHollow(true);
      }
    }
  }

  _updateIndicators() {
    const q = this.currentQuest;
    const o = activeObjective(q);
    const wanted = o && o.type === ObjectiveType.TALK ? o.npc : null;
    for (const npc of this.npcs) {
      if (npc.dialogueId === wanted) npc.setIndicator('!');
      else if (this._nodeFor(npc.dialogueId) === 'waiting') npc.setIndicator('');
      else npc.setIndicator('…');
    }
  }

  _updateWaypoint() {
    if (this.finished) { this.waypoint = null; return; }
    const q = this.currentQuest;
    const o = activeObjective(q);
    const key = o?.waypoint || q?.waypoint || null;
    const pos = this.place(key);
    this.waypoint = pos
      ? { x: pos[0], y: pos[1], z: pos[2], label: o?.title || q?.title || '', place: key }
      : null;
  }

  _rollCredits() {
    const game = this.game;
    if (!game) return;
    this._creditsIn = -1;
    game.saveWorld?.();
    game.openScreen?.(new CreditsScreen(game));
  }

  // ================================================================ helpers

  place(key) {
    if (!key) return null;
    const p = this.places[key];
    return Array.isArray(p) ? p : null;
  }

  flag(name, value = true) {
    if (!name) return false;
    this.flags[name] = value;
    return value;
  }

  /** Hands an item over, hotbar first, and never silently eats the overflow. */
  give(item, count = 1) {
    const player = this.game?.player;
    const def = ITEMS[item];
    if (!player || !def || count <= 0) return false;
    // A unique quest item is handed over once. The chapter V reward and the
    // journal's own tag both offer the hollow key; the second copy would sit in
    // the bag forever, because quest items cannot be dropped.
    if (def.quest && def.maxStack === 1 && player.inventory.hasItems(item, 1)) return false;
    let rest = player.inventory.addToHotbarFirst(new ItemStack(item, count));
    if (rest && !rest.isEmpty) rest = player.inventory.add(rest);
    if (rest && !rest.isEmpty) player.dropStack(rest);
    this.chat(`§a+ ${count} §f${ITEMS[item].display}`);
    this.game?.playSound?.('pop', { volume: 0.6, pitch: 1.2 });
    return true;
  }

  chat(text) { this.game?.chat?.(text); }

  toast(title, subtitle = '') { this.game?.toast?.(title, subtitle); }

  setMusic(name) {
    if (!name || name === this._music) return;
    this._music = name;
    this.game?.audio?.startMusic?.(name);
  }

  /** J: the quest log lives in the pause screen, which already renders it. */
  toggleQuestLog() {
    const game = this.game;
    if (!game) return;
    if (game.screen instanceof PauseScreen) { game.closeScreen(); return; }
    const screen = new PauseScreen(game);
    game.openScreen(screen);
    screen.setMode('quests');
  }

  /** The y of the ground in a column, ignoring the canopy. Null when there is none. */
  _groundY(x, z) {
    const world = this.world;
    const top = world.getHeight(x, z) - 1;
    for (let y = top; y > top - 12; y--) {
      const id = world.getBlock(x, y, z);
      if (GROUND_LIKE.has(id)) return y;
      if (id === B.WATER || id === B.LAVA) return null;
    }
    return null;
  }

  /** Drops every listener and mob the story owns; game.js clears the reference. */
  dispose() {
    this._unbind?.();
    this._unbind = null;
    this.endSiege();
    this.warden = null;
    this.heal = null;
    this.bossBar = null;
    this.waypoint = null;
  }
}
