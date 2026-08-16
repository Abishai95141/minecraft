// Prioritised goal AI. Each goal answers canUse/canContinue and the selector
// runs the highest-priority usable goal per behaviour slot (move, look, jump,
// target). Pathing is deliberately greedy — step, jump, refuse a killing drop.

import { angleDelta, clamp } from '../core/math.js';
import { IS_SOLID } from '../world/blocks.js';

/** Behaviour slots. Two goals may run together only if their flags disjoin. */
export const GoalFlag = { MOVE: 1, LOOK: 2, JUMP: 4, TARGET: 8 };

/** Body yaw turn rate, matching MoveControl's 90 degrees per tick. */
export const TURN_RATE = Math.PI / 2;
/** Head yaw turn rate — slower, so mobs read as looking rather than snapping. */
export const HEAD_TURN_RATE = Math.PI / 4;
/** A greedy walker will not step off anything taller than this. */
export const MAX_DROP = 3;

// ---------------------------------------------------------------- helpers

const rngOf = (mob) => mob.rng ?? mob.world.rng;

/** Yaw that points `entity` at a horizontal position, in the game's convention. */
export function yawToward(entity, x, z) {
  return Math.atan2(-(x - entity.x), z - entity.z);
}

export function turnTowards(entity, targetYaw, maxStep = TURN_RATE) {
  entity.yaw += clamp(angleDelta(entity.yaw, targetYaw), -maxStep, maxStep);
}

/** Turns only the head, so a walking mob can still watch you. */
export function turnHead(mob, x, y, z, maxStep = HEAD_TURN_RATE) {
  const target = yawToward(mob, x, z);
  const cur = mob.headYaw ?? mob.yaw;
  mob.headYaw = cur + clamp(angleDelta(cur, target), -maxStep, maxStep);
  const h = Math.hypot(x - mob.x, z - mob.z);
  mob.pitch = Math.atan2(-(y - mob.eyeY), h);
}

/**
 * How far it is down from the block under (x, y, z) to the first solid block.
 * Returns max + 1 when nothing was found, which reads as "bottomless".
 */
export function dropAhead(world, x, y, z, max = MAX_DROP + 1) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const top = Math.floor(y) - 1;
  for (let d = 0; d <= max; d++) {
    if (IS_SOLID[world.getBlock(bx, top - d, bz)]) return d;
  }
  return max + 1;
}

export function stopMoving(mob) {
  mob.forwardInput = 0;
  mob.strafeInput = 0;
  mob.jumping = false;
}

/**
 * One greedy step toward a position: face it, walk, jump the one-block steps
 * the 0.6 auto-step cannot clear, and stop rather than walk off a cliff.
 * Returns false when the step was refused.
 */
export function stepToward(mob, tx, ty, tz, speedModifier = 1) {
  mob.speedModifier = speedModifier;
  const dx = tx - mob.x, dz = tz - mob.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) { mob.forwardInput = 0; return true; }

  turnTowards(mob, Math.atan2(-dx, dz));
  mob.headYaw = mob.yaw;

  const world = mob.world;
  const reach = mob.width * 0.5 + 0.35;
  const aheadX = mob.x + (dx / dist) * reach;
  const aheadZ = mob.z + (dz / dist) * reach;

  if (mob.onGround && !mob.inWater && dropAhead(world, aheadX, mob.y, aheadZ) > MAX_DROP) {
    mob.forwardInput = 0;
    return false;
  }

  mob.forwardInput = 1;

  if (mob.inWater || mob.inLava) {
    mob.jumping = true;
  } else if (mob.onGround && mob.horizontalCollision) {
    const bx = Math.floor(aheadX), bz = Math.floor(aheadZ), by = Math.floor(mob.y);
    const clearAbove = !IS_SOLID[world.getBlock(bx, by + 1, bz)] &&
                       !IS_SOLID[world.getBlock(bx, by + 2, bz)];
    if (IS_SOLID[world.getBlock(bx, by, bz)] && clearAbove) mob.jumping = true;
  }
  return true;
}

/** Picks a standable spot near the mob. Returns [x, y, z] or null. */
export function randomWalkTarget(mob, radius = 8, vertical = 4) {
  const r = rngOf(mob);
  const world = mob.world;
  for (let i = 0; i < 10; i++) {
    const a = r.float(0, Math.PI * 2);
    const d = r.float(2, radius);
    const x = Math.floor(mob.x + Math.cos(a) * d);
    const z = Math.floor(mob.z + Math.sin(a) * d);
    const y0 = Math.floor(mob.y);
    for (let dy = 0; dy <= vertical; dy++) {
      if (world.canStandAt(x, y0 + dy, z)) return [x + 0.5, y0 + dy, z + 0.5];
      if (dy > 0 && world.canStandAt(x, y0 - dy, z)) return [x + 0.5, y0 - dy, z + 0.5];
    }
  }
  return null;
}

/** A standable spot roughly `distance` blocks away from (ax, az). */
export function fleeTarget(mob, ax, az, distance = 10) {
  const r = rngOf(mob);
  const world = mob.world;
  let awayX = mob.x - ax, awayZ = mob.z - az;
  const len = Math.hypot(awayX, awayZ);
  if (len < 1e-3) { awayX = 1; awayZ = 0; } else { awayX /= len; awayZ /= len; }
  for (let i = 0; i < 10; i++) {
    const spread = r.float(-0.9, 0.9);
    const dirX = awayX + spread * -awayZ;
    const dirZ = awayZ + spread * awayX;
    const l = Math.hypot(dirX, dirZ) || 1;
    const x = Math.floor(mob.x + (dirX / l) * distance);
    const z = Math.floor(mob.z + (dirZ / l) * distance);
    const y0 = Math.floor(mob.y);
    for (let dy = 0; dy <= 4; dy++) {
      if (world.canStandAt(x, y0 + dy, z)) return [x + 0.5, y0 + dy, z + 0.5];
      if (dy > 0 && world.canStandAt(x, y0 - dy, z)) return [x + 0.5, y0 - dy, z + 0.5];
    }
  }
  return null;
}

/** The item name a nearby entity is holding, if it exposes an inventory. */
export function heldItemName(entity) {
  const stack = entity?.inventory?.held;
  if (!stack || stack.isEmpty) return null;
  return stack.item?.name ?? null;
}

// ---------------------------------------------------------------- selector

export class Goal {
  constructor(mob) {
    this.mob = mob;
    this.priority = 0;
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK;
  }
  canUse() { return false; }
  canContinue() { return this.canUse(); }
  start() {}
  stop() {}
  tick() {}
}

/**
 * Runs, per behaviour slot, the highest-priority goal that says it can. Lower
 * priority numbers win — a newly usable goal preempts a running lower one.
 */
export class GoalSelector {
  constructor(mob) {
    this.mob = mob;
    this.entries = [];
    this.running = new Set();
  }

  add(priority, goal) {
    goal.priority = priority;
    this.entries.push(goal);
    this.entries.sort((a, b) => a.priority - b.priority);
    return goal;
  }

  remove(goal) {
    const i = this.entries.indexOf(goal);
    if (i >= 0) this.entries.splice(i, 1);
    if (this.running.delete(goal)) goal.stop();
  }

  clear() {
    for (const g of this.running) g.stop();
    this.running.clear();
    this.entries.length = 0;
  }

  /** The goal currently holding the MOVE slot, for debug overlays. */
  get current() {
    for (const g of this.entries) {
      if (this.running.has(g) && (g.flags & GoalFlag.MOVE)) return g;
    }
    return null;
  }

  tick() {
    let claimed = 0;
    const active = [];
    for (const g of this.entries) {
      if (this.running.has(g)) {
        if ((g.flags & claimed) === 0 && g.canContinue()) {
          claimed |= g.flags;
          active.push(g);
        } else {
          this.running.delete(g);
          g.stop();
        }
        continue;
      }
      if ((g.flags & claimed) !== 0) continue;
      if (!g.canUse()) continue;
      claimed |= g.flags;
      this.running.add(g);
      g.start();
      active.push(g);
    }
    for (const g of active) g.tick();
  }
}

// ---------------------------------------------------------------- goals

/** Keeps a mob's head above water instead of letting it walk into the deep. */
export class FloatGoal extends Goal {
  constructor(mob) {
    super(mob);
    this.flags = GoalFlag.JUMP;
  }
  canUse() { return this.mob.inWater || this.mob.inLava; }
  canContinue() { return this.canUse(); }
  tick() {
    this.mob.jumping = true;
    this.mob.fallDistance = 0;
  }
}

/** Bolts away after being hurt or set alight. */
export class PanicGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK | GoalFlag.JUMP;
    this.speed = opts.speed ?? 1.25;
    this.distance = opts.distance ?? 10;
    this.timer = 0;
    this.dest = null;
  }
  canUse() {
    const m = this.mob;
    if (m.hurtTime <= 0 && m.fireTicks <= 0 && m.panicTicks <= 0) return false;
    const src = m.lastDamageSource;
    this.dest = typeof src === 'object' && src && typeof src.x === 'number'
      ? fleeTarget(m, src.x, src.z, this.distance)
      : randomWalkTarget(m, this.distance);
    return this.dest !== null;
  }
  canContinue() { return this.timer > 0 && this.dest !== null; }
  start() { this.timer = 70; }
  stop() { this.dest = null; this.mob.panicTicks = 0; stopMoving(this.mob); }
  tick() {
    this.timer--;
    if (this.mob.panicTicks > 0) this.mob.panicTicks--;
    const [x, y, z] = this.dest;
    if (Math.hypot(x - this.mob.x, z - this.mob.z) < 1) { this.timer = 0; return; }
    if (!stepToward(this.mob, x, y, z, this.speed)) this.timer = 0;
  }
}

/** Walks into melee range and swings on a cooldown. */
export class MeleeAttackGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK | GoalFlag.JUMP;
    this.speed = opts.speed ?? 1;
    this.reachBonus = opts.reachBonus ?? 0.4;
    this.pauseInReach = opts.pauseInReach ?? false;
  }
  canUse() {
    const t = this.mob.target;
    return !!t && t.isAlive !== false && !t.dead;
  }
  canContinue() {
    const t = this.mob.target;
    if (!t || t.dead || t.isAlive === false) return false;
    return this.mob.distanceTo(t) <= this.mob.followRange * 1.5;
  }
  stop() { stopMoving(this.mob); }
  tick() {
    const m = this.mob;
    const t = m.target;
    turnHead(m, t.x, t.y + t.height * 0.5, t.z, TURN_RATE);
    const reach = m.width * 0.5 + t.width * 0.5 + 1 + this.reachBonus;
    const d = Math.hypot(t.x - m.x, t.z - m.z);
    if (d > reach || !this.pauseInReach) stepToward(m, t.x, t.y, t.z, this.speed);
    else stopMoving(m);
    if (m.attackDamage > 0 && d <= reach && Math.abs(t.y - m.y) < 2.5 &&
        m.attackCooldown <= 0 && m.canSee(t)) {
      m.attackTarget(t);
    }
  }
}

/** Keeps its distance, strafes, and fires on an interval. */
export class RangedAttackGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK;
    this.speed = opts.speed ?? 1;
    this.interval = opts.interval ?? 60;
    this.minDistance = opts.minDistance ?? 4;
    this.maxDistance = opts.maxDistance ?? 15;
    this.cooldown = 0;
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.seenTicks = 0;
  }
  canUse() {
    const t = this.mob.target;
    return !!t && !t.dead && t.isAlive !== false;
  }
  canContinue() {
    const t = this.mob.target;
    if (!t || t.dead || t.isAlive === false) return false;
    return this.mob.distanceTo(t) <= this.mob.followRange * 1.5;
  }
  start() { this.cooldown = Math.floor(this.interval / 2); }
  stop() { stopMoving(this.mob); this.seenTicks = 0; }
  tick() {
    const m = this.mob;
    const t = m.target;
    const d = Math.hypot(t.x - m.x, t.z - m.z);
    const seen = m.canSee(t);
    this.seenTicks = seen ? this.seenTicks + 1 : 0;

    // Face the target with the body, so strafing reads as circling.
    turnTowards(m, yawToward(m, t.x, t.z));
    turnHead(m, t.x, t.y + t.height * 0.5, t.z, TURN_RATE);

    if (this.strafeTimer-- <= 0) {
      this.strafeTimer = 30 + (rngOf(m).below(30));
      this.strafeDir = -this.strafeDir;
    }

    m.speedModifier = this.speed;
    m.forwardInput = 0;
    m.strafeInput = 0;
    if (!seen || d > this.maxDistance) {
      stepToward(m, t.x, t.y, t.z, this.speed);
    } else if (d < this.minDistance) {
      m.forwardInput = -0.6;               // back off without turning away
      m.strafeInput = this.strafeDir * 0.6;
    } else {
      m.strafeInput = this.strafeDir;
    }

    if (this.cooldown > 0) this.cooldown--;
    else if (seen && d <= this.maxDistance && this.seenTicks > 4) {
      m.rangedAttack?.(t);
      this.cooldown = this.interval;
    }
  }
}

/** Target selection: adopts the nearest matching entity in range. */
export class FollowTargetGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.TARGET;
    this.range = opts.range ?? mob.followRange ?? 16;
    this.filter = opts.filter ?? ((e) => e.isPlayer === true || e.type === 'player');
    this.require = opts.require ?? null;
    this.requireSight = opts.requireSight !== false;
    this.candidate = null;
    this.loseTicks = 0;
  }
  canUse() {
    const m = this.mob;
    if (m.target && !m.target.dead && m.target.isAlive !== false) return false;
    if (this.require && !this.require(m)) return false;
    const found = m.world.nearestEntity(m.x, m.y, m.z, this.range,
      (e) => e !== m && !e.dead && e.isAlive !== false && this.filter(e));
    if (!found) return false;
    if (this.requireSight && !m.canSee(found)) return false;
    this.candidate = found;
    return true;
  }
  canContinue() {
    const t = this.mob.target;
    if (!t || t.dead || t.isAlive === false) return false;
    if (this.mob.distanceTo(t) > this.range * 1.6) return false;
    this.loseTicks = this.mob.canSee(t) ? 0 : this.loseTicks + 1;
    return this.loseTicks < 100;
  }
  start() { this.mob.target = this.candidate; this.loseTicks = 0; }
  stop() { this.mob.target = null; this.candidate = null; this.loseTicks = 0; }
}

/** Aimless strolling, the default state of everything that is not busy. */
export class WanderGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.JUMP;
    this.speed = opts.speed ?? 0.8;
    this.radius = opts.radius ?? 8;
    this.chance = opts.chance ?? 0.012;
    this.dest = null;
    this.timer = 0;
  }
  canUse() {
    const m = this.mob;
    if (m.target) return false;
    if (rngOf(m).next() > this.chance) return false;
    this.dest = randomWalkTarget(m, this.radius);
    return this.dest !== null;
  }
  canContinue() { return this.dest !== null && this.timer > 0; }
  start() { this.timer = 200; }
  stop() { this.dest = null; stopMoving(this.mob); }
  tick() {
    this.timer--;
    const [x, y, z] = this.dest;
    if (Math.hypot(x - this.mob.x, z - this.mob.z) < 0.8) { this.dest = null; return; }
    if (!stepToward(this.mob, x, y, z, this.speed)) this.dest = null;
  }
}

/** Idle head tracking, so a mob you walk past notices you. */
export class LookAtPlayerGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.LOOK;
    this.range = opts.range ?? 8;
    this.chance = opts.chance ?? 0.03;
    this.filter = opts.filter ?? ((e) => e.isPlayer === true || e.type === 'player');
    this.watching = null;
    this.timer = 0;
  }
  canUse() {
    const m = this.mob;
    if (rngOf(m).next() > this.chance) return false;
    this.watching = m.world.nearestEntity(m.x, m.y, m.z, this.range,
      (e) => e !== m && !e.dead && this.filter(e));
    return this.watching !== null;
  }
  canContinue() {
    return this.timer > 0 && this.watching !== null && !this.watching.dead &&
           this.mob.distanceTo(this.watching) <= this.range * 1.5;
  }
  start() { this.timer = 40 + rngOf(this.mob).below(40); }
  stop() { this.watching = null; }
  tick() {
    this.timer--;
    const w = this.watching;
    turnHead(this.mob, w.x, w.y + w.eyeHeight, w.z);
  }
}

/** Undead running for cover once the sun is up. */
export class AvoidSunGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.JUMP;
    this.speed = opts.speed ?? 1;
    this.dest = null;
    this.timer = 0;
  }
  canUse() {
    const m = this.mob;
    if (!m.burnsInSun || !m.world.isDay || m.inWater) return false;
    if (m.world.getSkyLight(Math.floor(m.x), Math.floor(m.eyeY), Math.floor(m.z)) < 15) return false;
    this.dest = this.findShade();
    return this.dest !== null;
  }
  canContinue() { return this.dest !== null && this.timer > 0; }
  start() { this.timer = 120; }
  stop() { this.dest = null; stopMoving(this.mob); }
  tick() {
    this.timer--;
    const [x, y, z] = this.dest;
    if (Math.hypot(x - this.mob.x, z - this.mob.z) < 0.7) { this.dest = null; return; }
    if (!stepToward(this.mob, x, y, z, this.speed)) this.dest = null;
  }
  findShade() {
    const m = this.mob;
    const world = m.world;
    const r = rngOf(m);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(m.x) + r.int(-8, 8);
      const z = Math.floor(m.z) + r.int(-8, 8);
      const y0 = Math.floor(m.y);
      for (let dy = -3; dy <= 3; dy++) {
        const y = y0 + dy;
        if (!world.canStandAt(x, y, z)) continue;
        if (world.getSkyLight(x, y + 1, z) >= 15) continue;
        return [x + 0.5, y, z + 0.5];
      }
    }
    return null;
  }
}

/** Keeps summoned or tamed mobs near whoever owns them. */
export class FollowOwnerGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK | GoalFlag.JUMP;
    this.speed = opts.speed ?? 1.1;
    this.startDistance = opts.startDistance ?? 8;
    this.stopDistance = opts.stopDistance ?? 3;
  }
  canUse() {
    const o = this.mob.owner;
    if (!o || o.dead) return false;
    if (this.mob.target) return false;
    return this.mob.distanceTo(o) > this.startDistance;
  }
  canContinue() {
    const o = this.mob.owner;
    if (!o || o.dead || this.mob.target) return false;
    return this.mob.distanceTo(o) > this.stopDistance;
  }
  stop() { stopMoving(this.mob); }
  tick() {
    const o = this.mob.owner;
    turnHead(this.mob, o.x, o.y + o.height * 0.5, o.z, TURN_RATE);
    stepToward(this.mob, o.x, o.y, o.z, this.speed);
  }
}

/** Trails a player holding this mob's breeding item. */
export class TemptGoal extends Goal {
  constructor(mob, opts = {}) {
    super(mob);
    this.flags = GoalFlag.MOVE | GoalFlag.LOOK;
    this.items = opts.items ?? [];
    this.range = opts.range ?? 10;
    this.speed = opts.speed ?? 1.1;
    this.stopDistance = opts.stopDistance ?? 1.6;
    this.tempter = null;
  }
  isTempting(e) {
    if (!(e.isPlayer === true || e.type === 'player')) return false;
    const held = heldItemName(e);
    return held !== null && this.items.includes(held);
  }
  canUse() {
    const m = this.mob;
    if (m.panicTicks > 0) return false;
    this.tempter = m.world.nearestEntity(m.x, m.y, m.z, this.range,
      (e) => !e.dead && this.isTempting(e));
    return this.tempter !== null;
  }
  canContinue() {
    return this.tempter !== null && !this.tempter.dead &&
           this.isTempting(this.tempter) &&
           this.mob.distanceTo(this.tempter) <= this.range * 1.5;
  }
  stop() { this.tempter = null; stopMoving(this.mob); }
  tick() {
    const m = this.mob;
    const t = this.tempter;
    turnHead(m, t.x, t.y + t.eyeHeight, t.z, TURN_RATE);
    if (m.distanceTo(t) < this.stopDistance) { stopMoving(m); turnTowards(m, yawToward(m, t.x, t.z)); return; }
    stepToward(m, t.x, t.y, t.z, this.speed);
  }
}
