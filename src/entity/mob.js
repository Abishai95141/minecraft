// Mob: a LivingEntity driven by the goal AI in ai.js. Owns the shared mob
// behaviour — targeting, melee swings, loot drops, daylight burning, despawn —
// and reads its stats from the registry entry mobs.js hands it.

import { LivingEntity } from './entity.js';
import { GoalSelector } from './ai.js';
import { ItemEntity } from './itementity.js';
import { ItemStack } from '../item/inventory.js';
import { Random, hash3 } from '../core/rng.js';
import { MOVE, KNOCKBACK, MOB_DEFAULTS } from '../core/constants.js';
import { ITEMS } from '../item/items.js';

/** Players are duck-typed: entity/player.js sets `isPlayer`, and type is a backstop. */
export function isPlayerEntity(e) {
  return !!e && !e.dead && (e.isPlayer === true || e.type === 'player');
}

export class Mob extends LivingEntity {
  constructor(world, x, y, z, def) {
    super(world, x, y, z);
    this.def = def;
    this.type = def.name;
    this.mobType = def.name;
    this.model = def.model || def.name;
    this.displayName = def.display || def.name;

    this.width = def.width;
    this.height = def.height;
    this.maxHealth = def.health;
    this.health = def.health;
    this.attackDamage = def.damage ?? 0;
    this.moveSpeed = def.speed ?? 0.23;
    this.knockbackResistance = def.knockbackResistance ?? MOB_DEFAULTS.KNOCKBACK_RESISTANCE;
    this.armor = def.armor ?? 0;

    this.hostile = !!def.hostile;
    this.boss = !!def.boss;
    this.followRange = def.followRange ?? 16;
    this.burnsInSun = !!def.burnsInSun;
    this.canClimbWalls = !!def.climbs;
    this.slowFall = !!def.slowFall;
    this.xpReward = def.xp ?? 0;
    this.persistent = !!def.persistent;
    this.attackInterval = def.attackInterval ?? 20;

    this.goals = new GoalSelector(this);
    this.targets = new GoalSelector(this);
    this.target = null;
    this.owner = null;
    this.attackCooldown = 0;
    this.noActionTime = 0;
    this.ambientTimer = 40;
    this.headYaw = this.yaw;
    this.killedBy = null;

    // A per-mob seeded stream: wander, loot and ambient timing stay reproducible.
    this.rng = new Random(hash3(
      Math.floor(x * 8), Math.floor(y * 8), Math.floor(z * 8), world?.seed ?? 0,
    ));
  }

  /** Called by spawnMob once the instance is fully constructed. */
  initAI() {
    this.goals.clear();
    this.targets.clear();
    this.def.build?.(this);
    return this;
  }

  armorPoints() { return this.armor; }

  /** Mobs use the attribute-squared rule: 0.23 -> 2.33 b/s, 0.3 -> 3.96 b/s. */
  movementAccel(slip) {
    if (this.inWater || this.inLava) return MOVE.WATER_ACCEL;
    if (!this.onGround) {
      return (this.sprinting ? MOVE.AIR_ACCEL_SPRINT : MOVE.AIR_ACCEL) * MOVE.INPUT_DAMP;
    }
    const speed = this.moveSpeed * this.speedModifier;
    const k = MOVE.DEFAULT_SLIPPERINESS / slip;
    return speed * speed * k * k * k;
  }

  // ---------------------------------------------------------------- AI

  updateAI() {
    if (!this.isAlive) {
      this.forwardInput = 0;
      this.strafeInput = 0;
      this.jumping = false;
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.panicTicks > 0) this.panicTicks--;
    if (this.target && (this.target.dead || this.target.isAlive === false)) this.target = null;
    this.noActionTime = this.target ? 0 : this.noActionTime + 1;

    // Goals must re-assert their intent every tick, so start from neutral.
    this.forwardInput = 0;
    this.strafeInput = 0;
    this.jumping = false;
    this.speedModifier = 1;

    this.targets.tick();
    this.goals.tick();

    this.updateDaylightBurn();
    this.updateAmbient();
    this.updateDespawn();
  }

  updateDaylightBurn() {
    if (!this.burnsInSun || this.inWater || !this.world.isDay) return;
    if (this.world.skyLightFactor() < 0.85) return;
    const bx = Math.floor(this.x), bz = Math.floor(this.z);
    if (this.world.getSkyLight(bx, Math.floor(this.eyeY), bz) < 15) return;
    this.fireTicks = Math.max(this.fireTicks, 160);
  }

  updateAmbient() {
    if (--this.ambientTimer > 0) return;
    this.ambientTimer = MOB_DEFAULTS.AMBIENT_SOUND_INTERVAL + this.rng.below(80);
    if (this.rng.bool(0.5)) this.playSound(this.def.sounds?.idle, { volume: 0.7 });
  }

  updateDespawn() {
    if (this.persistent || this.boss || this.age % 20 !== 0) return;
    const player = this.nearestPlayer(Infinity);
    if (!player) return;                       // no player loaded yet: keep everything
    const d = this.distanceTo(player);
    if (d > MOB_DEFAULTS.INSTANT_DESPAWN_DISTANCE) { this.remove(); return; }
    if (d > 32 && this.noActionTime > 600 && this.rng.below(40) === 0) this.remove();
  }

  nearestPlayer(range = this.followRange) {
    return this.world.nearestEntity(this.x, this.y, this.z, range, isPlayerEntity);
  }

  /** Clear line of sight from this mob's eyes to the middle of `entity`. */
  canSee(entity) {
    if (!entity) return false;
    const ox = this.x, oy = this.eyeY, oz = this.z;
    const dx = entity.x - ox;
    const dy = (entity.y + entity.height * 0.5) - oy;
    const dz = entity.z - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return true;
    const hit = this.world.raycast([ox, oy, oz], [dx / len, dy / len, dz / len], len);
    return !hit || hit.distance >= len - 0.15;
  }

  // ---------------------------------------------------------------- combat

  attackTarget(target) {
    if (!target || target.dead || target.isAlive === false) return false;
    this.swing();
    this.attackCooldown = this.attackInterval;
    this.playSound(this.def.sounds?.attack);
    // damage() applies the knockback from this mob, so do not add a second one.
    return target.damage?.(this.attackDamage, this) === true;
  }

  onHurt(amount, source) {
    this.noActionTime = 0;
    this.playSound(this.def.sounds?.hurt, { pitch: 1 + this.rng.float(-0.1, 0.1) });
    const isEntity = source && typeof source === 'object' && typeof source.x === 'number';
    if (isEntity && source !== this && source !== this.owner) {
      if (this.hostile || this.def.retaliates) this.target = source;
    }
    if (!this.hostile) this.panicTicks = 60;
  }

  onDeath(source) {
    if (this.deathTime > 0) return;
    this.killedBy = source ?? null;
    super.onDeath(source);
    this.target = null;
    this.playSound(this.def.sounds?.death);
    if (this.xpReward > 0 && isPlayerEntity(source)) source.addXp?.(this.xpReward);
    // The story listens for this; the body still plays its death animation.
    this.world.emit('mobKilled', this);
  }

  dropLoot(source) {
    const entries = this.def.loot;
    if (!entries) return;
    const byPlayer = isPlayerEntity(source);
    for (const entry of entries) {
      if (entry.playerOnly && !byPlayer) continue;
      if (entry.chance != null && !this.rng.bool(entry.chance)) continue;
      const min = entry.min ?? 1;
      const max = entry.max ?? min;
      const n = max > min ? this.rng.int(min, max) : min;
      if (n > 0) this.dropItem(entry.item, n);
    }
  }

  dropItem(name, count = 1) {
    if (!ITEMS[name]) return null;
    const e = new ItemEntity(this.world, this.x, this.y + this.height * 0.5, this.z,
      new ItemStack(name, count));
    e.vx = this.rng.float(-0.08, 0.08);
    e.vy = 0.2;
    e.vz = this.rng.float(-0.08, 0.08);
    this.world.addEntity(e);
    return e;
  }

  knockback(fromX, fromZ, strength = KNOCKBACK.BASE_STRENGTH) {
    super.knockback(fromX, fromZ, strength);
  }

  playSound(name, opts = {}) {
    if (!name) return;
    this.world?.emit('sound', {
      name,
      x: this.x,
      y: this.y + this.height * 0.5,
      z: this.z,
      volume: opts.volume ?? 1,
      pitch: opts.pitch ?? 1,
      source: this,
    });
  }

  // ---------------------------------------------------------------- save

  toJSON() {
    const o = super.toJSON();
    o.mobType = this.mobType;
    o.persistent = this.persistent;
    return o;
  }

  applyJSON(data) {
    super.applyJSON(data);
    if (data.persistent != null) this.persistent = !!data.persistent;
    return this;
  }
}
