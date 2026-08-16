// The mob registry: stats, loot and a real behaviour build-out for every
// creature in the game, plus the special-cased ones (skeleton arrows, creeper
// fuse, spider wall-climb, the Hollow Warden's three phases).

import { Entity } from './entity.js';
import { Mob, isPlayerEntity } from './mob.js';
import {
  Goal, GoalFlag, FloatGoal, PanicGoal, MeleeAttackGoal, RangedAttackGoal,
  FollowTargetGoal, WanderGoal, LookAtPlayerGoal, AvoidSunGoal, FollowOwnerGoal,
  TemptGoal, stopMoving, turnTowards, yawToward,
} from './ai.js';
import { B, BLOCKS, IS_FLUID } from '../world/blocks.js';
import { Random, hash3 } from '../core/rng.js';

// ---------------------------------------------------------------- explosions

/** Blocks this tough shrug off a creeper; it is what keeps arenas intact. */
const BLAST_PROOF_RESISTANCE = 15;

/**
 * A creeper-grade explosion: ragged sphere of destroyed blocks, damage and
 * knockback falling off with distance out to twice the power.
 */
export function explode(world, x, y, z, power = 3, source = null) {
  const rng = new Random(hash3(Math.floor(x * 4), Math.floor(y * 4), Math.floor(z * 4), world.seed));
  const r = power;
  const r2 = r * r;
  let destroyed = 0;

  for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
    for (let by = Math.floor(y - r); by <= Math.floor(y + r); by++) {
      for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
        const dx = bx + 0.5 - x, dy = by + 0.5 - y, dz = bz + 0.5 - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const id = world.getBlock(bx, by, bz);
        if (id === B.AIR || IS_FLUID[id]) continue;
        const def = BLOCKS[id];
        if (def.resistance >= BLAST_PROOF_RESISTANCE) continue;
        // Rim blocks survive at random, which is what makes the crater ragged.
        if (Math.sqrt(d2) > r * rng.float(0.55, 1)) continue;
        world.setBlock(bx, by, bz, B.AIR);
        destroyed++;
      }
    }
  }

  const hurtRadius = r * 2;
  for (const e of world.entitiesNear(x, y, z, hurtRadius)) {
    if (e === source || e.dead) continue;
    const dx = e.x - x, dy = (e.y + e.height * 0.5) - y, dz = e.z - z;
    const d = Math.hypot(dx, dy, dz);
    const impact = 1 - d / hurtRadius;
    if (impact <= 0) continue;
    if (typeof e.damage === 'function') {
      e.damage(Math.ceil(impact * impact * 7 * power + impact), source ?? 'explosion');
    }
    const len = d || 1;
    const push = impact * 1.2;
    e.vx += (dx / len) * push;
    e.vy += (dy / len) * push + impact * 0.35;
    e.vz += (dz / len) * push;
  }

  world.emit('explosion', { x, y, z, power, source, destroyed });
  world.emit('sound', { name: 'explode', x, y, z, volume: 4, pitch: 1 });
  return destroyed;
}

// ---------------------------------------------------------------- arrow

export class Arrow extends Entity {
  constructor(world, x, y, z, owner = null) {
    super(world, x, y, z);
    this.type = 'arrow';
    this.width = 0.4;
    this.height = 0.4;
    this.noHit = true;
    this.owner = owner;
    this.damageAmount = 3;
    this.life = 0;
    this.stuck = false;
    // Arrows barely lose speed and fall slower than a body does.
    this.gravity = 0.05;
    this.verticalDrag = 0.99;
    this.airDrag = 0.99;
  }

  /** Aims at a target with vanilla's upward lead and a per-difficulty spread. */
  aimAt(target, speed = 1.6, spread = 0.02, rng = null) {
    const dx = target.x - this.x;
    const dy = (target.y + target.height * 0.6) - this.y;
    const dz = target.z - this.z;
    const h = Math.hypot(dx, dz);
    const lead = dy + h * 0.2;
    const len = Math.hypot(dx, lead, dz) || 1;
    const r = rng ?? this.world.rng;
    this.vx = (dx / len) * speed + r.float(-spread, spread);
    this.vy = (lead / len) * speed + r.float(-spread, spread);
    this.vz = (dz / len) * speed + r.float(-spread, spread);
    this.updateRotation();
    return this;
  }

  updateRotation() {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(-this.vx, this.vz);
    this.pitch = Math.atan2(-this.vy, h);
  }

  updateAI() {
    this.life++;
    if (this.stuck) {
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.hasGravity = false;
      if (this.life > 220) this.remove();
      return;
    }
    if (this.life > 1200) { this.remove(); return; }

    const speed = Math.hypot(this.vx, this.vy, this.vz);
    if (speed > 1e-4) {
      const dir = [this.vx / speed, this.vy / speed, this.vz / speed];
      const hit = this.world.raycastEntities([this.x, this.y, this.z], dir, speed + 0.3, this.owner);
      if (hit && hit.entity !== this.owner && typeof hit.entity.damage === 'function') {
        hit.entity.damage(this.damageAmount, this.owner ?? this);
        this.world.emit('sound', {
          name: 'arrow_hit', x: this.x, y: this.y, z: this.z, volume: 1, pitch: 1,
        });
        this.remove();
        return;
      }
    }

    if (this.onGround || this.horizontalCollision || this.verticalCollision) {
      this.stuck = true;
      this.hasGravity = false;
      this.vx = 0; this.vy = 0; this.vz = 0;
      return;
    }
    this.updateRotation();
  }

  toJSON() {
    const o = super.toJSON();
    o.stuck = this.stuck;
    o.life = this.life;
    return o;
  }
}

// ---------------------------------------------------------------- extra goals

/** The creeper's fuse: swell inside 3 blocks, stand down past 7. */
class SwellGoal extends Goal {
  constructor(mob) {
    super(mob);
    this.flags = 0;                     // runs alongside the approach goal
  }
  canUse() {
    const m = this.mob;
    return m.igniting || (!!m.target && m.distanceTo(m.target) <= (m.def.ignitionDistance ?? 3));
  }
  canContinue() { return this.mob.igniting || this.canUse(); }
  stop() { this.mob.extinguish(); }
  tick() {
    const m = this.mob;
    const t = m.target;
    if (!t || t.dead || m.distanceTo(t) > (m.def.abortDistance ?? 7) || !m.canSee(t)) {
      m.extinguish();
      return;
    }
    m.ignite();
  }
}

/** The Warden's telegraphed slam: plant, wind up, then hammer the ground. */
class SlamGoal extends Goal {
  constructor(mob) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK | GoalFlag.JUMP;
  }
  canUse() {
    const m = this.mob;
    if (m.slamCooldown > 0 || !m.onGround) return false;
    return !!m.target && m.distanceTo(m.target) <= (m.def.slamRadius ?? 5) + 3;
  }
  canContinue() { return this.mob.slamCharge > 0; }
  start() {
    const m = this.mob;
    m.slamCharge = m.def.slamWindup ?? 30;
    m.world.emit('bossTelegraph', { mob: m, kind: 'slam', ticks: m.slamCharge });
    m.playSound('boss_roar', { pitch: 1.25, volume: 0.8 });
  }
  stop() { stopMoving(this.mob); }
  tick() {
    const m = this.mob;
    stopMoving(m);
    if (m.target) turnTowards(m, yawToward(m, m.target.x, m.target.z));
    if (--m.slamCharge <= 0) m.groundSlam();
  }
}

// ---------------------------------------------------------------- mob classes

class Skeleton extends Mob {
  rangedAttack(target) {
    const arrow = new Arrow(this.world, this.x, this.eyeY - 0.15, this.z, this);
    arrow.damageAmount = this.def.arrowDamage ?? 3;
    arrow.aimAt(target, 1.6, this.def.arrowSpread ?? 0.03, this.rng);
    this.world.addEntity(arrow);
    this.swing();
    this.playSound('bow', { pitch: 1 + this.rng.float(-0.1, 0.1) });
    return arrow;
  }
}

class Creeper extends Mob {
  constructor(world, x, y, z, def) {
    super(world, x, y, z, def);
    this.igniting = false;
    this.fuse = 0;
    this.maxFuse = def.fuse ?? 30;
  }

  /** 0..1, for the renderer's swell and the white flash. */
  get swell() { return Math.min(1, this.fuse / this.maxFuse); }

  ignite() {
    if (!this.igniting) {
      this.igniting = true;
      this.playSound('fuse', { volume: 1.2 });
      this.world.emit('creeperIgnite', { mob: this });
    }
  }

  extinguish() {
    this.igniting = false;
  }

  updateAI() {
    super.updateAI();
    if (!this.isAlive) return;
    if (this.igniting) {
      this.fuse++;
      if (this.fuse >= this.maxFuse) this.detonate();
    } else if (this.fuse > 0) {
      this.fuse -= 2;
      if (this.fuse < 0) this.fuse = 0;
    }
  }

  detonate() {
    const power = this.def.blastPower ?? 3;
    // Remove first so the blast cannot damage the creeper it came from.
    this.remove();
    explode(this.world, this.x, this.y + this.height * 0.5, this.z, power, this);
  }
}

class Spider extends Mob {
  /** Spiders are only hostile in the dark, but stay angry once provoked. */
  isDark() {
    return this.world.getLightLevel(
      Math.floor(this.x), Math.floor(this.y), Math.floor(this.z),
    ) <= 11;
  }

  updateAI() {
    super.updateAI();
    // Any wall it is pressed against is treated as a ladder.
    this.climbUp = this.horizontalCollision && (this.target !== null || this.forwardInput !== 0);
  }
}

class HollowWarden extends Mob {
  constructor(world, x, y, z, def) {
    super(world, x, y, z, def);
    this.phase = 1;
    this.rage = false;
    this.slamCharge = 0;
    this.slamCooldown = 80;
    this.slamInterval = def.slamInterval ?? 160;
    this.summonCooldown = 200;
    this.adds = [];
  }

  updateAI() {
    if (this.isAlive) {
      const phase = this.health > 80 ? 1 : this.health > 40 ? 2 : 3;
      if (phase !== this.phase) this.enterPhase(phase);
      if (this.slamCooldown > 0) this.slamCooldown--;
      if (this.summonCooldown > 0) this.summonCooldown--;
    }
    super.updateAI();
    if (!this.isAlive) return;
    if (this.phase >= 2 && this.summonCooldown <= 0 && this.target) this.summonAdds();
  }

  enterPhase(phase) {
    this.phase = phase;
    if (phase === 2) {
      this.moveSpeed = 0.32;
      this.attackInterval = 18;
      this.slamInterval = 130;
      this.summonCooldown = 40;
    } else if (phase === 3) {
      // Rage: it stops flinching and closes the distance fast.
      this.rage = true;
      this.moveSpeed = 0.38;
      this.attackInterval = 12;
      this.slamInterval = 75;
      this.knockbackResistance = 0.9;
      this.summonCooldown = 30;
    }
    this.playSound('boss_roar', { volume: 2, pitch: phase === 3 ? 0.75 : 1 });
    this.world.emit('bossPhase', {
      mob: this, phase, rage: this.rage, health: this.health, maxHealth: this.maxHealth,
    });
  }

  groundSlam() {
    const radius = this.def.slamRadius ?? 5;
    const damage = this.def.slamDamage ?? 9;
    this.slamCharge = 0;
    this.slamCooldown = this.slamInterval;
    this.playSound('boss_roar', { volume: 2, pitch: 0.85 });
    this.world.emit('bossSlam', { mob: this, x: this.x, y: this.y, z: this.z, radius });

    for (const e of this.world.entitiesNear(this.x, this.y, this.z, radius)) {
      if (e === this || e.dead || typeof e.damage !== 'function') continue;
      if (e.mobType === 'withered_husk') continue;      // its own adds ride it out
      const f = 1 - this.distanceTo(e) / radius;
      if (f <= 0) continue;
      e.damage(Math.max(1, Math.ceil(damage * f)), this);
      e.vy = Math.max(e.vy, 0.15 + 0.45 * f);
    }
  }

  summonAdds() {
    this.adds = this.adds.filter((m) => m && !m.dead && m.isAlive);
    const max = this.phase >= 3 ? 4 : 3;
    if (this.adds.length >= max) { this.summonCooldown = 100; return; }

    const count = Math.min(2, max - this.adds.length);
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const d = this.rng.float(2.5, 4.5);
      const bx = Math.floor(this.x + Math.cos(a) * d);
      const bz = Math.floor(this.z + Math.sin(a) * d);
      const by = this.world.findSpawnY(bx, bz, Math.floor(this.y) + 3);
      const add = spawnMob(this.world, 'withered_husk', bx + 0.5, by, bz + 0.5);
      if (!add) continue;
      add.owner = this;
      add.persistent = true;
      add.target = this.target;
      this.adds.push(add);
      spawned++;
    }
    this.summonCooldown = this.phase >= 3 ? 200 : 320;
    if (spawned > 0) {
      this.playSound('boss_roar', { volume: 1.5, pitch: 1.15 });
      this.world.emit('bossSummon', { mob: this, count: spawned });
    }
  }

  onDeath(source) {
    // The adds are bound to it; they collapse quietly rather than counting as kills.
    for (const add of this.adds) add?.remove?.();
    this.adds.length = 0;
    this.world.emit('bossDefeated', { mob: this, killer: isPlayerEntity(source) ? source : null });
    super.onDeath(source);
  }
}

// ---------------------------------------------------------------- AI recipes

function hostileMelee(m, opts = {}) {
  m.goals.add(0, new FloatGoal(m));
  m.goals.add(2, new MeleeAttackGoal(m, { speed: opts.chaseSpeed ?? 1, reachBonus: opts.reachBonus ?? 0.4 }));
  if (opts.avoidsSun) m.goals.add(3, new AvoidSunGoal(m, { speed: 1 }));
  m.goals.add(5, new WanderGoal(m, { speed: 0.8 }));
  m.goals.add(6, new LookAtPlayerGoal(m, { range: 8 }));
  m.targets.add(0, new FollowTargetGoal(m, {
    range: m.followRange,
    require: opts.require ?? null,
    requireSight: opts.requireSight !== false,
  }));
}

function passiveHerd(m, opts = {}) {
  m.goals.add(0, new FloatGoal(m));
  m.goals.add(1, new PanicGoal(m, { speed: opts.panicSpeed ?? 1.25 }));
  if (opts.breedItems?.length) {
    m.goals.add(3, new TemptGoal(m, { items: opts.breedItems, speed: 1.1 }));
  }
  m.goals.add(5, new WanderGoal(m, { speed: 0.8, radius: 10 }));
  m.goals.add(6, new LookAtPlayerGoal(m, { range: 6 }));
}

// ---------------------------------------------------------------- registry

/** @type {Object<string, object>} */
export const MOB_TYPES = Object.create(null);

const DEFAULTS = {
  display: '',
  cls: Mob,
  model: null,
  health: 20,
  damage: 0,
  speed: 0.23,
  width: 0.6,
  height: 1.8,
  hostile: false,
  boss: false,
  followRange: 16,
  knockbackResistance: 0,
  armor: 0,
  xp: 0,
  burnsInSun: false,
  climbs: false,
  slowFall: false,
  persistent: false,
  retaliates: false,
  attackInterval: 20,
  breedItems: null,
  loot: null,
  sounds: null,
  build: null,
};

function register(name, o) {
  const def = Object.assign({ name }, DEFAULTS, o);
  if (!def.display) {
    def.display = name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  if (!def.model) def.model = name;
  MOB_TYPES[name] = def;
  return def;
}

register('zombie', {
  display: 'Zombie',
  health: 20, damage: 3, speed: 0.23, width: 0.6, height: 1.95,
  hostile: true, followRange: 35, armor: 2, xp: 5, burnsInSun: true,
  sounds: { idle: 'zombie_idle', hurt: 'zombie_hurt', death: 'zombie_death', attack: 'hurt' },
  loot: [
    { item: 'rotten_flesh', min: 0, max: 2 },
    { item: 'iron_ingot', min: 1, max: 1, chance: 0.025, playerOnly: true },
  ],
  build: (m) => hostileMelee(m, { avoidsSun: true }),
});

register('skeleton', {
  display: 'Skeleton',
  cls: Skeleton,
  health: 20, damage: 2, speed: 0.25, width: 0.6, height: 1.99,
  hostile: true, followRange: 16, xp: 5, burnsInSun: true,
  arrowDamage: 3, arrowSpread: 0.03,
  sounds: { idle: 'skeleton_idle', hurt: 'skeleton_hurt', death: 'death' },
  loot: [
    { item: 'bone', min: 0, max: 2 },
    { item: 'arrow', min: 0, max: 2 },
    { item: 'bow', min: 1, max: 1, chance: 0.085, playerOnly: true },
  ],
  build: (m) => {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(2, new RangedAttackGoal(m, {
      interval: 50, minDistance: 4, maxDistance: 15, speed: 1,
    }));
    m.goals.add(3, new AvoidSunGoal(m, { speed: 1 }));
    m.goals.add(5, new WanderGoal(m, { speed: 0.8 }));
    m.goals.add(6, new LookAtPlayerGoal(m, { range: 8 }));
    m.targets.add(0, new FollowTargetGoal(m, { range: 16 }));
  },
});

register('creeper', {
  display: 'Creeper',
  cls: Creeper,
  health: 20, damage: 0, speed: 0.25, width: 0.6, height: 1.7,
  hostile: true, followRange: 16, xp: 5,
  fuse: 30, blastPower: 3, ignitionDistance: 3, abortDistance: 7,
  sounds: { idle: null, hurt: 'hurt', death: 'death' },
  loot: [{ item: 'gunpowder', min: 0, max: 2 }],
  build: (m) => {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new SwellGoal(m));
    m.goals.add(2, new MeleeAttackGoal(m, { speed: 1, pauseInReach: true, reachBonus: 1.2 }));
    m.goals.add(5, new WanderGoal(m, { speed: 0.8 }));
    m.goals.add(6, new LookAtPlayerGoal(m, { range: 8 }));
    m.targets.add(0, new FollowTargetGoal(m, { range: 16 }));
  },
});

register('spider', {
  display: 'Spider',
  cls: Spider,
  health: 16, damage: 2, speed: 0.3, width: 1.4, height: 0.9,
  hostile: true, followRange: 16, xp: 5, climbs: true, retaliates: true,
  sounds: { idle: 'spider_hiss', hurt: 'hurt', death: 'death' },
  loot: [
    { item: 'string', min: 0, max: 2 },
    { item: 'spider_eye', min: 1, max: 1, chance: 0.33, playerOnly: true },
  ],
  build: (m) => hostileMelee(m, { require: (mob) => mob.isDark() }),
});

register('withered_husk', {
  display: 'Withered Husk',
  model: 'zombie',
  health: 16, damage: 3, speed: 0.24, width: 0.6, height: 1.95,
  hostile: true, followRange: 24, xp: 5, armor: 1,
  sounds: { idle: 'zombie_idle', hurt: 'zombie_hurt', death: 'zombie_death' },
  loot: [
    { item: 'bone', min: 0, max: 1 },
    { item: 'rotten_flesh', min: 0, max: 1 },
    { item: 'ember_shard', min: 1, max: 1, chance: 0.2, playerOnly: true },
  ],
  build: (m) => {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(2, new MeleeAttackGoal(m, { speed: 1 }));
    m.goals.add(4, new FollowOwnerGoal(m, { startDistance: 12, stopDistance: 4 }));
    m.goals.add(5, new WanderGoal(m, { speed: 0.8 }));
    m.goals.add(6, new LookAtPlayerGoal(m, { range: 8 }));
    m.targets.add(0, new FollowTargetGoal(m, { range: 24, requireSight: false }));
  },
});

register('hollow_warden', {
  display: 'The Hollow Warden',
  cls: HollowWarden,
  model: 'boss',
  health: 120, damage: 7, speed: 0.28, width: 1.2, height: 2.9,
  hostile: true, boss: true, persistent: true, followRange: 40,
  knockbackResistance: 0.6, armor: 4, xp: 200, attackInterval: 24,
  slamRadius: 5, slamDamage: 9, slamWindup: 30, slamInterval: 160,
  sounds: { idle: 'boss_roar', hurt: 'hurt', death: 'boss_roar' },
  loot: [{ item: 'ember_core', min: 1, max: 1 }],
  build: (m) => {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new SlamGoal(m));
    m.goals.add(2, new MeleeAttackGoal(m, { speed: 1, reachBonus: 0.8 }));
    m.goals.add(5, new WanderGoal(m, { speed: 0.6, radius: 6 }));
    m.targets.add(0, new FollowTargetGoal(m, { range: 40, requireSight: false }));
  },
});

register('pig', {
  display: 'Pig',
  health: 10, speed: 0.25, width: 0.9, height: 0.9, xp: 2,
  breedItems: ['carrot', 'potato', 'wheat_seeds'],
  sounds: { idle: 'pig', hurt: 'pig', death: 'pig' },
  loot: [{ item: 'porkchop', min: 1, max: 3 }],
  build: (m) => passiveHerd(m, { breedItems: m.def.breedItems }),
});

register('cow', {
  display: 'Cow',
  health: 10, speed: 0.2, width: 0.9, height: 1.4, xp: 2,
  breedItems: ['wheat'],
  sounds: { idle: 'cow', hurt: 'cow', death: 'cow' },
  loot: [
    { item: 'beef', min: 1, max: 3 },
    { item: 'leather', min: 0, max: 2 },
  ],
  build: (m) => passiveHerd(m, { breedItems: m.def.breedItems, panicSpeed: 2 }),
});

register('sheep', {
  display: 'Sheep',
  health: 8, speed: 0.23, width: 0.9, height: 1.3, xp: 2,
  breedItems: ['wheat'],
  sounds: { idle: 'sheep', hurt: 'sheep', death: 'sheep' },
  loot: [
    { item: 'white_wool', min: 1, max: 1 },
    { item: 'mutton', min: 1, max: 2 },
  ],
  build: (m) => passiveHerd(m, { breedItems: m.def.breedItems }),
});

register('chicken', {
  display: 'Chicken',
  health: 4, speed: 0.25, width: 0.4, height: 0.7, xp: 2, slowFall: true,
  breedItems: ['wheat_seeds'],
  sounds: { idle: 'chicken', hurt: 'chicken', death: 'chicken' },
  loot: [
    { item: 'feather', min: 0, max: 2 },
    { item: 'chicken', min: 1, max: 1 },
  ],
  build: (m) => passiveHerd(m, { breedItems: m.def.breedItems, panicSpeed: 1.4 }),
});

// ---------------------------------------------------------------- factory

/**
 * The registry-driven spawn used by worldgen, the story and the spawn cycle.
 * Returns null for an unknown type rather than throwing, so a bad name in a
 * quest script degrades to "nothing spawned".
 */
export function spawnMob(world, type, x, y, z) {
  const def = MOB_TYPES[type];
  if (!def || !world) return null;
  const Cls = def.cls || Mob;
  const mob = new Cls(world, x, y, z, def);
  world.addEntity(mob);
  mob.initAI();
  world.emit('mobSpawned', mob);
  return mob;
}

/** Rebuilds a saved mob, including its AI. */
export function mobFromJSON(world, data) {
  const mob = spawnMob(world, data.mobType || data.type, data.x, data.y, data.z);
  return mob ? mob.applyJSON(data) : null;
}

export { Skeleton, Creeper, Spider, HollowWarden, SwellGoal, SlamGoal };
