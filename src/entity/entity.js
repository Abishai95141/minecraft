// Entity physics: a swept-AABB resolve against the world using vanilla's exact
// per-tick order (accel, move, gravity, drag, cutoff), plus the living layer on
// top of it — health, knockback, fall damage and limb animation.

import { AABB, angleDelta, clamp, lerp } from '../core/math.js';
import {
  MOVE, DAMAGE, KNOCKBACK, PLAYER,
  groundAccel, groundDrag, applyKnockback, fallDamage,
} from '../core/constants.js';
import { B } from '../world/blocks.js';

/** Padding on the swept query box so a box we are about to touch is collected. */
const EPS = 1e-7;
/** Granularity of the sneak ledge search, matching maybeBackOffFromEdge. */
const LEDGE_STEP = 0.05;

// ---------------------------------------------------------------- clipping

function clipX(b, box, dx) {
  if (box.maxY <= b.minY || box.minY >= b.maxY) return dx;
  if (box.maxZ <= b.minZ || box.minZ >= b.maxZ) return dx;
  if (dx > 0 && box.maxX <= b.minX) {
    const d = b.minX - box.maxX;
    if (d < dx) dx = d;
  } else if (dx < 0 && box.minX >= b.maxX) {
    const d = b.maxX - box.minX;
    if (d > dx) dx = d;
  }
  return dx;
}

function clipY(b, box, dy) {
  if (box.maxX <= b.minX || box.minX >= b.maxX) return dy;
  if (box.maxZ <= b.minZ || box.minZ >= b.maxZ) return dy;
  if (dy > 0 && box.maxY <= b.minY) {
    const d = b.minY - box.maxY;
    if (d < dy) dy = d;
  } else if (dy < 0 && box.minY >= b.maxY) {
    const d = b.maxY - box.minY;
    if (d > dy) dy = d;
  }
  return dy;
}

function clipZ(b, box, dz) {
  if (box.maxX <= b.minX || box.minX >= b.maxX) return dz;
  if (box.maxY <= b.minY || box.minY >= b.maxY) return dz;
  if (dz > 0 && box.maxZ <= b.minZ) {
    const d = b.minZ - box.maxZ;
    if (d < dz) dz = d;
  } else if (dz < 0 && box.minZ >= b.maxZ) {
    const d = b.maxZ - box.minZ;
    if (d > dz) dz = d;
  }
  return dz;
}

/**
 * Resolves a movement against a set of blocking boxes, Y first then X then Z —
 * the order matters, it is what lets you walk along a wall without sticking.
 */
function slide(box, dx, dy, dz, boxes) {
  let ry = dy;
  if (ry !== 0) {
    for (let i = 0; i < boxes.length; i++) ry = clipY(boxes[i], box, ry);
    if (ry !== 0) box = box.offset(0, ry, 0);
  }
  let rx = dx;
  if (rx !== 0) {
    for (let i = 0; i < boxes.length; i++) rx = clipX(boxes[i], box, rx);
    if (rx !== 0) box = box.offset(rx, 0, 0);
  }
  let rz = dz;
  if (rz !== 0) {
    for (let i = 0; i < boxes.length; i++) rz = clipZ(boxes[i], box, rz);
    if (rz !== 0) box = box.offset(0, 0, rz);
  }
  return { dx: rx, dy: ry, dz: rz, box };
}

// ---------------------------------------------------------------- Entity

export class Entity {
  constructor(world, x, y, z) {
    this.id = 0;
    this.world = world;
    this.type = 'entity';
    /** Model key for render/models.js; null means "not rendered as a model". */
    this.model = null;

    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.prevYaw = 0; this.prevPitch = 0;

    this.width = 0.6;
    this.height = 1.8;

    this.onGround = false;
    this.horizontalCollision = false;
    this.verticalCollision = false;
    this.inWater = false;
    this.inLava = false;

    this.dead = false;
    this.noHit = false;
    this.noClip = false;
    this.invulnerable = false;
    this.isPlayer = false;

    this.age = 0;
    this.hurtTime = 0;
    this.fallDistance = 0;
    this.sneaking = false;

    /** Per-entity gravity so items and arrows can fall differently. */
    this.hasGravity = true;
    this.gravity = MOVE.GRAVITY;
    this.verticalDrag = MOVE.VERTICAL_DRAG;
    this.airDrag = MOVE.AIR_DRAG;

    this._boxes = [];
  }

  // ------------------------------------------------------------ geometry

  get eyeHeight() { return this.height * 0.85; }
  get eyeY() { return this.y + this.eyeHeight; }

  getBoundingBox() {
    return AABB.fromCenter(this.x, this.y, this.z, this.width, this.height);
  }

  distanceTo(e) { return Math.sqrt(this.distanceSqTo(e)); }

  distanceSqTo(e) {
    const dx = this.x - e.x, dy = this.y - e.y, dz = this.z - e.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Points yaw/pitch at a world position using the game's yaw convention. */
  lookAt(x, y, z) {
    const dx = x - this.x, dy = y - this.eyeY, dz = z - this.z;
    const h = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dx, dz);
    this.pitch = Math.atan2(-dy, h);
  }

  interpolate(alpha = 1) {
    return {
      x: lerp(this.prevX, this.x, alpha),
      y: lerp(this.prevY, this.y, alpha),
      z: lerp(this.prevZ, this.z, alpha),
      yaw: this.prevYaw + angleDelta(this.prevYaw, this.yaw) * alpha,
      pitch: lerp(this.prevPitch, this.pitch, alpha),
    };
  }

  // ------------------------------------------------------------ tick

  tick() {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    this.updateAI();
    this.updatePhysics();
  }

  /** Subclass hook: decide what this entity wants to do this tick. */
  updateAI() {}

  /**
   * The verified integration order from core/constants.js:
   * accel -> move -> gravity -> horizontal drag -> velocity cutoff.
   */
  updatePhysics() {
    this.updateFluidState();
    // Friction is sampled before the move so accel and drag agree within a tick,
    // exactly as LivingEntity.travel does it.
    const grounded = this.onGround;
    const slip = grounded && !this.inWater && !this.inLava
      ? this.world.slipperinessAt(this.x, this.y, this.z)
      : MOVE.DEFAULT_SLIPPERINESS;

    this.applyMovementInput(slip);
    this.move(this.vx, this.vy, this.vz);
    this.applyGravityAndDrag(slip, grounded);
    this.clampVelocity();
  }

  /** Subclass hook: add this tick's acceleration to vx/vz (and jump impulses). */
  applyMovementInput(_slip) {}

  applyGravityAndDrag(slip, grounded) {
    if (this.inWater) {
      this.vy = this.vy * MOVE.WATER_VERTICAL_DRAG - (this.hasGravity ? MOVE.WATER_GRAVITY : 0);
      this.vx *= MOVE.WATER_DRAG;
      this.vz *= MOVE.WATER_DRAG;
      return;
    }
    if (this.inLava) {
      this.vy = this.vy * MOVE.LAVA_DRAG - (this.hasGravity ? MOVE.LAVA_GRAVITY : 0);
      this.vx *= MOVE.LAVA_DRAG;
      this.vz *= MOVE.LAVA_DRAG;
      return;
    }
    if (this.hasGravity) this.vy = (this.vy - this.gravity) * this.verticalDrag;
    else this.vy *= this.verticalDrag;
    if (this.vy < MOVE.TERMINAL_VELOCITY) this.vy = MOVE.TERMINAL_VELOCITY;

    const drag = grounded ? groundDrag(slip) : this.airDrag;
    this.vx *= drag;
    this.vz *= drag;
  }

  clampVelocity() {
    const c = MOVE.VELOCITY_CUTOFF;
    if (Math.abs(this.vx) < c) this.vx = 0;
    if (Math.abs(this.vy) < c) this.vy = 0;
    if (Math.abs(this.vz) < c) this.vz = 0;
  }

  updateFluidState() {
    const inner = this.getBoundingBox().grow(-0.001);
    this.inWater = this.world.anyBlockIn(inner, (id) => id === B.WATER);
    this.inLava = this.world.anyBlockIn(inner, (id) => id === B.LAVA);
  }

  // ------------------------------------------------------------ movement

  /** True when nothing would hold the entity up at `box`. */
  _unsupported(box) {
    return this.world.getCollisionBoxes(box, []).length === 0;
  }

  /**
   * Full swept resolve: collect the blocking boxes over the movement volume,
   * clamp Y then X then Z, retry raised by STEP_HEIGHT when a horizontal move
   * was blocked, and refuse to sneak off a ledge.
   */
  move(dx, dy, dz) {
    if (this.noClip) {
      this.x += dx; this.y += dy; this.z += dz;
      this.onGround = false;
      this.horizontalCollision = false;
      this.verticalCollision = false;
      return;
    }

    const world = this.world;
    const wasOnGround = this.onGround;
    const start = this.getBoundingBox();

    // Sneaking will not step past the edge of whatever it is standing on.
    if (this.sneaking && wasOnGround && dy <= 0) {
      const g = MOVE.SNEAK_LEDGE_GRIP;
      while (dx !== 0 && this._unsupported(start.offset(dx, -g, 0))) {
        dx = Math.abs(dx) < LEDGE_STEP ? 0 : dx - Math.sign(dx) * LEDGE_STEP;
      }
      while (dz !== 0 && this._unsupported(start.offset(0, -g, dz))) {
        dz = Math.abs(dz) < LEDGE_STEP ? 0 : dz - Math.sign(dz) * LEDGE_STEP;
      }
      while (dx !== 0 && dz !== 0 && this._unsupported(start.offset(dx, -g, dz))) {
        dx = Math.abs(dx) < LEDGE_STEP ? 0 : dx - Math.sign(dx) * LEDGE_STEP;
        dz = Math.abs(dz) < LEDGE_STEP ? 0 : dz - Math.sign(dz) * LEDGE_STEP;
      }
    }

    const boxes = world.getCollisionBoxes(start.expand(dx, dy, dz).grow(EPS), this._boxes);
    let r = slide(start, dx, dy, dz, boxes);
    let landed = dy < 0 && r.dy !== dy;
    const blockedX = r.dx !== dx;
    const blockedZ = r.dz !== dz;

    // Auto step-up: only from the ground, and only when it actually gets further.
    if ((blockedX || blockedZ) && (wasOnGround || landed)) {
      const step = MOVE.STEP_HEIGHT;
      const upBoxes = world.getCollisionBoxes(start.expand(dx, step, dz).grow(EPS), []);
      const up = slide(start, dx, step, dz, upBoxes);
      if (up.dx * up.dx + up.dz * up.dz > r.dx * r.dx + r.dz * r.dz) {
        const downBoxes = world.getCollisionBoxes(up.box.expand(0, -step, 0).grow(EPS), []);
        const down = slide(up.box, 0, -step, 0, downBoxes);
        r = { dx: up.dx, dy: up.dy + down.dy, dz: up.dz, box: down.box };
        landed = down.dy > -step;
      }
    }

    this.x += r.dx;
    this.y += r.dy;
    this.z += r.dz;

    this.horizontalCollision = r.dx !== dx || r.dz !== dz;
    this.verticalCollision = r.dy !== dy;
    this.onGround = landed;

    if (r.dx !== dx) this.vx = 0;
    if (r.dz !== dz) this.vz = 0;
    if (r.dy !== dy) this.vy = 0;

    if (this.onGround) {
      if (this.fallDistance > 0) {
        const d = this.fallDistance;
        this.fallDistance = 0;
        this.onLanded(d);
      }
    } else if (r.dy < 0) {
      this.fallDistance -= r.dy;
    }
  }

  /** Called with the accumulated fall distance the moment the entity lands. */
  onLanded(_distance) {}

  // ------------------------------------------------------------ damage / life

  damage(amount, _source = null) {
    if (this.dead || this.invulnerable || !(amount > 0)) return false;
    this.hurtTime = DAMAGE.IMMUNITY_WINDOW_TICKS;
    return true;
  }

  kill() { this.remove(); }

  remove() {
    if (this.dead) return;
    this.dead = true;
    this.world?.removeEntity(this);
  }

  // ------------------------------------------------------------ save

  toJSON() {
    return {
      type: this.type,
      x: this.x, y: this.y, z: this.z,
      vx: this.vx, vy: this.vy, vz: this.vz,
      yaw: this.yaw, pitch: this.pitch,
      age: this.age,
    };
  }

  applyJSON(data) {
    this.vx = data.vx ?? 0; this.vy = data.vy ?? 0; this.vz = data.vz ?? 0;
    this.yaw = data.yaw ?? 0; this.pitch = data.pitch ?? 0;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age = data.age ?? 0;
    return this;
  }

  static fromJSON(world, data) {
    const e = new this(world, data.x, data.y, data.z);
    return e.applyJSON(data);
  }
}

// ---------------------------------------------------------------- LivingEntity

export class LivingEntity extends Entity {
  constructor(world, x, y, z) {
    super(world, x, y, z);
    this.type = 'living';

    this.maxHealth = 20;
    this.health = 20;
    this.attackDamage = 1;
    /** Movement-speed attribute. 0.1 is the player's, and reproduces 4.317 b/s. */
    this.moveSpeed = MOVE.BASE_SPEED;
    this.speedModifier = 1;
    this.knockbackResistance = 0;
    this.jumpBoost = 0;

    this.limbSwing = 0;
    this.limbSwingAmount = 0;
    this.prevLimbSwingAmount = 0;
    this.deathTime = 0;

    this.forwardInput = 0;
    this.strafeInput = 0;
    this.jumping = false;
    this.jumpCooldown = 0;
    this.sprinting = false;
    this.climbUp = false;
    this.climbing = false;
    this.canClimbWalls = false;
    this.slowFall = false;

    this.swingTime = 0;
    this.swinging = false;
    /** Counts down while fleeing; the panic goal reads it. */
    this.panicTicks = 0;
    this.fireTicks = 0;
    this.air = PLAYER.MAX_AIR_TICKS;
    this.invulnerableTime = 0;
    this.lastHurtAmount = 0;
    this.lastDamageSource = null;
  }

  get isAlive() { return !this.dead && this.health > 0; }

  heal(n) {
    if (!this.isAlive || !(n > 0)) return;
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  // ------------------------------------------------------------ tick

  tick() {
    this.prevLimbSwingAmount = this.limbSwingAmount;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime > 6) { this.swinging = false; this.swingTime = 0; }
    }
    super.tick();
    this.updateLimbSwing();
    this.updateHazards();
    // Safety net: anything that reaches 0 health without going through
    // actuallyHurt would otherwise stand around alive-but-not-alive forever,
    // since damage() refuses to act on it. Run the death sequence once so the
    // kill is still reported.
    if (this.health <= 0 && this.deathTime === 0 && !this.dead) this.onDeath(this.killedBy ?? null);
    if (this.deathTime > 0) {
      this.deathTime++;
      if (this.deathTime > 20) this.remove();
    }
  }

  updateLimbSwing() {
    const dx = this.x - this.prevX, dz = this.z - this.prevZ;
    let f = Math.sqrt(dx * dx + dz * dz) * 4;
    if (f > 1) f = 1;
    this.limbSwingAmount += (f - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
  }

  // ------------------------------------------------------------ movement

  /**
   * Ground acceleration per tick. The player-shaped rule: BASE_SPEED scaled by
   * the entity's attribute, corrected for slipperiness, damped by the 0.98 the
   * input vector already carries. moveSpeed 0.1 -> 4.317 b/s walk.
   */
  movementAccel(slip) {
    if (this.inWater || this.inLava) return MOVE.WATER_ACCEL;
    if (!this.onGround) {
      return (this.sprinting ? MOVE.AIR_ACCEL_SPRINT : MOVE.AIR_ACCEL) * MOVE.INPUT_DAMP;
    }
    const mult = (this.moveSpeed / MOVE.BASE_SPEED) * this.speedModifier;
    return groundAccel(slip, this.sprinting, mult) * MOVE.INPUT_DAMP;
  }

  applyMovementInput(slip) {
    if (this.jumping) this.tryJump();

    this.climbing = this.isOnClimbable();
    if (this.climbing) {
      this.vx = clamp(this.vx, -0.15, 0.15);
      this.vz = clamp(this.vz, -0.15, 0.15);
      this.vy = Math.max(this.vy, this.sneaking ? 0 : -0.15);
      if (this.climbUp || this.jumping) this.vy = 0.2;
      this.fallDistance = 0;
    }
    if (this.slowFall && this.vy < -0.08) this.vy = -0.08;

    let f = this.forwardInput, s = this.strafeInput;
    const magSq = f * f + s * s;
    if (magSq < 1e-6) return;
    if (magSq > 1) {
      const m = 1 / Math.sqrt(magSq);
      f *= m; s *= m;
    }
    const a = this.movementAccel(slip);
    // Yaw basis: forward is (-sin, cos), right is (cos, sin).
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.vx += (-sy * f + cy * s) * a;
    this.vz += (cy * f + sy * s) * a;
  }

  isOnClimbable() {
    const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    if (this.world.isClimbable(bx, by, bz)) return true;
    if (this.height > 1 && this.world.isClimbable(bx, by + 1, bz)) return true;
    // Spiders treat any wall they are pressed against as a ladder.
    return this.canClimbWalls && this.horizontalCollision;
  }

  tryJump() {
    if (this.inWater || this.inLava) { this.vy += 0.04; return; }
    if (!this.onGround || this.jumpCooldown > 0) return;
    this.vy = MOVE.JUMP_VELOCITY + this.jumpBoost * MOVE.JUMP_BOOST_PER_LEVEL;
    if (this.sprinting) {
      this.vx += -Math.sin(this.yaw) * MOVE.SPRINT_JUMP_BOOST;
      this.vz += Math.cos(this.yaw) * MOVE.SPRINT_JUMP_BOOST;
    }
    this.onGround = false;
    this.jumpCooldown = MOVE.JUMP_COOLDOWN_TICKS;
  }

  // ------------------------------------------------------------ damage

  /** Armour points worn. Overridden by the player; mobs use a flat value. */
  armorPoints() { return 0; }

  applyArmor(amount) {
    const armor = this.armorPoints();
    if (armor <= 0) return amount;
    return amount * (1 - Math.min(20, armor) / 25);
  }

  damage(amount, source = null) {
    if (!this.isAlive || this.invulnerable) return false;
    amount = this.applyArmor(amount, source);
    if (!(amount > 0)) return false;

    // The first half of the invulnerability window only yields to a bigger hit.
    if (this.invulnerableTime > DAMAGE.IMMUNITY_WINDOW_TICKS) {
      if (amount <= this.lastHurtAmount) return false;
      this.actuallyHurt(amount - this.lastHurtAmount, source);
      this.lastHurtAmount = amount;
    } else {
      this.lastHurtAmount = amount;
      this.invulnerableTime = DAMAGE.INVULNERABLE_TICKS;
      this.hurtTime = DAMAGE.IMMUNITY_WINDOW_TICKS;
      this.actuallyHurt(amount, source);
    }

    this.lastDamageSource = source;
    if (source && typeof source === 'object' && source !== this && typeof source.x === 'number') {
      this.knockback(source.x, source.z, KNOCKBACK.BASE_STRENGTH);
    }
    this.onHurt(amount, source);
    return true;
  }

  actuallyHurt(amount, source) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.onDeath(source);
    }
  }

  /** Subclass hook: sounds, aggro, panic. */
  onHurt(_amount, _source) {}

  knockback(fromX, fromZ, strength = KNOCKBACK.BASE_STRENGTH) {
    // applyKnockback subtracts the normalised vector, so pass target -> attacker.
    const v = [this.vx, this.vy, this.vz];
    applyKnockback(v, fromX - this.x, fromZ - this.z, strength, this.onGround, this.knockbackResistance);
    this.vx = v[0]; this.vy = v[1]; this.vz = v[2];
  }

  swing() {
    if (!this.swinging || this.swingTime > 3) {
      this.swinging = true;
      this.swingTime = 0;
    }
  }

  onLanded(distance) {
    if (this.climbing) return;
    const dmg = fallDamage(distance);
    if (dmg > 0) this.damage(dmg, 'fall');
  }

  onDeath(source) {
    if (this.deathTime > 0) return;
    this.deathTime = 1;
    this.noHit = true;
    this.forwardInput = 0;
    this.strafeInput = 0;
    this.jumping = false;
    this.dropLoot(source);
  }

  dropLoot(_source) {}

  kill(source = 'kill') {
    if (this.dead) return;
    // Health may already be 0 if something zeroed it outside actuallyHurt.
    // Removing the entity here without running the death sequence loses the
    // loot, the XP and — because 'mobKilled' is emitted from onDeath — any
    // quest credit for the kill, which can stall an objective for good.
    this.health = 0;
    this.onDeath(source);
  }

  // ------------------------------------------------------------ hazards

  updateHazards() {
    if (!this.isAlive) return;
    const world = this.world;
    const box = this.getBoundingBox().grow(-0.001);

    const contact = world.contactDamageIn(box);
    if (contact > 0 && this.age % DAMAGE.CACTUS_INTERVAL_TICKS === 0) {
      this.damage(contact, 'contact');
    }

    if (this.inLava) {
      this.fireTicks = Math.max(this.fireTicks, 300);
      if (this.age % DAMAGE.LAVA_INTERVAL_TICKS === 0) this.damage(DAMAGE.LAVA_AMOUNT, 'lava');
    }

    if (this.fireTicks > 0) {
      if (this.inWater) this.fireTicks = 0;
      else {
        this.fireTicks--;
        if (this.fireTicks % DAMAGE.BURNING_INTERVAL_TICKS === 0) {
          this.damage(DAMAGE.FIRE_AMOUNT, 'fire');
        }
      }
    }

    const headId = world.getBlock(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z));
    if (headId === B.WATER) {
      if (--this.air <= DAMAGE.DROWN_TRIGGER_AIR) {
        this.air = 0;
        this.damage(DAMAGE.DROWN_AMOUNT, 'drown');
      }
    } else if (this.air < PLAYER.MAX_AIR_TICKS) {
      this.air = Math.min(PLAYER.MAX_AIR_TICKS, this.air + DAMAGE.AIR_REFILL_PER_TICK);
    }

    if (this.y < DAMAGE.VOID_Y && this.age % DAMAGE.VOID_INTERVAL_TICKS === 0) {
      this.damage(DAMAGE.VOID_AMOUNT, 'void');
    }
  }

  // ------------------------------------------------------------ save

  toJSON() {
    const o = super.toJSON();
    o.health = this.health;
    o.maxHealth = this.maxHealth;
    o.fireTicks = this.fireTicks;
    o.air = this.air;
    return o;
  }

  applyJSON(data) {
    super.applyJSON(data);
    if (data.maxHealth != null) this.maxHealth = data.maxHealth;
    if (data.health != null) this.health = data.health;
    this.fireTicks = data.fireTicks ?? 0;
    this.air = data.air ?? PLAYER.MAX_AIR_TICKS;
    return this;
  }
}
