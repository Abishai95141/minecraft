// The player: input-driven movement, the mining and placing loop, combat,
// hunger and experience. This is where every subsystem meets, so it owns the
// rules and asks the others only for data.

import {
  MOVE, PLAYER, DAMAGE, HUNGER, CAMERA, TPS,
  groundAccel, groundDrag, fallDamage, tickHunger, eat,
  cooldownTicks, chargeMultiplier, CRIT_CHARGE_THRESHOLD, CRIT_MULTIPLIER,
} from '../core/constants.js';
import { clamp, AABB } from '../core/math.js';
import { settings } from '../core/settings.js';
import {
  B, BLOCKS, RenderType, RENDER_TYPE, IS_SOLID, IS_REPLACEABLE, needsSupport,
} from '../world/blocks.js';
import { breakTimeSeconds, canHarvest, attackSpeedOf, ITEMS } from '../item/items.js';
import { LivingEntity } from './entity.js';
import { ItemStack, PlayerInventory } from '../item/inventory.js';
import { ItemEntity } from './itementity.js';

/** Blocks whose placement stores the facing the player was looking from. */
const FACING_BLOCKS = new Set([
  B.OAK_STAIRS, B.COBBLESTONE_STAIRS, B.STONE_BRICK_STAIRS,
  B.FURNACE, B.FURNACE_LIT, B.CHEST, B.CRAFTING_TABLE, B.PUMPKIN, B.JACK_O_LANTERN,
]);

/** Blocks that open a screen instead of being placed against. */
const CONTAINER_FOR = {
  [B.CRAFTING_TABLE]: 'crafting',
  [B.FURNACE]: 'furnace',
  [B.FURNACE_LIT]: 'furnace',
  [B.CHEST]: 'chest',
};

export class Player extends LivingEntity {
  constructor(world, x, y, z, game = null) {
    super(world, x, y, z);
    this.game = game;
    this.type = 'player';
    this.name = 'Player';

    this.width = PLAYER.WIDTH;
    this.height = PLAYER.HEIGHT;
    this.maxHealth = PLAYER.MAX_HEALTH;
    this.health = PLAYER.MAX_HEALTH;

    this.inventory = new PlayerInventory();

    // --- input-derived state, refreshed every tick by readInput() ---
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.jumping = false;
    this.sneaking = false;
    this.sprinting = false;

    // --- modes ---
    this.creative = false;
    this.flying = false;
    this.perspective = 0;            // 0 first person, 1 behind, 2 front

    // --- survival state ---
    this.food = PLAYER.MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.foodTimer = 0;
    this.air = PLAYER.MAX_AIR_TICKS;
    this.xp = 0;
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.score = 0;

    // --- swing / attack cooldown ---
    this.swingTicks = -1;
    this.swingDuration = 6;
    this.attackCooldown = 0;         // ticks remaining
    this.attackCooldownMax = cooldownTicks(4);

    // --- mining ---
    this.mining = false;
    this.miningTarget = null;        // {x,y,z}
    this.miningProgress = 0;         // 0..1
    this.miningTicks = 0;
    this.breakStage = -1;            // 0..9, drives the crack overlay
    this.placeCooldown = 0;
    this.useCooldown = 0;

    // --- eating ---
    this.eatingTicks = 0;
    this.eatingSlot = -1;

    // --- look / camera feel ---
    this.bobPhase = 0;
    this.prevBobPhase = 0;
    this.fovModifier = 1;
    this.targetFov = 1;
    this.hurtDirection = 0;
    this.jumpCooldown = 0;
    this.sprintToggled = false;
    this.sneakToggled = false;

    /** The block the crosshair is on, refreshed each frame by the game loop. */
    this.lookingAt = null;
    this.lookingAtEntity = null;

    this.spawnPoint = [x, y, z];
    this.tickCount = 0;
  }

  // ================================================================ geometry

  get eyeHeight() {
    if (this.swimming) return PLAYER.EYE_HEIGHT_SWIM;
    return this.sneaking ? PLAYER.EYE_HEIGHT_SNEAK : PLAYER.EYE_HEIGHT;
  }

  get eyeY() { return this.y + this.eyeHeight; }

  getBoundingBox() {
    const h = this.sneaking ? PLAYER.HEIGHT_SNEAK : PLAYER.HEIGHT;
    return AABB.fromCenter(this.x, this.y, this.z, PLAYER.WIDTH, h);
  }

  /** Unit vector the player is looking along, in world space. */
  lookVector(out = [0, 0, 0]) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    out[0] = -Math.sin(this.yaw) * cp;
    out[1] = -sp;
    out[2] = Math.cos(this.yaw) * cp;
    return out;
  }

  get heldItem() { return this.inventory.held; }
  get heldItemName() {
    const s = this.inventory.held;
    return s && !s.isEmpty ? s.item?.name ?? null : null;
  }

  armorPoints() { return this.inventory.armorPoints(); }

  // ================================================================ input

  /**
   * Translates held keys into movement intent. Called once per tick from the
   * game loop, and only while no screen has focus.
   */
  readInput(input) {
    const f = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
    const s = (input.action('right') ? 1 : 0) - (input.action('left') ? 1 : 0);
    this.moveForward = f;
    this.moveStrafe = s;
    this.jumping = input.action('jump');

    // Sneak and sprint both support hold and toggle styles.
    if (settings.get('toggleSneak') === 'toggle') {
      if (input.actionPressed('sneak')) this.sneakToggled = !this.sneakToggled;
      this.sneaking = this.sneakToggled;
    } else {
      this.sneaking = input.action('sneak');
    }

    const canSprint = this.food > HUNGER.SPRINT_MIN_FOOD - 1 || this.creative;
    if (settings.get('toggleSprint') === 'toggle') {
      if (input.actionPressed('sprint')) this.sprintToggled = !this.sprintToggled;
      if (f <= 0 || !canSprint) this.sprintToggled = false;
      this.sprinting = this.sprintToggled;
    } else {
      if (input.action('sprint') && f > 0 && canSprint) this.sprinting = true;
      if (f <= 0 || !canSprint || this.sneaking) this.sprinting = false;
    }

    if (this.creative && input.actionPressed('jump')) {
      // Double-tap jump toggles flight, as in creative mode.
      if (this.jumpCooldown > 0 && this.jumpCooldown < 6) {
        this.flying = !this.flying;
        this.vy = 0;
        this.jumpCooldown = 0;
      } else {
        this.jumpCooldown = 10;
      }
    }
    if (this.jumpCooldown > 0) this.jumpCooldown--;
  }

  /** Applies accumulated mouse movement to the view angles. */
  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -CAMERA.MAX_PITCH, CAMERA.MAX_PITCH);
    // Keep yaw bounded so long sessions do not lose float precision.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  // ================================================================ tick

  tick() {
    this.tickCount++;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.prevBobPhase = this.bobPhase;

    if (this.hurtTime > 0) this.hurtTime--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.placeCooldown > 0) this.placeCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.swingTicks >= 0) {
      this.swingTicks++;
      if (this.swingTicks >= this.swingDuration) this.swingTicks = -1;
    }

    if (this.dead) { this.deathTime++; return; }

    this.updateEnvironment();
    this.movementTick();
    this.updateLimbSwing();
    this.hungerTick();
    this.environmentDamageTick();
    this.eatingTick();

    // View bob tracks horizontal ground speed, exactly like vanilla.
    const speed = Math.hypot(this.x - this.prevX, this.z - this.prevZ);
    this.bobPhase += (this.onGround ? Math.min(speed * 4, 0.7) : 0) - this.bobPhase * 0.4;
  }

  updateEnvironment() {
    const box = this.getBoundingBox();
    this.inWater = this.world.anyBlockIn(box, (id) => id === B.WATER);
    this.inLava = this.world.anyBlockIn(box, (id) => id === B.LAVA);
    this.swimming = this.inWater && this.sprinting && !this.onGround;
    this.onLadder = this.world.isClimbable(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }

  // ---------------------------------------------------------------- movement

  movementTick() {
    if (this.flying) { this.flyTick(); return; }

    const slip = this.onGround ? this.world.slipperinessAt(this.x, this.y, this.z) : MOVE.DEFAULT_SLIPPERINESS;
    const inFluid = this.inWater || this.inLava;

    // --- acceleration ---
    let accel;
    if (inFluid) {
      accel = this.inLava ? MOVE.WATER_ACCEL : MOVE.WATER_ACCEL;
    } else if (this.onGround) {
      accel = groundAccel(slip, this.sprinting) * MOVE.INPUT_DAMP;
      if (this.sneaking) accel *= MOVE.SNEAK_MULTIPLIER;
    } else {
      accel = this.sprinting ? MOVE.AIR_ACCEL_SPRINT : MOVE.AIR_ACCEL;
    }
    this.accelerate(this.moveForward, this.moveStrafe, accel);

    // --- jumping and climbing ---
    if (this.onLadder) {
      // On a ladder, holding a direction into it climbs and jump goes up.
      this.vy = this.jumping ? 0.2 : (this.sneaking ? 0 : Math.max(this.vy, -0.15));
      if (this.moveForward !== 0 || this.moveStrafe !== 0) this.vy = Math.max(this.vy, 0.12);
    } else if (this.jumping) {
      if (inFluid) {
        this.vy += 0.04;
      } else if (this.onGround && this.jumpCooldown <= 0) {
        this.vy = MOVE.JUMP_VELOCITY;
        if (this.sprinting) {
          this.vx -= Math.sin(this.yaw) * MOVE.SPRINT_JUMP_BOOST;
          this.vz += Math.cos(this.yaw) * MOVE.SPRINT_JUMP_BOOST;
        }
        this.onGround = false;
        this.addExhaustion(this.sprinting ? HUNGER.EXH_SPRINT_JUMP : HUNGER.EXH_JUMP);
      }
    }

    // --- integrate: move first, then gravity, then drag ---
    const before = { x: this.x, y: this.y, z: this.z };
    this.move(this.vx, this.vy, this.vz);

    if (inFluid) {
      this.vy = (this.vy - (this.inLava ? MOVE.LAVA_GRAVITY : MOVE.WATER_GRAVITY)) *
                (this.inLava ? MOVE.LAVA_DRAG : MOVE.WATER_VERTICAL_DRAG);
      const d = this.inLava ? MOVE.LAVA_DRAG : (this.sprinting ? MOVE.WATER_DRAG_SPRINT : MOVE.WATER_DRAG);
      this.vx *= d; this.vz *= d;
    } else {
      this.vy = (this.vy - MOVE.GRAVITY) * MOVE.VERTICAL_DRAG;
      if (this.vy < MOVE.TERMINAL_VELOCITY) this.vy = MOVE.TERMINAL_VELOCITY;
      const drag = this.onGround ? groundDrag(slip) : MOVE.AIR_DRAG;
      this.vx *= drag; this.vz *= drag;
    }

    if (Math.abs(this.vx) < MOVE.VELOCITY_CUTOFF) this.vx = 0;
    if (Math.abs(this.vy) < MOVE.VELOCITY_CUTOFF) this.vy = 0;
    if (Math.abs(this.vz) < MOVE.VELOCITY_CUTOFF) this.vz = 0;

    // Sprinting and swimming cost hunger by distance actually travelled.
    const moved = Math.hypot(this.x - before.x, this.z - before.z);
    if (this.sprinting && this.onGround) this.addExhaustion(moved * HUNGER.EXH_SPRINT_PER_METER);
    else if (this.inWater) this.addExhaustion(moved * HUNGER.EXH_SWIM_PER_METER);

    // Cobweb clamps every axis.
    if (this.world.anyBlockIn(this.getBoundingBox(), (id) => id === B.COBWEB)) {
      this.vx = clamp(this.vx, -MOVE.COBWEB_CLAMP[0], MOVE.COBWEB_CLAMP[0]);
      this.vy = clamp(this.vy, -MOVE.COBWEB_CLAMP[1], MOVE.COBWEB_CLAMP[1]);
      this.vz = clamp(this.vz, -MOVE.COBWEB_CLAMP[2], MOVE.COBWEB_CLAMP[2]);
    }
  }

  flyTick() {
    const accel = this.sprinting ? MOVE.FLY_ACCEL_SPRINT : MOVE.FLY_ACCEL;
    this.accelerate(this.moveForward, this.moveStrafe, accel);
    if (this.jumping) this.vy = MOVE.FLY_VERTICAL_IMPULSE;
    else if (this.sneaking) this.vy = -MOVE.FLY_VERTICAL_IMPULSE;

    this.move(this.vx, this.vy, this.vz);
    this.vx *= MOVE.AIR_DRAG; this.vz *= MOVE.AIR_DRAG;
    this.vy *= MOVE.FLY_VERTICAL_DAMP;
    this.fallDistance = 0;
    if (this.onGround) this.flying = false;
  }

  /**
   * Vanilla's moveRelative: the input pair is normalised only when it exceeds
   * unit length, so walking diagonally is not faster than walking straight.
   */
  accelerate(forward, strafe, amount) {
    let d = forward * forward + strafe * strafe;
    if (d < 1e-4) return;
    d = Math.sqrt(d);
    if (d < 1) d = 1;
    const f = amount / d;
    const fw = forward * f, st = strafe * f;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.vx += st * cy - fw * sy;
    this.vz += st * sy + fw * cy;
  }

  updateLimbSwing() {
    const dx = this.x - this.prevX, dz = this.z - this.prevZ;
    let amount = Math.min(Math.sqrt(dx * dx + dz * dz) * 4, 1);
    this.limbSwingAmount += (amount - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
  }

  // ---------------------------------------------------------------- survival

  addExhaustion(n) {
    if (this.creative) return;
    this.exhaustion += n;
  }

  hungerTick() {
    if (this.creative) return;
    const s = {
      food: this.food, saturation: this.saturation,
      exhaustion: this.exhaustion, timer: this.foodTimer, health: this.health,
    };
    const { heal, starve } = tickHunger(s, {
      difficulty: this.world.difficulty,
      maxHealth: this.maxHealth,
    });
    this.food = s.food;
    this.saturation = s.saturation;
    this.exhaustion = s.exhaustion;
    this.foodTimer = s.timer;
    if (heal > 0) this.health = Math.min(this.maxHealth, this.health + heal);
    if (starve > 0) this.damage(starve, 'starve');
    if (this.food <= HUNGER.SPRINT_MIN_FOOD - 1) this.sprinting = false;
  }

  environmentDamageTick() {
    // Drowning: air drains underwater and refills fast in air.
    const eyeBlock = this.world.getBlock(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z));
    if (eyeBlock === B.WATER) {
      this.air--;
      if (this.air <= DAMAGE.DROWN_TRIGGER_AIR) {
        this.air = 0;
        if (this.tickCount % DAMAGE.DROWN_INTERVAL_TICKS === 0) this.damage(DAMAGE.DROWN_AMOUNT, 'drown');
      }
    } else if (this.air < PLAYER.MAX_AIR_TICKS) {
      this.air = Math.min(PLAYER.MAX_AIR_TICKS, this.air + DAMAGE.AIR_REFILL_PER_TICK);
    }

    // Contact damage from cactus, lava and the like.
    const hurt = this.world.contactDamageIn(this.getBoundingBox());
    if (hurt > 0 && this.tickCount % DAMAGE.CACTUS_INTERVAL_TICKS === 0) {
      this.damage(hurt, this.inLava ? 'lava' : 'contact');
    }

    // Suffocation inside a solid block.
    const head = this.world.getBlock(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z));
    if (IS_SOLID[head] && BLOCKS[head].fullCube && this.tickCount % DAMAGE.SUFFOCATION_INTERVAL_TICKS === 0) {
      this.damage(DAMAGE.SUFFOCATION_AMOUNT, 'suffocate');
    }

    if (this.y < DAMAGE.VOID_Y && this.tickCount % DAMAGE.VOID_INTERVAL_TICKS === 0) {
      this.damage(DAMAGE.VOID_AMOUNT, 'void');
    }
  }

  /** Called by move() when the player lands. */
  onLanded(distance) {
    if (this.creative || this.flying) return;
    const dmg = fallDamage(distance);
    if (dmg > 0 && !this.inWater) {
      this.damage(dmg, 'fall');
      this.game?.playSound?.('hurt', { x: this.x, y: this.y, z: this.z });
    }
  }

  eatingTick() {
    if (this.eatingTicks <= 0) return;
    this.eatingTicks--;
    if (this.eatingTicks % 4 === 0) {
      this.game?.particles?.spawn('blockDust', this.x, this.eyeY - 0.2, this.z, { count: 2 });
    }
    if (this.eatingTicks === 0) this.finishEating();
  }

  startEating(slot) {
    const stack = this.inventory.get(slot);
    if (!stack || stack.isEmpty) return false;
    const food = stack.item?.food;
    if (!food) return false;
    if (this.food >= PLAYER.MAX_FOOD && !food.alwaysEdible) return false;
    this.eatingSlot = slot;
    this.eatingTicks = Math.round((food.eatTime ?? 1.6) * TPS);
    return true;
  }

  finishEating() {
    const stack = this.inventory.get(this.eatingSlot);
    this.eatingSlot = -1;
    if (!stack || stack.isEmpty) return;
    const food = stack.item?.food;
    if (!food) return;
    const s = { food: this.food, saturation: this.saturation };
    eat(s, food.hunger, food.saturation / Math.max(1, food.hunger * 2));
    this.food = s.food;
    this.saturation = s.saturation;
    if (food.effects?.some((e) => e.id === 'regeneration')) {
      this.health = Math.min(this.maxHealth, this.health + 4);
    }
    stack.shrink(1);
    if (stack.isEmpty) this.inventory.set(this.eatingSlot, ItemStack.EMPTY.clone());
    this.game?.playSound?.('eat', { x: this.x, y: this.y, z: this.z });
    this.game?.story?.onEvent('itemUsed', { item: stack.item?.name });
  }

  cancelEating() { this.eatingTicks = 0; this.eatingSlot = -1; }

  // ---------------------------------------------------------------- damage

  damage(amount, source = null) {
    if (this.creative && source !== 'void') return false;
    if (this.dead) return false;
    if (this.hurtTime > DAMAGE.IMMUNITY_WINDOW_TICKS) return false;

    // Armour reduces by 4% per point, as in Java Edition.
    const points = this.armorPoints();
    const reduced = source === 'starve' || source === 'void'
      ? amount
      : amount * (1 - Math.min(20, points) * 0.04);

    this.health -= reduced;
    this.hurtTime = DAMAGE.INVULNERABLE_TICKS;
    this.addExhaustion(HUNGER.EXH_TAKE_DAMAGE);
    this.cancelEating();
    this.game?.onPlayerHurt?.(reduced, source);
    this.game?.playSound?.('hurt', { x: this.x, y: this.y, z: this.z });

    if (this.health <= 0) {
      this.health = 0;
      this.onDeath();
      return true;
    }
    return true;
  }

  onDeath() {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.game?.playSound?.('death', { x: this.x, y: this.y, z: this.z });
    if (!this.world.keepInventory) this.dropInventory();
    this.game?.onPlayerDeath?.();
  }

  dropInventory() {
    for (let i = 0; i < this.inventory.size; i++) {
      const stack = this.inventory.get(i);
      if (!stack || stack.isEmpty) continue;
      if (stack.item?.quest) continue;           // quest items survive death
      this.dropStack(stack.clone(), false);
      this.inventory.set(i, ItemStack.EMPTY.clone());
    }
  }

  respawn(x, y, z) {
    this.dead = false;
    this.deathTime = 0;
    this.health = this.maxHealth;
    this.food = PLAYER.MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = PLAYER.MAX_AIR_TICKS;
    this.hurtTime = 0;
    this.fallDistance = 0;
    this.vx = this.vy = this.vz = 0;
    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
  }

  // ---------------------------------------------------------------- targeting

  /** Refreshes lookingAt / lookingAtEntity. Cheap enough to run every frame. */
  updateTargets() {
    const dir = this.lookVector();
    const origin = [this.x, this.eyeY, this.z];
    const reach = this.creative ? 5 : PLAYER.BLOCK_REACH;

    this.lookingAt = this.world.raycast(origin, dir, reach);
    const hit = this.world.raycastEntities(origin, dir, PLAYER.ENTITY_REACH, this);
    // A block in front of a mob wins, so you cannot hit through a wall.
    this.lookingAtEntity = hit && (!this.lookingAt || hit.t < this.lookingAt.distance) ? hit.entity : null;
  }

  // ---------------------------------------------------------------- mining

  /** Continues or restarts breaking the targeted block. Call once per tick. */
  tickMining(attacking) {
    if (!attacking || this.dead) {
      this.stopMining();
      return;
    }
    const target = this.lookingAt;
    if (!target) { this.stopMining(); return; }

    // Punching a mob is an attack, not mining.
    if (this.lookingAtEntity) { this.stopMining(); return; }

    if (!this.miningTarget || this.miningTarget.x !== target.x ||
        this.miningTarget.y !== target.y || this.miningTarget.z !== target.z) {
      this.miningTarget = { x: target.x, y: target.y, z: target.z };
      this.miningProgress = 0;
      this.miningTicks = 0;
    }

    const def = BLOCKS[target.blockId];
    this.mining = true;
    this.swing();

    if (this.creative) { this.breakBlock(target.x, target.y, target.z); return; }

    const seconds = breakTimeSeconds(def, this.heldItemName, {
      onGround: this.onGround,
      inWater: this.inWater,
    });
    if (seconds === Infinity) { this.miningProgress = 0; this.breakStage = -1; return; }
    if (seconds <= 0) { this.breakBlock(target.x, target.y, target.z); return; }

    this.miningTicks++;
    this.miningProgress = Math.min(1, this.miningTicks / (seconds * TPS));
    this.breakStage = Math.min(9, Math.floor(this.miningProgress * 10));

    // Chip particles and the digging sound, on vanilla's 4-tick cadence.
    if (this.miningTicks % 4 === 0) {
      this.game?.particles?.blockHit(target.x, target.y, target.z, target.face, target.blockId);
      this.game?.playSound?.(`dig.${def.sound}`, { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5, volume: 0.25 });
    }

    if (this.miningProgress >= 1) this.breakBlock(target.x, target.y, target.z);
  }

  stopMining() {
    this.mining = false;
    this.miningTarget = null;
    this.miningProgress = 0;
    this.miningTicks = 0;
    this.breakStage = -1;
  }

  breakBlock(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR) { this.stopMining(); return; }
    const def = BLOCKS[id];
    if (def.hardness < 0 && !this.creative) { this.stopMining(); return; }

    const held = this.heldItemName;
    const harvest = this.creative ? false : canHarvest(held, def);

    this.game?.particles?.blockBreak(x, y, z, id);
    this.game?.playSound?.(`break.${def.sound}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });

    this.world.setBlock(x, y, z, B.AIR);
    this.world.emit('blockBroken', { x, y, z, id, natural: false });

    if (harvest) {
      for (const stack of this.rollDrops(def, id)) this.dropStack(stack, true);
      const xp = def.xp;
      if (xp) {
        const amount = Array.isArray(xp) ? this.world.rng.int(xp[0], xp[1]) : xp;
        if (amount > 0) this.addXp(amount);
      }
    }

    // Tools wear out, and a broken tool leaves the hand empty.
    if (!this.creative) {
      const stack = this.inventory.held;
      if (stack && !stack.isEmpty && stack.maxDamage > 0) {
        if (stack.damageBy(1)) {
          this.inventory.set(this.inventory.selected, ItemStack.EMPTY.clone());
          this.game?.playSound?.('break.wood', { x: this.x, y: this.y, z: this.z });
        }
      }
      this.addExhaustion(HUNGER.EXH_BREAK_BLOCK);
    }

    this.game?.story?.onEvent('blockBroken', { x, y, z, id, block: def.name });
    this.stopMining();
  }

  /** Resolves a block's drop spec into concrete stacks. */
  rollDrops(def, id) {
    const out = [];
    const rand = () => this.world.rng.next();
    let spec = def.drops;
    if (spec === false) return out;
    if (spec === null || spec === undefined) spec = def.name;
    if (typeof spec === 'function') spec = spec(rand);

    const push = (entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        if (ITEMS[entry]) out.push(new ItemStack(entry, 1));
        return;
      }
      const name = entry.item;
      if (!name || !ITEMS[name]) return;
      let count = entry.count ?? 1;
      if (Array.isArray(count)) count = this.world.rng.int(count[0], count[1]);
      if (count > 0) out.push(new ItemStack(name, count));
    };

    if (Array.isArray(spec)) spec.forEach(push);
    else push(spec);
    return out;
  }

  /** Spawns a dropped item, thrown gently forward when the player tossed it. */
  dropStack(stack, fromBlock = false) {
    if (!stack || stack.isEmpty) return null;
    const x = fromBlock && this.miningTarget ? this.miningTarget.x + 0.5 : this.x;
    const y = fromBlock && this.miningTarget ? this.miningTarget.y + 0.5 : this.eyeY - 0.3;
    const z = fromBlock && this.miningTarget ? this.miningTarget.z + 0.5 : this.z;
    const e = new ItemEntity(this.world, x, y, z, stack);
    if (!fromBlock) {
      const dir = this.lookVector();
      e.vx = dir[0] * 0.3;
      e.vy = dir[1] * 0.3 + 0.1;
      e.vz = dir[2] * 0.3;
      e.pickupDelay = 40;
    }
    this.world.addEntity(e);
    return e;
  }

  // ---------------------------------------------------------------- placing / using

  /** Right-click. Returns true when something handled it. */
  use() {
    if (this.useCooldown > 0 || this.dead) return false;

    // 1. Interact with a mob (NPC dialogue, breeding).
    if (this.lookingAtEntity) {
      this.useCooldown = 4;
      if (this.game?.interactWithEntity?.(this.lookingAtEntity)) return true;
    }

    const hit = this.lookingAt;

    // 2. Interact with the block itself: containers, doors.
    if (hit) {
      const id = hit.blockId;
      const container = CONTAINER_FOR[id];
      if (container && !this.sneaking) {
        this.useCooldown = 6;
        this.game?.openContainer?.(container, [hit.x, hit.y, hit.z]);
        this.game?.playSound?.(container === 'chest' ? 'chest_open' : 'click', { x: hit.x, y: hit.y, z: hit.z });
        return true;
      }
      if (id === B.OAK_DOOR_LOWER || id === B.OAK_DOOR_UPPER) {
        this.useCooldown = 6;
        this.toggleDoor(hit.x, hit.y, hit.z, id);
        return true;
      }
    }

    // 3. Eat what is in hand.
    const stack = this.inventory.held;
    if (stack && !stack.isEmpty && stack.item?.food && this.eatingTicks === 0) {
      if (this.startEating(this.inventory.selected)) return true;
    }

    // 4. Place the held block.
    if (hit && stack && !stack.isEmpty && stack.item?.block) {
      return this.placeBlock(hit, stack);
    }
    return false;
  }

  toggleDoor(x, y, z, id) {
    const lowerY = id === B.OAK_DOOR_UPPER ? y - 1 : y;
    const meta = this.world.getMeta(x, lowerY, z);
    const open = (meta & 4) !== 0;
    const next = open ? meta & ~4 : meta | 4;
    this.world.setBlock(x, lowerY, z, B.OAK_DOOR_LOWER, next);
    const upper = this.world.getBlock(x, lowerY + 1, z);
    if (upper === B.OAK_DOOR_UPPER) this.world.setBlock(x, lowerY + 1, z, B.OAK_DOOR_UPPER, next);
    this.game?.playSound?.(open ? 'door_close' : 'door_open', { x, y: lowerY, z });
  }

  placeBlock(hit, stack) {
    const [dx, dy, dz] = FACE_OFFSET[hit.face] || [0, 1, 0];
    let px = hit.x + dx, py = hit.y + dy, pz = hit.z + dz;

    // Placing into a replaceable block (grass, snow, water) replaces it instead.
    const existing = this.world.getBlock(px, py, pz);
    if (!IS_REPLACEABLE[existing]) return false;

    const blockId = stack.item.block;
    const def = BLOCKS[blockId];

    // Never place a block inside yourself or another entity.
    const boxes = this.world.blockCollisionBoxes(px, py, pz, blockId);
    if (def.solid) {
      for (const box of boxes) {
        if (box.intersects(this.getBoundingBox())) return false;
        if (this.world.entitiesIn(box, (e) => !e.noHit && e !== this && !e.dead).length) return false;
      }
    }

    if (needsSupport(blockId) && !IS_SOLID[this.world.getBlock(px, py - 1, pz)]) return false;

    const meta = this.placementMeta(blockId, hit);
    let placeId = blockId;

    // Torches against a wall become wall torches.
    if (blockId === B.TORCH && hit.face !== 2) {
      if (hit.face === 3) return false;
      placeId = B.WALL_TORCH;
    }

    if (!this.world.setBlock(px, py, pz, placeId, meta)) return false;

    // Doors and beds are two blocks tall or long.
    if (blockId === B.OAK_DOOR_LOWER) {
      if (!this.world.setBlock(px, py + 1, pz, B.OAK_DOOR_UPPER, meta)) {
        this.world.setBlock(px, py, pz, B.AIR);
        return false;
      }
    } else if (blockId === B.BED_FOOT) {
      const facing = meta & 3;
      const hx = px + (facing === 0 ? 1 : facing === 1 ? -1 : 0);
      const hz = pz + (facing === 2 ? 1 : facing === 3 ? -1 : 0);
      if (!IS_REPLACEABLE[this.world.getBlock(hx, py, hz)]) {
        this.world.setBlock(px, py, pz, B.AIR);
        return false;
      }
      this.world.setBlock(hx, py, hz, B.BED_HEAD, meta);
    }

    this.game?.playSound?.(`place.${def.sound}`, { x: px, y: py, z: pz });
    if (!this.creative) {
      stack.shrink(1);
      if (stack.isEmpty) this.inventory.set(this.inventory.selected, ItemStack.EMPTY.clone());
    }
    this.swing();
    this.placeCooldown = 4;
    this.useCooldown = 4;
    this.game?.story?.onEvent('blockPlaced', { x: px, y: py, z: pz, id: placeId, block: def.name });
    return true;
  }

  /** Facing / half metadata for the block about to be placed. */
  placementMeta(blockId, hit) {
    const rt = RENDER_TYPE[blockId];
    // Facing index: 0 = +X, 1 = -X, 2 = +Z, 3 = -Z, derived from the view yaw.
    const yawFacing = () => {
      const fx = -Math.sin(this.yaw), fz = Math.cos(this.yaw);
      return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 0) : (fz > 0 ? 3 : 2);
    };

    if (rt === RenderType.STAIRS) {
      const top = hit.face === 3 || (hit.face !== 2 && (hit.hitPos[1] - hit.y) > 0.5);
      return yawFacing() | (top ? 4 : 0);
    }
    if (rt === RenderType.SLAB) {
      const top = hit.face === 3 || (hit.face !== 2 && (hit.hitPos[1] - hit.y) > 0.5);
      return top ? 1 : 0;
    }
    if (rt === RenderType.DOOR || rt === RenderType.BED) return yawFacing();
    if (blockId === B.WALL_TORCH || blockId === B.TORCH) return hit.face;
    if (FACING_BLOCKS.has(blockId)) return yawFacing();
    return 0;
  }

  // ---------------------------------------------------------------- combat

  swing() {
    if (this.swingTicks < 0 || this.swingTicks >= this.swingDuration / 2) this.swingTicks = 0;
  }

  /** The vanilla attack-cooldown charge, 0..1. */
  get attackCharge() {
    if (this.attackCooldownMax <= 0) return 1;
    return clamp(1 - this.attackCooldown / this.attackCooldownMax, 0, 1);
  }

  refreshAttackSpeed() {
    this.attackCooldownMax = cooldownTicks(attackSpeedOf(this.heldItemName));
  }

  attack(entity) {
    if (!entity || entity.dead || this.dead) return false;
    const charge = this.attackCharge;
    const base = this.heldItem && !this.heldItem.isEmpty ? (this.heldItem.item?.damage ?? 1) : 1;
    let damage = base * chargeMultiplier(charge);

    // A falling, fully-charged, non-sprinting hit crits.
    const crit = charge > CRIT_CHARGE_THRESHOLD && this.vy < 0 && !this.onGround && !this.sprinting;
    if (crit) damage *= CRIT_MULTIPLIER;

    const applied = entity.damage(damage, this);
    if (applied) {
      const strength = 0.4 + (this.sprinting ? 0.5 : 0);
      entity.knockback?.(this.x, this.z, strength);
      if (crit) this.game?.particles?.spawn('crit', entity.x, entity.y + entity.height * 0.6, entity.z, { count: 8 });
      this.game?.playSound?.(crit ? 'crit' : 'hurt', { x: entity.x, y: entity.y, z: entity.z });
      this.addExhaustion(HUNGER.EXH_ATTACK);

      // Weapons take durability from a landed hit.
      const stack = this.inventory.held;
      if (!this.creative && stack && !stack.isEmpty && stack.maxDamage > 0) {
        if (stack.damageBy(1)) this.inventory.set(this.inventory.selected, ItemStack.EMPTY.clone());
      }
    }
    this.swing();
    this.refreshAttackSpeed();
    this.attackCooldown = this.attackCooldownMax;
    this.sprinting = false;
    return applied;
  }

  // ---------------------------------------------------------------- inventory helpers

  selectSlot(i) {
    this.inventory.selected = ((i % 9) + 9) % 9;
    this.refreshAttackSpeed();
    this.game?.onHeldItemChanged?.();
  }

  scrollHotbar(delta) {
    if (!delta) return;
    this.selectSlot(this.inventory.selected + (delta > 0 ? 1 : -1));
  }

  /** Middle-click: put the targeted block in hand. */
  pickBlock() {
    const hit = this.lookingAt;
    if (!hit) return false;
    const def = BLOCKS[hit.blockId];
    const name = def?.drops && typeof def.drops === 'string' ? def.name : def?.name;
    if (!name || !ITEMS[name]) return false;
    return this.inventory.pickBlock(hit.blockId, this.creative);
  }

  /** Q: drop one, or the whole stack with a modifier. */
  dropHeld(all = false) {
    const stack = this.inventory.held;
    if (!stack || stack.isEmpty) return false;
    if (stack.item?.quest) {
      this.game?.chat?.('§7You should hold on to that.');
      return false;
    }
    const dropped = all ? stack.clone() : stack.split(1);
    if (all) this.inventory.set(this.inventory.selected, ItemStack.EMPTY.clone());
    else if (stack.isEmpty) this.inventory.set(this.inventory.selected, ItemStack.EMPTY.clone());
    this.dropStack(dropped, false);
    return true;
  }

  /** Called by ItemEntity when it reaches the player. */
  pickUp(stack) {
    const remainder = this.inventory.addToHotbarFirst(stack);
    const took = stack.count - (remainder?.count ?? 0);
    if (took > 0) {
      this.game?.playSound?.('pop', { x: this.x, y: this.y, z: this.z, volume: 0.3 });
      this.game?.story?.onEvent('itemPicked', { item: stack.item?.name, count: took });
    }
    return remainder;
  }

  addXp(amount) {
    this.xp += amount;
    this.score += amount;
    let need = this.xpNeeded(this.xpLevel);
    while (this.xp >= need) {
      this.xp -= need;
      this.xpLevel++;
      need = this.xpNeeded(this.xpLevel);
      this.game?.playSound?.('level_up', {});
    }
    this.xpProgress = need > 0 ? this.xp / need : 0;
  }

  xpNeeded(level) {
    if (level >= 30) return 112 + (level - 30) * 9;
    if (level >= 15) return 37 + (level - 15) * 5;
    return 7 + level * 2;
  }

  // ---------------------------------------------------------------- camera

  /** View bob offset in blocks, applied to the camera by game.js. */
  bobOffset(partial) {
    if (!settings.get('viewBobbing') || this.perspective !== 0) return [0, 0, 0];
    const t = (this.prevBobPhase + (this.bobPhase - this.prevBobPhase) * partial);
    const walk = (this.limbSwing - this.limbSwingAmount * (1 - partial));
    return [
      Math.sin(walk * 0.6662) * t * PLAYER.BOB_AMOUNT,
      -Math.abs(Math.cos(walk * 0.6662) * t) * PLAYER.BOB_AMOUNT,
      0,
    ];
  }

  /** FOV multiplier, eased toward the sprint value. */
  updateFov(dt) {
    this.targetFov = this.sprinting ? CAMERA.SPRINT_FOV_MULTIPLIER : 1;
    if (this.inWater) this.targetFov *= 0.95;
    const rate = 1 - Math.pow(1 - CAMERA.FOV_LERP_RATE, dt * 60 / 20);
    this.fovModifier += (this.targetFov - this.fovModifier) * clamp(rate, 0, 1);
  }

  // ---------------------------------------------------------------- save

  toJSON() {
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, food: this.food, saturation: this.saturation,
      exhaustion: this.exhaustion, air: this.air,
      xp: this.xp, xpLevel: this.xpLevel, score: this.score,
      creative: this.creative, spawnPoint: this.spawnPoint,
      inventory: this.inventory.toJSON(),
    };
  }

  fromJSON(o) {
    if (!o) return this;
    this.x = o.x ?? this.x; this.y = o.y ?? this.y; this.z = o.z ?? this.z;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.yaw = o.yaw ?? 0; this.pitch = o.pitch ?? 0;
    this.health = o.health ?? PLAYER.MAX_HEALTH;
    this.food = o.food ?? PLAYER.MAX_FOOD;
    this.saturation = o.saturation ?? 5;
    this.exhaustion = o.exhaustion ?? 0;
    this.air = o.air ?? PLAYER.MAX_AIR_TICKS;
    this.xp = o.xp ?? 0;
    this.xpLevel = o.xpLevel ?? 0;
    this.score = o.score ?? 0;
    this.creative = !!o.creative;
    if (Array.isArray(o.spawnPoint)) this.spawnPoint = o.spawnPoint;
    if (o.inventory) this.inventory.fromJSON(o.inventory);
    return this;
  }
}

/** Offsets matching the face indices in world/blocks.js: +X -X +Y -Y +Z -Z. */
const FACE_OFFSET = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
