// Dropped items: they bob and spin, merge with identical stacks nearby, drift
// into a player who gets close, and give up on the world after five minutes.

import { Entity } from './entity.js';
import { ItemStack } from '../item/inventory.js';
import { hash3f } from '../core/rng.js';

/** Ticks before a fresh drop can be picked up — long enough to throw one away. */
export const ITEM_PICKUP_DELAY = 10;
/** Five minutes, the vanilla lifetime. */
export const ITEM_DESPAWN_TICKS = 6000;
/** Radius within which a stack drifts toward a player. */
export const ITEM_ATTRACT_RANGE = 1.5;
/** Radius within which two identical stacks fuse. */
export const ITEM_MERGE_RANGE = 0.6;

export class ItemEntity extends Entity {
  constructor(world, x, y, z, stack = null) {
    super(world, x, y, z);
    this.type = 'item';
    this.model = 'item';
    this.stack = stack;
    this.width = 0.25;
    this.height = 0.25;
    this.noHit = true;
    this.pickupDelay = ITEM_PICKUP_DELAY;
    this.lifetime = ITEM_DESPAWN_TICKS;

    // Items are lighter than mobs and keep more of their horizontal speed.
    this.gravity = 0.04;
    this.verticalDrag = 0.98;
    this.airDrag = 0.98;

    // Deterministic so a reloaded save does not resynchronise every drop.
    this.bobOffset = hash3f(Math.floor(x * 16), Math.floor(y * 16), Math.floor(z * 16),
      world?.seed ?? 0) * Math.PI * 2;
    this.bob = this.bobOffset;
    this.prevBob = this.bob;
    this.spin = this.bobOffset;
    this.prevSpin = this.spin;
  }

  /** Vertical offset the renderer should apply, in blocks. */
  get bobHeight() { return Math.sin(this.bob) * 0.08 + 0.08; }

  get itemName() { return this.stack?.item?.name ?? null; }

  updateAI() {
    if (!this.stack || this.stack.isEmpty) { this.remove(); return; }

    this.prevBob = this.bob;
    this.prevSpin = this.spin;
    this.bob += 0.1;
    this.spin += 0.06;

    if (this.pickupDelay > 0) this.pickupDelay--;

    // Lava eats drops; water floats them back to the surface.
    if (this.inLava) { this.remove(); return; }
    if (this.inWater) this.vy += 0.02;

    if (this.age % 5 === 0) this.tryMerge();
    this.attractToPlayer();

    if (this.age >= this.lifetime) this.remove();
  }

  /** Fuses with identical stacks so a mined vein does not spawn a swarm. */
  tryMerge() {
    const stack = this.stack;
    if (!stack || stack.count >= stack.maxStack) return;
    const near = this.world.entitiesNear(this.x, this.y, this.z, ITEM_MERGE_RANGE,
      (e) => e !== this && e instanceof ItemEntity && !e.dead && e.stack && !e.stack.isEmpty);
    for (const other of near) {
      if (!stack.canStackWith(other.stack)) continue;
      const room = stack.maxStack - stack.count;
      if (room <= 0) return;
      const moved = Math.min(room, other.stack.count);
      if (moved <= 0) continue;
      stack.grow(moved);
      other.stack.shrink(moved);
      this.pickupDelay = Math.max(this.pickupDelay, other.pickupDelay);
      this.age = Math.min(this.age, other.age);
      if (other.stack.isEmpty || other.stack.count <= 0) other.remove();
    }
  }

  attractToPlayer() {
    if (this.pickupDelay > 0) return;
    const player = this.world.nearestEntity(this.x, this.y, this.z, ITEM_ATTRACT_RANGE,
      (e) => (e.isPlayer === true || e.type === 'player') && !e.dead && e.isAlive !== false);
    if (!player) return;

    const tx = player.x;
    const ty = player.y + player.height * 0.35;
    const tz = player.z;
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) { this.pickUpBy(player); return; }

    const pull = 0.055;
    this.vx += (dx / d) * pull;
    this.vy += (dy / d) * pull * 0.8;
    this.vz += (dz / d) * pull;
    if (d < 0.7) this.pickUpBy(player);
  }

  /**
   * Hands the stack to a player. Guarded, because inventory wiring comes up in
   * a later stage than the world does.
   */
  pickUpBy(player) {
    const inv = player.inventory;
    if (!inv || typeof inv.add !== 'function') return false;
    const before = this.stack.count;
    const rest = inv.add(this.stack);
    const taken = before - (rest && !rest.isEmpty ? rest.count : 0);
    if (taken <= 0) return false;

    this.world.emit('itemPicked', {
      player,
      entity: this,
      item: this.itemName,
      count: taken,
    });
    player.playSound?.('pop');

    if (!rest || rest.isEmpty) this.remove();
    else this.stack = rest;
    return true;
  }

  damage(amount, source = null) {
    // Only fire and the void destroy drops; nothing else can hit them.
    if (source === 'lava' || source === 'fire' || source === 'void') {
      this.remove();
      return true;
    }
    return super.damage(amount, source);
  }

  toJSON() {
    const o = super.toJSON();
    o.stack = this.stack ? this.stack.toJSON() : null;
    o.pickupDelay = this.pickupDelay;
    return o;
  }

  applyJSON(data) {
    super.applyJSON(data);
    this.pickupDelay = data.pickupDelay ?? 0;
    if (data.stack) this.stack = ItemStack.fromJSON(data.stack);
    return this;
  }

  static fromJSON(world, data) {
    const e = new ItemEntity(world, data.x, data.y, data.z,
      data.stack ? ItemStack.fromJSON(data.stack) : null);
    return e.applyJSON(data);
  }
}

/**
 * Spawns a drop with the small random pop vanilla gives it. `rng` must be a
 * seeded stream when the drop is world state rather than pure feedback.
 */
export function dropItemStack(world, x, y, z, stack, opts = {}) {
  if (!stack || stack.isEmpty) return null;
  const e = new ItemEntity(world, x, y, z, stack);
  const rng = opts.rng ?? world.rng;
  const spread = opts.spread ?? 0.1;
  e.vx = (rng.next() - 0.5) * spread;
  e.vy = opts.vy ?? 0.2;
  e.vz = (rng.next() - 0.5) * spread;
  if (opts.pickupDelay != null) e.pickupDelay = opts.pickupDelay;
  world.addEntity(e);
  return e;
}
