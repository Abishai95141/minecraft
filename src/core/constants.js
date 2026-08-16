// Vanilla-accurate simulation constants, verified against Minecraft Java
// Edition ~1.20. Values are in BLOCKS and TICKS (20 ticks/second) exactly as
// the game stores them, because the closed-form speeds only come out right if
// the per-tick integration is reproduced faithfully.
//
// Cross-check (steady-state speed = accel / (1 - drag)):
//   walk    accel 0.1  * 0.98            drag 0.546  -> 0.215859 b/t = 4.317 b/s
//   sprint  accel 0.13 * 0.98            drag 0.546  -> 0.280617 b/t = 5.612 b/s
//   sneak   accel 0.1  * 0.98 * 0.3      drag 0.546  -> 0.064758 b/t = 1.295 b/s
//   ice     accel 0.098 * (0.6/0.98)^3   drag 0.8918 -> 0.207860 b/t = 4.157 b/s

export const TPS = 20;
export const TICK_SECONDS = 1 / TPS;
export const MS_PER_TICK = 1000 / TPS;

// ---------------------------------------------------------------- movement

export const MOVE = {
  /** Base movement_speed attribute. Sprint is a x1.3 multiply_total modifier. */
  BASE_SPEED: 0.1,
  SPRINT_MULTIPLIER: 1.3,
  SNEAK_MULTIPLIER: 0.3,

  /** Raw input impulses are damped by this before the movement vector is built. */
  INPUT_DAMP: 0.98,

  /** Ground acceleration = BASE_SPEED * (0.6 / slipperiness)^3. */
  DEFAULT_SLIPPERINESS: 0.6,
  AIR_ACCEL: 0.02,
  AIR_ACCEL_SPRINT: 0.026,
  FLY_ACCEL: 0.05,
  FLY_ACCEL_SPRINT: 0.10,
  WATER_ACCEL: 0.02,

  /** Horizontal drag multipliers applied after move(). */
  AIR_DRAG: 0.91,
  WATER_DRAG: 0.8,
  WATER_DRAG_SPRINT: 0.9,
  LAVA_DRAG: 0.5,

  /** Vertical: y += vy; vy = (vy - GRAVITY) * VERTICAL_DRAG. */
  GRAVITY: 0.08,
  VERTICAL_DRAG: 0.98,
  TERMINAL_VELOCITY: -3.92,          // = -0.08*0.98 / (1 - 0.98)
  WATER_GRAVITY: 0.005,              // GRAVITY / 16
  WATER_VERTICAL_DRAG: 0.8,
  LAVA_GRAVITY: 0.02,

  /** Velocity components below this magnitude snap to zero each tick. */
  VELOCITY_CUTOFF: 0.003,

  JUMP_VELOCITY: 0.42,
  JUMP_BOOST_PER_LEVEL: 0.1,
  /** Extra horizontal impulse along facing yaw on a sprint jump. */
  SPRINT_JUMP_BOOST: 0.2,
  JUMP_COOLDOWN_TICKS: 10,

  STEP_HEIGHT: 0.6,
  /** Sneaking refuses to step off a ledge with more than this much drop. */
  SNEAK_LEDGE_GRIP: 0.6,

  /** Vertical creative-flight impulse and its damping. */
  FLY_VERTICAL_IMPULSE: 0.15,
  FLY_VERTICAL_DAMP: 0.6,

  /** Cobweb clamps velocity to these per-axis maxima. */
  COBWEB_CLAMP: [0.25, 0.05, 0.25],
};

/** Ground acceleration for a given slipperiness and sprint state. */
export function groundAccel(slipperiness, sprinting, speedMultiplier = 1) {
  const speed = MOVE.BASE_SPEED * (sprinting ? MOVE.SPRINT_MULTIPLIER : 1) * speedMultiplier;
  const k = MOVE.DEFAULT_SLIPPERINESS / slipperiness;
  return speed * k * k * k;
}

/** Horizontal drag for a given slipperiness. */
export const groundDrag = (slipperiness) => slipperiness * MOVE.AIR_DRAG;

// ---------------------------------------------------------------- player body

export const PLAYER = {
  WIDTH: 0.6,
  HEIGHT: 1.8,
  HEIGHT_SNEAK: 1.5,
  HEIGHT_SWIM: 0.6,
  EYE_HEIGHT: 1.62,
  EYE_HEIGHT_SNEAK: 1.27,
  EYE_HEIGHT_SWIM: 0.4,

  MAX_HEALTH: 20,
  MAX_FOOD: 20,
  MAX_SATURATION: 20,
  MAX_AIR_TICKS: 300,

  /** Reach, matching the 1.20.5 attribute split. */
  BLOCK_REACH: 4.5,
  ENTITY_REACH: 3.0,

  /** Vanilla's default view bobbing amplitude, in blocks. */
  BOB_AMOUNT: 0.06,
};

// ---------------------------------------------------------------- damage

export const DAMAGE = {
  /** hurt() sets invulnerableTime = 20; the override window is the first 10. */
  INVULNERABLE_TICKS: 20,
  IMMUNITY_WINDOW_TICKS: 10,

  FALL_SAFE_DISTANCE: 3,
  FALL_MULTIPLIER: 1,

  FIRE_INTERVAL_TICKS: 10,
  FIRE_AMOUNT: 1,
  BURNING_INTERVAL_TICKS: 20,
  LAVA_INTERVAL_TICKS: 10,
  LAVA_AMOUNT: 4,
  CACTUS_INTERVAL_TICKS: 10,
  CACTUS_AMOUNT: 1,
  SUFFOCATION_INTERVAL_TICKS: 10,
  SUFFOCATION_AMOUNT: 1,
  DROWN_INTERVAL_TICKS: 20,
  DROWN_AMOUNT: 2,
  /** Air counts down to -20 before the first drowning hit lands. */
  DROWN_TRIGGER_AIR: -20,
  AIR_REFILL_PER_TICK: 4,

  VOID_Y: -128,
  VOID_AMOUNT: 4,
  VOID_INTERVAL_TICKS: 10,
};

/** damage = ceil((distance - safe) * multiplier); never negative. */
export function fallDamage(distance, safe = DAMAGE.FALL_SAFE_DISTANCE, mult = DAMAGE.FALL_MULTIPLIER) {
  return Math.max(0, Math.ceil((distance - safe) * mult));
}

// ---------------------------------------------------------------- knockback

export const KNOCKBACK = {
  BASE_STRENGTH: 0.4,
  /** Sprint hits and each Knockback level add another 0.5-strength impulse. */
  BONUS_PER_LEVEL: 0.5,
  MAX_VERTICAL: 0.4,
  /** The attacker's own horizontal velocity is scaled by this on a hit. */
  ATTACKER_SLOWDOWN: 0.6,
};

/**
 * LivingEntity.knockback. Mutates `vel` [vx, vy, vz] in place.
 * `dx`,`dz` point from the attacker toward the target.
 */
export function applyKnockback(vel, dx, dz, strength, onGround, resistance = 0) {
  strength *= 1 - resistance;
  if (strength <= 0) return vel;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return vel;
  const nx = (dx / len) * strength;
  const nz = (dz / len) * strength;
  vel[0] = vel[0] / 2 - nx;
  vel[2] = vel[2] / 2 - nz;
  // Airborne targets get no extra lift in Java Edition.
  if (onGround) vel[1] = Math.min(KNOCKBACK.MAX_VERTICAL, vel[1] / 2 + strength);
  return vel;
}

// ---------------------------------------------------------------- attack cooldown

/** cooldownTicks = 20 / attackSpeed. */
export const cooldownTicks = (attackSpeed) => 20 / attackSpeed;

/** Charge-scaled damage multiplier. p is charge progress in [0, 1]. */
export const chargeMultiplier = (p) => 0.2 + 0.8 * p * p;

/** Crits and sweeps both need the swing to be essentially fully charged. */
export const CRIT_CHARGE_THRESHOLD = 0.848;
export const CRIT_MULTIPLIER = 1.5;
export const SWEEP_DAMAGE = 1;

// ---------------------------------------------------------------- hunger

export const HUNGER = {
  EXHAUSTION_THRESHOLD: 4.0,

  // Java Edition: walking, sneaking and climbing cost nothing.
  EXH_SPRINT_PER_METER: 0.1,
  EXH_SWIM_PER_METER: 0.01,
  EXH_JUMP: 0.05,
  EXH_SPRINT_JUMP: 0.2,
  EXH_ATTACK: 0.1,
  EXH_BREAK_BLOCK: 0.005,
  EXH_TAKE_DAMAGE: 0.1,
  EXH_REGEN_PER_HP: 6.0,

  FAST_REGEN_INTERVAL: 10,     // ticks, needs food == 20 and saturation > 0
  SLOW_REGEN_INTERVAL: 80,     // ticks, needs saturation == 0 and food >= 18
  STARVE_INTERVAL: 80,

  REGEN_MIN_FOOD: 18,
  SPRINT_MIN_FOOD: 7,          // canSprint = foodLevel > 6

  /** Starvation floor per difficulty: easy stops at 10 HP, normal at 1, hard kills. */
  STARVE_FLOOR: { peaceful: Infinity, easy: 10, normal: 1, hard: 0 },
};

/**
 * One tick of FoodData. `s` is { food, saturation, exhaustion, timer, health }.
 * Returns { heal, starve } in HP for this tick. Mutates `s`.
 */
export function tickHunger(s, opts = {}) {
  const naturalRegen = opts.naturalRegeneration !== false;
  const difficulty = opts.difficulty || 'normal';
  const maxHealth = opts.maxHealth ?? PLAYER.MAX_HEALTH;
  let heal = 0, starve = 0;

  if (s.exhaustion > HUNGER.EXHAUSTION_THRESHOLD) {
    // Subtracts exactly 4.0 — it does not reset to zero.
    s.exhaustion -= HUNGER.EXHAUSTION_THRESHOLD;
    if (s.saturation > 0) s.saturation = Math.max(s.saturation - 1, 0);
    else if (difficulty !== 'peaceful') s.food = Math.max(s.food - 1, 0);
  }

  const hurt = s.health < maxHealth;
  if (naturalRegen && s.saturation > 0 && hurt && s.food >= 20) {
    if (++s.timer >= HUNGER.FAST_REGEN_INTERVAL) {
      const amount = Math.min(s.saturation, 6);
      heal = amount / 6;
      s.exhaustion += amount;
      s.timer = 0;
    }
  } else if (naturalRegen && s.saturation <= 0 && hurt && s.food >= HUNGER.REGEN_MIN_FOOD) {
    if (++s.timer >= HUNGER.SLOW_REGEN_INTERVAL) {
      heal = 1;
      s.exhaustion += HUNGER.EXH_REGEN_PER_HP;
      s.timer = 0;
    }
  } else if (s.food <= 0) {
    if (++s.timer >= HUNGER.STARVE_INTERVAL) {
      const floor = HUNGER.STARVE_FLOOR[difficulty] ?? 1;
      if (s.health > floor) starve = 1;
      s.timer = 0;
    }
  } else {
    s.timer = 0;
  }

  return { heal, starve };
}

/** Eating: food is capped at 20 and saturation is capped at the new food level. */
export function eat(s, nutrition, saturationModifier) {
  s.food = Math.min(s.food + nutrition, PLAYER.MAX_FOOD);
  s.saturation = Math.min(s.saturation + nutrition * saturationModifier * 2, s.food);
}

// ---------------------------------------------------------------- camera

export const CAMERA = {
  NEAR: 0.05,
  FAR_PADDING: 32,
  /** Sprinting scales FOV by (speed/walkSpeed + 1)/2 = 1.15. */
  SPRINT_FOV_MULTIPLIER: 1.15,
  FOV_LERP_RATE: 0.5,
  /** Max pitch, just shy of straight up/down so the view matrix stays stable. */
  MAX_PITCH: Math.PI / 2 - 1e-4,
  THIRD_PERSON_DISTANCE: 4,
};

// ---------------------------------------------------------------- world

export const WORLD = {
  CHUNK_SIZE: 16,
  CHUNK_HEIGHT: 192,
  /** Vanilla builds down to -64; a shallower floor keeps the browser honest. */
  MIN_Y: -64,
  SEA_LEVEL: 62,
  CLOUD_HEIGHT: 128,
  MAX_LIGHT: 15,

  /** A full day is 24000 ticks = 20 real minutes. */
  DAY_LENGTH_TICKS: 24000,
  DAY_START: 0,
  SUNSET_START: 12000,
  NIGHT_START: 13800,
  SUNRISE_START: 22200,

  /** Random block ticks per chunk section per tick. */
  RANDOM_TICK_SPEED: 3,
};

/** Ticks-of-day -> a 0..1 phase where 0 is sunrise and 0.5 is sunset. */
export function dayPhase(timeOfDay) {
  return ((timeOfDay % WORLD.DAY_LENGTH_TICKS) / WORLD.DAY_LENGTH_TICKS + 0.25) % 1;
}

/** Sky-light level scale for the current time, 0.2 at midnight to 1 at noon. */
export function skyBrightness(timeOfDay) {
  const angle = (timeOfDay / WORLD.DAY_LENGTH_TICKS) * Math.PI * 2;
  const f = Math.cos(angle) * 2 + 0.5;
  return Math.max(0, Math.min(1, f));
}

// ---------------------------------------------------------------- lighting

/**
 * Vanilla's light-level -> brightness curve.
 * f = level / 15; brightness = f / (4 - 3f), then lifted by the ambient floor.
 */
export function lightCurve(level, ambient = 0) {
  const f = level / WORLD.MAX_LIGHT;
  const b = f / (4 - 3 * f);
  return ambient + b * (1 - ambient);
}

/** Precomputed 16-entry brightness table for the overworld. */
export const LIGHT_TABLE = Float32Array.from({ length: 16 }, (_, i) => lightCurve(i, 0.05));

// ---------------------------------------------------------------- mobs

export const MOB_DEFAULTS = {
  KNOCKBACK_RESISTANCE: 0,
  DESPAWN_DISTANCE: 128,
  INSTANT_DESPAWN_DISTANCE: 128,
  /** Hostile mobs need light level <= 0 for block light to spawn in 1.18+. */
  HOSTILE_MAX_LIGHT: 0,
  AMBIENT_SOUND_INTERVAL: 80,
};
