// Emberhold's named villagers: a LivingEntity that keeps to its post, turns to
// watch whoever walks up, shuffles idly so it never reads as furniture, and is
// flatly invulnerable — the story cannot afford to lose a quest giver.

import { LivingEntity } from '../entity/entity.js';
import { yawToward, turnTowards, turnHead } from '../entity/ai.js';
import { B } from '../world/blocks.js';
import { Random, hash3 } from '../core/rng.js';
import { SPEAKERS } from './dialogue.js';

/** How far an NPC may drift from its post before it walks back. */
const LEASH = 3.5;
/** Range at which an NPC notices the player and turns to face them. */
const NOTICE = 7;
/** Blocks an NPC refuses to stand in, because someone has to get through. */
const DOORWAY = new Set([B.OAK_DOOR_LOWER, B.OAK_DOOR_UPPER]);

export class Npc extends LivingEntity {
  /**
   * @param {object} opts { name, dialogueId, role, yaw, wander, questGiver }
   */
  constructor(world, x, y, z, opts = {}) {
    super(world, x, y, z);

    this.type = 'npc';
    this.model = 'villager';
    this.skin = 'villager';
    this.isNpc = true;

    this.dialogueId = opts.dialogueId || 'narrator';
    this.role = opts.role || 'villager';
    this.name = opts.name || SPEAKERS[this.dialogueId]?.name || 'Villager';
    this.displayName = this.name;
    this.customName = this.name;

    this.width = 0.6;
    this.height = this.role === 'child' ? 1.3 : 1.9;
    this.maxHealth = 20;
    this.health = 20;
    this.attackDamage = 0;
    // LivingEntity reads moveSpeed on the player's scale, where 0.1 is 4.3 b/s —
    // not the squared attribute a Mob uses. This is a stroll, deliberately.
    this.moveSpeed = 0.045;

    // Nothing in the story may kill, push around or despawn a named villager.
    this.invulnerable = true;
    this.persistent = true;
    this.knockbackResistance = 1;

    this.questGiver = opts.questGiver !== false;
    this.wander = opts.wander === true;
    this.facePlayer = opts.facePlayer !== false;

    /** The spot this villager belongs at; they always drift back to it. */
    this.post = [x, y, z];
    this.homeYaw = (opts.yaw ?? 0) * Math.PI / 180;
    this.yaw = this.homeYaw;
    this.prevYaw = this.yaw;
    this.headYaw = this.yaw;

    /** True while a conversation with this villager is open; the model gestures. */
    this.talking = false;
    /** What the nameplate pass should hang over their head, when it can. */
    this.indicator = '';
    this.hasDialogue = true;

    this.rng = new Random(hash3(
      Math.floor(x * 8), Math.floor(y * 8), Math.floor(z * 8), world?.seed ?? 0,
    ));
    this.phase = this.rng.float(0, Math.PI * 2);
    this.strollTicks = 0;
    this.strollTarget = null;
  }

  /** Nothing hurts them; the override keeps sounds and knockback out of it too. */
  damage() { return false; }

  knockback() {}

  // ---------------------------------------------------------------- behaviour

  updateAI() {
    this.forwardInput = 0;
    this.strafeInput = 0;
    this.jumping = false;

    const player = this.nearestPlayer();
    const target = this._destination(player);

    if (target) {
      this._walkTo(target[0], target[2]);
    } else if (player && this.facePlayer && this.distanceTo(player) <= NOTICE) {
      // Turn the body slowly, the head quickly: it reads as being noticed.
      turnTowards(this, yawToward(this, player.x, player.z), 0.16);
      turnHead(this, player.x, player.y + player.height * 0.85, player.z);
    } else {
      turnTowards(this, this.homeYaw + Math.sin(this.age * 0.013 + this.phase) * 0.35, 0.05);
      this.headYaw = this.yaw;
      this.pitch = Math.sin(this.age * 0.021 + this.phase) * 0.06;
    }
  }

  /** Where this villager wants to be standing right now, or null for "here". */
  _destination(player) {
    if (this._inDoorway()) return this._doorwayEscape();

    const dx = this.x - this.post[0];
    const dz = this.z - this.post[2];
    if (dx * dx + dz * dz > LEASH * LEASH) return this.post;

    if (!this.wander) return null;
    if (this.strollTicks > 0) {
      this.strollTicks--;
      if (this.strollTarget) {
        const sx = this.x - this.strollTarget[0];
        const sz = this.z - this.strollTarget[2];
        if (sx * sx + sz * sz < 0.6) { this.strollTarget = null; this.strollTicks = 0; }
      }
      return this.strollTarget;
    }
    // Children potter about; adults stand at their post and pretend to work.
    if (this.rng.below(220) === 0 && !(player && this.distanceTo(player) < NOTICE)) {
      const a = this.rng.float(0, Math.PI * 2);
      const r = this.rng.float(1, LEASH - 1);
      this.strollTarget = [
        this.post[0] + Math.cos(a) * r, this.post[1], this.post[2] + Math.sin(a) * r,
      ];
      this.strollTicks = 100;
      return this.strollTarget;
    }
    return null;
  }

  _walkTo(tx, tz) {
    const wanted = yawToward(this, tx, tz);
    turnTowards(this, wanted, 0.28);
    this.headYaw = this.yaw;
    this.pitch = 0;
    // Only push forward once roughly aimed, so they walk instead of crabbing.
    const off = Math.abs(Math.atan2(Math.sin(wanted - this.yaw), Math.cos(wanted - this.yaw)));
    this.forwardInput = off < 1.2 ? 1 : 0.35;
    if (this.horizontalCollision && this.onGround) this.jumping = true;
  }

  _inDoorway() {
    const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    return DOORWAY.has(this.world.getBlock(bx, by, bz)) ||
           DOORWAY.has(this.world.getBlock(bx, by + 1, bz));
  }

  /** One block back toward the post, which is never itself a doorway. */
  _doorwayEscape() {
    const dx = this.post[0] - this.x;
    const dz = this.post[2] - this.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return [this.x + 1, this.y, this.z];
    return [this.x + (dx / len) * 2, this.y, this.z + (dz / len) * 2];
  }

  nearestPlayer(range = 24) {
    return this.world?.nearestEntity(
      this.x, this.y, this.z, range,
      (e) => !e.dead && (e.isPlayer === true || e.type === 'player'),
    ) || null;
  }

  /** A floor under the idle animation, so a standing villager still breathes. */
  updateLimbSwing() {
    super.updateLimbSwing();
    const idle = (Math.sin(this.age * 0.07 + this.phase) * 0.5 + 0.5) * 0.07;
    if (this.limbSwingAmount < idle) {
      this.limbSwingAmount = idle;
      this.limbSwing += idle * 0.5;
    }
  }

  /** Called by the story when a conversation opens or closes on this villager. */
  setTalking(on) {
    this.talking = !!on;
    if (on) this.strollTicks = 0;
  }

  /**
   * The story sets this to '!' for a quest giver, '…' for small talk. The
   * nameplate pass in render/entityrenderer.js reads `customName` before it
   * reads anything else, so hanging the marker off the name is what actually
   * puts it over their head. Guarded on change: this is driven every tick.
   */
  setIndicator(text) {
    const next = text || '';
    if (next === this.indicator) return;
    this.indicator = next;
    this.customName = next ? `${this.name} ${next}` : this.name;
  }

  /** The pitch their greeting is played at; story.js owns the audio engine. */
  get voicePitch() { return SPEAKERS[this.dialogueId]?.pitch ?? 1; }

  toJSON() {
    const o = super.toJSON();
    o.dialogueId = this.dialogueId;
    o.role = this.role;
    o.name = this.name;
    o.post = this.post.slice();
    return o;
  }
}

/** Builds and registers the villagers a structure's npcSpawns asked for. */
export function spawnNpcs(world, spawns) {
  const out = [];
  for (const s of spawns || []) {
    if (!s) continue;
    const y = world.findSpawnY(Math.floor(s.x), Math.floor(s.z), Math.floor(s.y) + 6);
    const npc = new Npc(world, s.x, y, s.z, {
      name: s.name,
      dialogueId: s.dialogueId,
      role: s.role,
      yaw: s.yaw,
      wander: s.role === 'child',
    });
    world.addEntity(npc);
    out.push(npc);
  }
  return out;
}
