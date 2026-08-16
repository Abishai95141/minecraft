// The furnace GUI. Owns the smelting simulation for the block it was opened on:
// it reads and writes that block's entity, burns fuel, cooks the input, and
// keeps the world block in step with whether the fire is lit.

import { drawText } from '../font.js';
import { ItemStack, Inventory } from '../../item/inventory.js';
import { smeltResult, fuelTicks, SMELT_TICKS } from '../../item/smelting.js';
import { B } from '../../world/blocks.js';
import { clamp } from '../../core/math.js';
import {
  ContainerScreen, Slot, drawArrow, toPos, loadItems, storeItems, readContainerEntity,
} from './inventory.js';

const LABEL_COLOR = 0x404040;
const INPUT = 0;
const FUEL = 1;
const OUTPUT = 2;

/** Ticks replayed at most when a furnace is reopened after being left alone. */
const CATCH_UP_LIMIT = 6000;

/** The 14x14 flame, as [xOffset, width] per row from the tip down. */
const FLAME_ROWS = [
  [6, 2], [5, 3], [5, 4], [4, 5], [4, 6], [3, 7], [3, 8],
  [2, 9], [2, 10], [2, 10], [1, 12], [1, 12], [2, 10], [3, 8],
];

function paintFlame(ctx, x, y, color, from, to) {
  ctx.fillStyle = color;
  for (let r = from; r < to; r++) {
    const row = FLAME_ROWS[r];
    ctx.fillRect(x + row[0], y + r, row[1], 1);
  }
}

/** Burns upward: a full flame at 1, a cold silhouette at 0. */
export function drawFlame(ctx, x, y, fraction) {
  paintFlame(ctx, x, y, '#59524a', 0, FLAME_ROWS.length);
  const lit = Math.round(clamp(fraction, 0, 1) * FLAME_ROWS.length);
  if (lit <= 0) return;
  const from = FLAME_ROWS.length - lit;
  paintFlame(ctx, x, y, '#ff9a1e', from, FLAME_ROWS.length);
  ctx.fillStyle = '#ffe08a';
  for (let r = Math.max(from, 5); r < FLAME_ROWS.length - 1; r++) {
    const row = FLAME_ROWS[r];
    if (row[1] > 4) ctx.fillRect(x + row[0] + 2, y + r, row[1] - 4, 1);
  }
}

export class FurnaceScreen extends ContainerScreen {
  constructor(game, pos = null) {
    super(game, { panelW: 176, panelH: 166, title: 'Furnace' });
    this.pos = toPos(pos);
    this.container = new Inventory(3);

    this.data = readContainerEntity(this.game?.world ?? null, this.pos, 'furnace', 3, {
      burnTicks: 0, burnTotal: 0, cookTicks: 0, xp: 0, tickedAt: this.worldTicks(),
    });
    // A furnace lit by worldgen carries burnTicks but no total to scale against.
    if (this.data.burnTotal <= 0 && this.data.burnTicks > 0) this.data.burnTotal = this.data.burnTicks;

    loadItems(this.container, this.data.items);
    this._unsubs.push(this.container.onChange(() => this.save()));
    this.catchUp();
  }

  worldTicks() { return this.game?.world?.totalTicks ?? 0; }

  save() {
    this.data.items = storeItems(this.container);
    const world = this.game?.world;
    if (world && this.pos) world.setBlockEntity(this.pos.x, this.pos.y, this.pos.z, this.data);
  }

  buildSlots() {
    this.addSlot(new Slot(this.container, INPUT, 56, 17, { group: 'container' }));
    this.addSlot(new Slot(this.container, FUEL, 56, 53, {
      group: 'container',
      accepts: (s) => fuelTicks(s.name) > 0,
    }));
    this.addSlot(new Slot(this.container, OUTPUT, 116, 31, {
      group: 'container',
      takeOnly: true,
      onTake: () => this.claimXp(),
    }));
    this.addPlayerSlots(84, 142);
  }

  // ---------------------------------------------------------------- smelting

  get burnFraction() {
    const total = this.data.burnTotal;
    return total > 0 ? clamp(this.data.burnTicks / total, 0, 1) : 0;
  }

  get cookFraction() { return clamp(this.data.cookTicks / SMELT_TICKS, 0, 1); }

  /** The recipe the input would cook into right now, or null when the input is
   *  not smeltable or the output slot has no room for the result. */
  smeltableNow() {
    const input = this.container.get(INPUT);
    if (input.isEmpty) return null;
    const recipe = smeltResult(input.name);
    if (!recipe) return null;
    const out = this.container.get(OUTPUT);
    if (out.isEmpty) return recipe;
    if (out.name !== recipe.out || out.damage !== 0) return null;
    return out.count < out.maxStack ? recipe : null;
  }

  tick() {
    super.tick();
    this.tickFurnace(false);
    this.data.tickedAt = this.worldTicks();
  }

  /**
   * The furnace keeps working while the screen is shut, so replay whatever the
   * world ticked through since it was last looked at. Capped so that returning
   * to a furnace after a very long trip cannot stall a frame.
   */
  catchUp() {
    const world = this.game?.world;
    if (!world) return;
    const elapsed = clamp(Math.floor(world.totalTicks - this.data.tickedAt), 0, CATCH_UP_LIMIT);
    for (let i = 0; i < elapsed; i++) this.tickFurnace(true);
    this.data.tickedAt = world.totalTicks;
    this.setLit(this.data.burnTicks > 0);
    this.save();
  }

  /** `silent` replays a tick without the ignition sound, for the catch-up pass. */
  tickFurnace(silent) {
    const be = this.data;
    if (be.burnTicks > 0) be.burnTicks--;

    const recipe = this.smeltableNow();

    // Only light a fresh piece of fuel when there is something worth cooking.
    if (be.burnTicks <= 0 && recipe) {
      const fuel = this.container.get(FUEL);
      const ticks = fuel.isEmpty ? 0 : fuelTicks(fuel.name);
      if (ticks > 0) {
        be.burnTicks = ticks;
        be.burnTotal = ticks;
        if (fuel.name === 'lava_bucket') {
          // A bucket of lava leaves the empty bucket behind, as in vanilla.
          this.container.set(FUEL, new ItemStack('bucket', 1));
        } else {
          fuel.shrink(1);
          if (fuel.isEmpty) this.container.set(FUEL, ItemStack.EMPTY);
          else this.container.changed(FUEL);
        }
      }
    }

    if (be.burnTicks > 0 && recipe) {
      be.cookTicks++;
      if (be.cookTicks >= SMELT_TICKS) {
        be.cookTicks = 0;
        const out = this.container.get(OUTPUT);
        if (out.isEmpty) this.container.set(OUTPUT, new ItemStack(recipe.out, 1));
        else { out.grow(1); this.container.changed(OUTPUT); }
        const input = this.container.get(INPUT);
        input.shrink(1);
        if (input.isEmpty) this.container.set(INPUT, ItemStack.EMPTY);
        else this.container.changed(INPUT);
        be.xp += recipe.xp;
      }
    } else if (be.cookTicks > 0) {
      // Progress bleeds away twice as fast as it builds when the fire dies.
      be.cookTicks = Math.max(0, be.cookTicks - 2);
    }

    // Synced every tick rather than only on a transition, so a furnace whose
    // counters were restored from a save cannot stay visually stuck alight.
    const lit = be.burnTicks > 0;
    if (this.setLit(lit) && lit && !silent) {
      const p = this.pos;
      if (p) this.game?.playSound?.('fire', { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5, volume: 0.3 });
    }
  }

  /** Swaps FURNACE and FURNACE_LIT so the world lights up while it burns.
   *  Returns true when the block actually changed. */
  setLit(lit) {
    const world = this.game?.world;
    const p = this.pos;
    if (!world || !p) return false;
    const id = world.getBlock(p.x, p.y, p.z);
    if (id !== B.FURNACE && id !== B.FURNACE_LIT) return false;
    const want = lit ? B.FURNACE_LIT : B.FURNACE;
    if (id === want) return false;
    world.setBlock(p.x, p.y, p.z, want, world.getMeta(p.x, p.y, p.z));
    return true;
  }

  /** Experience banks up as items cook and is paid out when they are collected. */
  claimXp() {
    const whole = Math.floor(this.data.xp || 0);
    if (whole < 1) return;
    this.data.xp -= whole;
    this.player?.addXp?.(whole);
    this.game?.playSound?.('xp', { volume: 0.4 });
  }

  // ---------------------------------------------------------------- routing

  routeIntoContainer(stack) {
    if (smeltResult(stack.name)) return this.container.addRange(stack, INPUT, INPUT + 1);
    if (fuelTicks(stack.name) > 0) return this.container.addRange(stack, FUEL, FUEL + 1);
    return stack;
  }

  onContainerClosed() {
    this.save();
  }

  // ---------------------------------------------------------------- drawing

  drawPanelContent(ctx, px, py, dt) {
    drawText(ctx, 'Furnace', 8, 6, { color: LABEL_COLOR, shadow: false });
    this.drawInventoryLabel(ctx);
    drawFlame(ctx, 56, 36, this.burnFraction);
    drawArrow(ctx, 79, 35, 24, 17, 1, '#8b8b8b');
    drawArrow(ctx, 79, 35, 24, 17, this.cookFraction, '#f4f4f4');
  }
}
