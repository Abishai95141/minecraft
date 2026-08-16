// The player inventory screen, and the container-GUI machinery every container
// screen shares: slot geometry, the stack held by the cursor, click / drag /
// shift / Q interaction, and a crafting grid with a live recipe preview.

import { Screen } from '../screen.js';
import { drawPanel, drawSlot, drawGradientOverlay } from '../widgets.js';
import { drawText } from '../font.js';
import { icons } from '../icons.js';
import { drawTooltip, tooltipLinesFor } from '../tooltip.js';
import { ItemStack, Inventory } from '../../item/inventory.js';
import { getItem } from '../../item/items.js';
import { findRecipe } from '../../item/recipes.js';
import { clamp } from '../../core/math.js';

/**
 * Slot pitch, and the 16x16 icon area inside the 18x18 frame. Vanilla's
 * published slot coordinates address the *item*, with the sunken frame drawn
 * one pixel up and left of it — keeping that convention is what makes the
 * panel margins come out symmetric and the furnace flame sit centred under
 * its slot, so `Slot.x/y` here is the item origin, never the frame origin.
 */
export const SLOT = 18;
const ITEM = 16;

/** PlayerInventory layout, restated so the routing below reads clearly. */
const HOTBAR_SIZE = 9;
const MAIN_END = 36;
const ARMOR_START = 36;

const LABEL_COLOR = 0x404040;
/** Vanilla's slot highlight is 0x80FFFFFF. */
const HOVER_FILL = 'rgba(255,255,255,0.502)';

export const SlotKind = {
  NORMAL: 'normal',
  ARMOR: 'armor',
  CRAFT: 'craft',
  RESULT: 'result',
};

// ------------------------------------------------------------------ helpers

/** `game.openContainer` hands screens `[x,y,z]`; objects are accepted too. */
export function toPos(pos) {
  if (Array.isArray(pos) && pos.length >= 3) {
    return { x: Math.floor(pos[0]), y: Math.floor(pos[1]), z: Math.floor(pos[2]) };
  }
  if (pos && typeof pos === 'object' && typeof pos.x === 'number') {
    return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  }
  return null;
}

/** Block-entity slots are `{item, count, damage}` (see world/structures.js). */
export function stackFromSlotData(o) {
  if (!o || typeof o !== 'object') return ItemStack.EMPTY;
  const name = o.item ?? o.n ?? null;
  if (!name || !getItem(name)) return ItemStack.EMPTY;
  return new ItemStack(name, o.count ?? o.c ?? 1, o.damage ?? o.d ?? 0);
}

export function slotDataFromStack(stack) {
  if (!stack || stack.isEmpty) return null;
  return { item: stack.name, count: stack.count, damage: stack.damage };
}

export function loadItems(inv, items) {
  const arr = Array.isArray(items) ? items : [];
  for (let i = 0; i < inv.size; i++) inv.set(i, stackFromSlotData(arr[i]));
}

export function storeItems(inv) {
  const out = new Array(inv.size);
  for (let i = 0; i < inv.size; i++) out[i] = slotDataFromStack(inv.get(i));
  return out;
}

/**
 * Fetches a container's block entity, creating it when the block was placed by
 * the player and has never been opened. `numbers` seeds extra numeric fields
 * (the furnace's burn and cook counters) without clobbering saved values.
 */
export function readContainerEntity(world, pos, kind, size, numbers = null) {
  let be = world && pos ? world.getBlockEntity(pos.x, pos.y, pos.z) : null;
  if (!be || typeof be !== 'object' || !Array.isArray(be.items)) {
    be = { kind, size, items: new Array(size).fill(null) };
    if (numbers) for (const key of Object.keys(numbers)) be[key] = numbers[key];
    if (world && pos) world.setBlockEntity(pos.x, pos.y, pos.z, be);
    return be;
  }
  while (be.items.length < size) be.items.push(null);
  if (numbers) {
    for (const key of Object.keys(numbers)) {
      if (typeof be[key] !== 'number' || !Number.isFinite(be[key])) be[key] = numbers[key];
    }
  }
  be.kind = be.kind || kind;
  be.size = size;
  return be;
}

/** The recessed well the player model sits in — drawSlot's shading, any size. */
export function drawInset(ctx, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = '#8b8b8b';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#373737';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 1, y + h - 1, w - 1, 1);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 1);
}

/** A right-pointing arrow, revealed left to right by `fraction`. */
export function drawArrow(ctx, x, y, w, h, fraction, color) {
  const cut = Math.round(w * clamp(fraction, 0, 1));
  if (cut <= 0 || w < 4 || h < 3) return;
  const head = Math.max(3, Math.round(h / 2) + 1);
  const shaftW = w - head;
  // Odd, so the shaft straddles the head's centre row instead of sitting a
  // half pixel high against it.
  let shaftH = Math.max(1, Math.round(h / 3));
  if (shaftH % 2 === 0) shaftH++;
  const mid = Math.floor(h / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cut, h);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y + mid - Math.floor(shaftH / 2), shaftW, shaftH);
  for (let i = 0; i < head; i++) {
    const half = Math.round(((head - 1 - i) / (head - 1)) * ((h - 1) / 2));
    ctx.fillRect(x + shaftW + i, y + mid - half, 1, half * 2 + 1);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ slots

/** One 18x18 cell, addressed in panel-local GUI pixels. */
export class Slot {
  constructor(inv, index, x, y, opts = {}) {
    this.inv = inv;
    this.index = index;
    this.x = x;
    this.y = y;
    this.kind = opts.kind ?? SlotKind.NORMAL;
    /** Routing tag for shift-click: 'hotbar' | 'main' | 'armor' | 'craft' | 'result' | 'container'. */
    this.group = opts.group ?? 'normal';
    this.limit = opts.limit ?? 64;
    this.takeOnly = opts.takeOnly === true;
    this.accepts = opts.accepts ?? null;
    this.onTake = opts.onTake ?? null;
  }

  get stack() { return this.inv.get(this.index); }

  /** The whole 18x18 frame is clickable, not just the icon. */
  contains(px, py) {
    return px >= this.x - 1 && px < this.x - 1 + SLOT && py >= this.y - 1 && py < this.y - 1 + SLOT;
  }

  mayPlace(stack) {
    if (this.takeOnly || !stack || stack.isEmpty) return false;
    return this.accepts ? !!this.accepts(stack) : true;
  }

  /** How many of `stack` this slot will hold — armour slots take exactly one. */
  capacity(stack) { return Math.min(this.limit, stack.maxStack); }
}

// ------------------------------------------------------------------ base screen

export class ContainerScreen extends Screen {
  constructor(game, opts = {}) {
    super(game);
    this.panelW = opts.panelW ?? 176;
    this.panelH = opts.panelH ?? 166;
    this.title = opts.title ?? '';
    this.pausesGame = false;
    this.blursBackground = true;
    this.closeOnEscape = true;

    this.left = 0;
    this.top = 0;
    /** @type {Slot[]} */
    this.slots = [];
    this.hovered = null;

    /** The stack on the cursor. Always an object this screen alone owns. */
    this.held = new ItemStack(null, 0);
    this.drag = { active: false, button: 0, slots: [], origin: null };

    /** Set by container subclasses; null on the plain inventory. */
    this.container = null;
    /** Set by crafting subclasses. */
    this.craft = null;
    this.craftW = 0;
    this.result = null;
    this.recipeMatch = null;

    this._unsubs = [];
  }

  get player() { return this.game?.player ?? null; }
  get inv() { return this.game?.player?.inventory ?? null; }

  // ---------------------------------------------------------------- layout

  build(w, h) {
    this.left = Math.round((w - this.panelW) / 2);
    this.top = Math.round((h - this.panelH) / 2);
    this.slots.length = 0;
    this.buildSlots();
  }

  /** Override point: create slots in panel-local coordinates. */
  buildSlots() {}

  addSlot(slot) {
    this.slots.push(slot);
    return slot;
  }

  addGrid(inv, first, cols, rows, x, y, opts = {}) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.addSlot(new Slot(inv, first + r * cols + c, x + c * SLOT, y + r * SLOT, opts));
      }
    }
  }

  /** The 3x9 carried grid and the hotbar row, at whatever y this panel uses. */
  addPlayerSlots(mainY, hotbarY, x = 8) {
    const inv = this.inv;
    if (!inv) return;
    this.addGrid(inv, HOTBAR_SIZE, 9, 3, x, mainY, { group: 'main' });
    this.addGrid(inv, 0, 9, 1, x, hotbarY, { group: 'hotbar' });
  }

  slotAt(mx, my) {
    const px = mx - this.left;
    const py = my - this.top;
    for (const s of this.slots) if (s.contains(px, py)) return s;
    return null;
  }

  insidePanel(mx, my) {
    const px = mx - this.left;
    const py = my - this.top;
    return px >= 0 && px < this.panelW && py >= 0 && py < this.panelH;
  }

  // ---------------------------------------------------------------- modifiers

  shiftDown() {
    const i = this.game?.input;
    return !!i && (i.isDown('ShiftLeft') || i.isDown('ShiftRight'));
  }

  ctrlDown() {
    const i = this.game?.input;
    return !!i && (i.isDown('ControlLeft') || i.isDown('ControlRight')
      || i.isDown('MetaLeft') || i.isDown('MetaRight'));
  }

  // ---------------------------------------------------------------- mouse

  onMouseDown(mx, my, button) {
    this.mouseX = mx;
    this.mouseY = my;
    if (!this.inv) return true;
    if (button !== 0 && button !== 2) return true;

    const slot = this.slotAt(mx, my);
    if (!slot) {
      // Throwing the cursor stack away only counts outside the window frame.
      if (!this.held.isEmpty && !this.insidePanel(mx, my)) {
        this.dropStackOut(this.held.split(button === 2 ? 1 : this.held.count));
      }
      return true;
    }
    if (this.shiftDown()) {
      this.quickMove(slot);
      return true;
    }

    // With a stack on the cursor a press opens a distribute-drag; releasing over
    // a single slot degrades it back into an ordinary click, exactly as vanilla
    // does, which is why placing only commits on mouse-up.
    if (!this.held.isEmpty) {
      this.drag.active = true;
      this.drag.button = button;
      this.drag.origin = slot;
      this.drag.slots = this.canDragInto(slot) ? [slot] : [];
      return true;
    }
    this.clickSlot(slot, button);
    return true;
  }

  onMouseUp(mx, my, button) {
    if (!this.drag.active || button !== this.drag.button) return true;
    this.drag.active = false;
    const list = this.drag.slots;
    if (list.length > 1) this.distribute(list, button);
    else if (this.drag.origin) this.clickSlot(this.drag.origin, button);
    this.drag.slots = [];
    this.drag.origin = null;
    return true;
  }

  canDragInto(slot) {
    if (!slot || this.held.isEmpty || !slot.mayPlace(this.held)) return false;
    const cur = slot.stack;
    if (cur.isEmpty) return true;
    return cur.canStackWith(this.held) && cur.count < slot.capacity(this.held);
  }

  updateDrag(mx, my) {
    if (this.held.isEmpty) return;
    const slot = this.slotAt(mx, my);
    if (!slot || this.drag.slots.includes(slot) || !this.canDragInto(slot)) return;
    this.drag.slots.push(slot);
  }

  /** Left-drag spreads the stack evenly; right-drag leaves one per slot. */
  distribute(list, button) {
    if (this.held.isEmpty) return;
    const per = button === 2 ? 1 : Math.max(1, Math.floor(this.held.count / list.length));
    for (const slot of list) {
      if (this.held.isEmpty) break;
      const cur = slot.stack;
      if (!cur.isEmpty && !cur.canStackWith(this.held)) continue;
      const room = slot.capacity(this.held) - (cur.isEmpty ? 0 : cur.count);
      const take = Math.min(per, this.held.count, room);
      if (take <= 0) continue;
      if (cur.isEmpty) {
        slot.inv.set(slot.index, new ItemStack(this.held.name, take, this.held.damage));
      } else {
        cur.grow(take);
        slot.inv.changed(slot.index);
      }
      this.held.shrink(take);
    }
  }

  clickSlot(slot, button) {
    if (!slot) return;
    if (slot.kind === SlotKind.RESULT) { this.takeResult(); return; }
    if (button === 2) this.rightClickSlot(slot);
    else this.leftClickSlot(slot);
  }

  leftClickSlot(slot) {
    const cur = slot.stack;
    if (this.held.isEmpty) {
      if (cur.isEmpty) return;
      this.held = this.takeFrom(slot, cur.count);
      return;
    }
    if (!slot.mayPlace(this.held)) return;

    if (cur.isEmpty) {
      slot.inv.set(slot.index, this.held.split(slot.capacity(this.held)));
      return;
    }
    if (cur.canStackWith(this.held)) {
      const n = Math.min(slot.capacity(this.held) - cur.count, this.held.count);
      if (n > 0) {
        cur.grow(n);
        this.held.shrink(n);
        slot.inv.changed(slot.index);
      }
      return;
    }
    // Swap, but never past what the slot is allowed to hold.
    if (this.held.count <= slot.capacity(this.held)) {
      const swap = cur.clone();
      slot.onTake?.(swap, this);
      slot.inv.set(slot.index, this.held);
      this.held = swap;
    }
  }

  rightClickSlot(slot) {
    const cur = slot.stack;
    if (this.held.isEmpty) {
      if (cur.isEmpty) return;
      this.held = this.takeFrom(slot, Math.ceil(cur.count / 2));
      return;
    }
    if (!slot.mayPlace(this.held)) return;
    if (cur.isEmpty) {
      slot.inv.set(slot.index, this.held.split(1));
      return;
    }
    if (cur.canStackWith(this.held) && cur.count < slot.capacity(this.held)) {
      cur.grow(1);
      this.held.shrink(1);
      slot.inv.changed(slot.index);
    }
  }

  /** Every path that removes items from a slot goes through here, so a slot's
   *  `onTake` hook (the furnace's experience payout) can never be bypassed. */
  takeFrom(slot, count) {
    const out = slot.inv.remove(slot.index, count);
    if (!out.isEmpty) slot.onTake?.(out, this);
    return out;
  }

  // ---------------------------------------------------------------- quick move

  /** Feeds as much of `slot` into `sink` as it will take. Returns the count moved. */
  moveOut(slot, sink) {
    const src = slot.stack;
    if (src.isEmpty) return 0;
    const moving = src.clone();
    const before = moving.count;
    const left = sink(moving);
    const moved = before - (left && !left.isEmpty ? left.count : 0);
    if (moved > 0) this.takeFrom(slot, moved);
    return moved;
  }

  quickMove(slot) {
    if (!this.inv) return;
    if (slot.kind === SlotKind.RESULT) { this.craftAll(); return; }

    // Out of a container, the armour column or a crafting grid: into reach.
    if (slot.group === 'container' || slot.group === 'armor' || slot.group === 'craft') {
      this.moveOut(slot, (s) => this.inv.addToHotbarFirst(s));
      return;
    }
    // Out of the player's own grid: into the open container if there is one...
    if (this.container && this.moveOut(slot, (s) => this.routeIntoContainer(s)) > 0) return;
    // ...otherwise vanilla's hotbar/main-grid shuffle.
    if (slot.group === 'main') this.moveOut(slot, (s) => this.inv.addRange(s, 0, HOTBAR_SIZE));
    else this.moveOut(slot, (s) => this.inv.addRange(s, HOTBAR_SIZE, MAIN_END));
  }

  /** Where a shift-clicked player stack lands. Returns the untaken remainder. */
  routeIntoContainer(stack) {
    return this.container ? this.container.add(stack) : stack;
  }

  /** Vanilla's number-key swap between the hovered slot and a hotbar slot. */
  swapWithHotbar(slot, hotbarIndex) {
    const inv = this.inv;
    if (!inv || !slot || slot.kind === SlotKind.RESULT) return;
    if (slot.inv === inv && slot.index === hotbarIndex) return;

    const src = slot.stack;
    const dst = inv.get(hotbarIndex);
    if (src.isEmpty && dst.isEmpty) return;
    if (!dst.isEmpty && (!slot.mayPlace(dst) || dst.count > slot.capacity(dst))) return;

    const a = src.isEmpty ? ItemStack.EMPTY : src.clone();
    const b = dst.isEmpty ? ItemStack.EMPTY : dst.clone();
    if (!a.isEmpty) this.takeFrom(slot, a.count);
    slot.inv.set(slot.index, b);
    inv.set(hotbarIndex, a);
  }

  // ---------------------------------------------------------------- crafting

  gridStacks() {
    const out = [];
    for (let i = 0; i < this.craft.size; i++) out.push(this.craft.get(i));
    return out;
  }

  /** Re-resolves the grid. The result slot only ever holds a preview: nothing
   *  is consumed until the player actually lifts it out. */
  refreshRecipe() {
    if (!this.craft || !this.result) return;
    this.recipeMatch = findRecipe(this.gridStacks(), this.craftW);
    this.result.set(0, this.recipeMatch ? this.recipeMatch.output.clone() : ItemStack.EMPTY);
  }

  resultStack() { return this.result ? this.result.get(0) : ItemStack.EMPTY; }

  consumeIngredients() {
    if (!this.craft || !this.recipeMatch) return;
    // recipes.js takes one out of every filled cell of the live grid.
    this.recipeMatch.consume(this.gridStacks());
    for (let i = 0; i < this.craft.size; i++) {
      if (this.craft.get(i).isEmpty) this.craft.set(i, ItemStack.EMPTY);
    }
    this.craft.changed();
    this.refreshRecipe();
  }

  takeResult() {
    const out = this.resultStack();
    if (out.isEmpty) return;
    const taken = out.clone();
    if (this.held.isEmpty) {
      this.held = taken;
    } else if (this.held.canStackWith(taken) && this.held.count + taken.count <= this.held.maxStack) {
      this.held.grow(taken.count);
    } else {
      return;
    }
    this.consumeIngredients();
    this.onCrafted(taken.name, taken.count);
  }

  /** Shift-clicking the result crafts as many times as the grid allows. */
  craftAll() {
    if (!this.craft || !this.inv) return;
    let made = 0;
    let name = null;
    let total = 0;
    while (this.recipeMatch && made < 256) {
      const out = this.recipeMatch.output.clone();
      if (!this.canFit(out)) break;
      name = out.name;
      total += out.count;
      this.consumeIngredients();
      this.inv.addToHotbarFirst(out);
      made++;
    }
    if (made > 0) this.onCrafted(name, total);
  }

  onCrafted(name, count) {
    this.game?.playSound?.('click', { volume: 0.3 });
    this.game?.story?.onEvent?.('itemCrafted', { item: name, count });
  }

  /** True when the carried grid has room for the whole stack. */
  canFit(stack) {
    const inv = this.inv;
    if (!inv || stack.isEmpty) return false;
    let need = stack.count;
    for (let i = 0; i < MAIN_END && need > 0; i++) {
      const s = inv.get(i);
      if (s.isEmpty) return true;
      if (s.canStackWith(stack)) need -= Math.min(s.spaceLeft, need);
    }
    return need <= 0;
  }

  returnCraftingGrid() {
    if (!this.craft) return;
    for (let i = 0; i < this.craft.size; i++) {
      const s = this.craft.get(i);
      if (s.isEmpty) continue;
      const out = s.clone();
      this.craft.set(i, ItemStack.EMPTY);
      this.giveBack(out);
    }
    this.recipeMatch = null;
    this.result?.set(0, ItemStack.EMPTY);
  }

  // ---------------------------------------------------------------- keyboard

  onKeyDown(code, e) {
    const action = this.game?.input?.actionFor?.(code) ?? null;
    if (code === 'Escape' || action === 'inventory') { this.close(); return true; }
    if (action === 'drop') {
      this.dropAction(this.ctrlDown() || !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)));
      return true;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (digit && this.hovered) {
      this.swapWithHotbar(this.hovered, Number(digit[1]) - 1);
      return true;
    }
    return super.onKeyDown(code, e);
  }

  /** Q drops one, Ctrl/Shift+Q the whole stack — from the cursor if it is
   *  loaded, otherwise from whatever the pointer is over. */
  dropAction(all) {
    if (!this.held.isEmpty) {
      this.dropStackOut(this.held.split(all ? this.held.count : 1));
      return;
    }
    const slot = this.hovered;
    if (!slot) return;
    if (slot.kind === SlotKind.RESULT) {
      const out = this.resultStack();
      if (out.isEmpty) return;
      const taken = out.clone();
      this.consumeIngredients();
      this.onCrafted(taken.name, taken.count);
      this.dropStackOut(taken);
      return;
    }
    const cur = slot.stack;
    if (cur.isEmpty) return;
    this.dropStackOut(this.takeFrom(slot, all ? cur.count : 1));
  }

  dropStackOut(stack) {
    if (!stack || stack.isEmpty) return;
    const p = this.player;
    if (p?.dropStack) p.dropStack(stack, false);
    else this.inv?.add(stack);
    this.game?.playSound?.('pop', { volume: 0.25 });
  }

  /** Back into the player's hands, or onto the floor when there is no room. */
  giveBack(stack) {
    if (!stack || stack.isEmpty) return;
    if (!this.inv) { this.dropStackOut(stack); return; }
    const left = this.inv.addToHotbarFirst(stack);
    if (left && !left.isEmpty) this.dropStackOut(left.clone());
  }

  // ---------------------------------------------------------------- lifecycle

  onClose() {
    this.drag.active = false;
    this.drag.slots = [];
    this.drag.origin = null;
    this.returnCraftingGrid();
    this.giveBack(this.held);
    this.held = new ItemStack(null, 0);
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
    this.onContainerClosed();
    super.onClose();
  }

  /** Override point: flush a block entity, play the closing sound. */
  onContainerClosed() {}

  // ---------------------------------------------------------------- drawing

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.mouseX = mx;
    this.mouseY = my;
    this.hovered = this.slotAt(mx, my);
    if (this.drag.active) this.updateDrag(mx, my);

    // A container only ever opens over a live world, so the dim is unconditional.
    drawGradientOverlay(ctx, this.width, this.height);

    ctx.save();
    ctx.translate(this.left, this.top);
    drawPanel(ctx, 0, 0, this.panelW, this.panelH);
    this.drawPanelContent(ctx, mx - this.left, my - this.top, dt);
    for (const s of this.slots) drawSlot(ctx, s.x - 1, s.y - 1);
    for (const s of this.slots) {
      const stack = s.stack;
      if (!stack.isEmpty) icons.drawStack(ctx, stack, s.x, s.y);
    }
    if (this.hovered) {
      ctx.fillStyle = HOVER_FILL;
      ctx.fillRect(this.hovered.x, this.hovered.y, ITEM, ITEM);
    }
    ctx.restore();

    if (!this.held.isEmpty) icons.drawStack(ctx, this.held, mx - 8, my - 8);
    else if (this.hovered && !this.hovered.stack.isEmpty) this.renderSlotTooltip(ctx, mx, my);
  }

  /** Override point: labels and container decoration, in panel-local space. */
  drawPanelContent(ctx, px, py, dt) {
    if (this.title) drawText(ctx, this.title, 8, 6, { color: LABEL_COLOR, shadow: false });
    this.drawInventoryLabel(ctx);
  }

  drawInventoryLabel(ctx) {
    drawText(ctx, 'Inventory', 8, this.panelH - 94, { color: LABEL_COLOR, shadow: false });
  }

  renderSlotTooltip(ctx, mx, my) {
    const lines = slotTooltipLines(this.hovered.stack);
    if (!lines.length) return;
    drawTooltip(ctx, lines, mx, my, this.width, this.height);
  }
}

/** tooltip.js owns the vanilla line set; this keeps the box populated even if
 *  it hands back nothing for an item it does not recognise. */
function slotTooltipLines(stack) {
  const lines = tooltipLinesFor(stack);
  if (Array.isArray(lines) && lines.length) return lines;
  const item = stack.item;
  const out = [`§f${item?.display ?? stack.name ?? ''}`];
  if (item?.desc) out.push(`§7${item.desc}`);
  return out;
}

// ------------------------------------------------------------------ player model

const DOLL = {
  hair: '#2b1a10',
  face: '#c99e78',
  faceShade: '#ac8262',
  shirt: '#2f9d9d',
  shirtShade: '#237878',
  pants: '#3f4bb0',
  pantsShade: '#323a8c',
  shoe: '#3a3a3a',
  eye: '#f4f4f4',
  pupil: '#3b3bb0',
  mouth: '#8a5a44',
};

const ARMOR_TINT = {
  leather: 'rgba(150,96,58,0.85)',
  iron: 'rgba(216,216,216,0.8)',
  golden: 'rgba(244,206,92,0.85)',
  diamond: 'rgba(94,231,216,0.8)',
};

function armorTint(name) {
  if (!name) return null;
  const set = name.split('_')[0];
  return ARMOR_TINT[set] ?? 'rgba(200,200,200,0.75)';
}

/**
 * The paper doll in the inventory's viewport. Built from flat cuboid faces in
 * Minecraft's 1/16 model units (a 32-unit-tall player) so it reads as the same
 * blocky figure the world renderer draws, and it tracks the cursor like vanilla.
 */
export function drawPlayerDoll(ctx, x, y, w, h, player, mx, my, time) {
  drawInset(ctx, x, y, w, h);
  const s = 2;                                   // GUI pixels per model unit
  const cx = x + Math.round(w / 2);
  const feet = y + h - 3;
  const look = clamp((mx - cx) / 40, -1.2, 1.2);
  const tilt = clamp((my - (y + 18)) / 46, -1, 1);
  const breath = Math.sin(time * 1.7) * 0.35;

  const put = (ux, uy, uw, uh, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(cx + ux * s),
      Math.round(feet - (uy + uh) * s),
      Math.max(1, Math.round(uw * s)),
      Math.max(1, Math.round(uh * s)),
    );
  };

  // legs
  put(-4, 0, 4, 2, DOLL.shoe);
  put(0, 0, 4, 2, DOLL.shoe);
  put(-4, 2, 4, 10, DOLL.pants);
  put(0, 2, 4, 10, DOLL.pantsShade);
  // torso
  put(-4, 12, 8, 12, DOLL.shirt);
  put(2, 12, 2, 12, DOLL.shirtShade);
  // arms, hands bare at the wrist
  put(-8, 14 + breath, 4, 10, DOLL.shirt);
  put(-8, 12 + breath, 4, 2, DOLL.face);
  put(4, 14 - breath, 4, 10, DOLL.shirtShade);
  put(4, 12 - breath, 4, 2, DOLL.faceShade);

  // head, leaning toward the pointer
  const hx = -4 + look * 1.2;
  const hy = 24 - tilt * 0.5;
  put(hx, hy, 8, 8, DOLL.face);
  put(hx + 6, hy, 2, 8, DOLL.faceShade);
  put(hx, hy + 5, 8, 3, DOLL.hair);
  const gaze = look >= 0 ? 1 : 0;
  put(hx + 1, hy + 3, 2, 1, DOLL.eye);
  put(hx + 5, hy + 3, 2, 1, DOLL.eye);
  put(hx + 1 + gaze, hy + 3, 1, 1, DOLL.pupil);
  put(hx + 5 + gaze, hy + 3, 1, 1, DOLL.pupil);
  put(hx + 3, hy + 1, 2, 1, DOLL.mouth);

  // worn armour, as a tinted shell over the parts it covers
  const worn = player?.inventory?.armor;
  if (!worn) return;
  const [helmet, chest, legs, boots] = worn;
  if (!helmet.isEmpty) put(hx, hy + 4, 8, 4, armorTint(helmet.name));
  if (!chest.isEmpty) {
    const tint = armorTint(chest.name);
    put(-4, 13, 8, 11, tint);
    put(-8, 19, 4, 5, tint);
    put(4, 19, 4, 5, tint);
  }
  if (!legs.isEmpty) {
    const tint = armorTint(legs.name);
    put(-4, 7, 8, 6, tint);
  }
  if (!boots.isEmpty) {
    const tint = armorTint(boots.name);
    put(-4, 0, 4, 4, tint);
    put(0, 0, 4, 4, tint);
  }
}

// ------------------------------------------------------------------ the screen

export class InventoryScreen extends ContainerScreen {
  constructor(game) {
    super(game, { panelW: 176, panelH: 166, title: '' });
    this.craft = new Inventory(4);
    this.craftW = 2;
    this.result = new Inventory(1);
    this._unsubs.push(this.craft.onChange(() => this.refreshRecipe()));
    this.refreshRecipe();
  }

  buildSlots() {
    const inv = this.inv;
    if (inv) {
      for (let i = 0; i < 4; i++) {
        this.addSlot(new Slot(inv, ARMOR_START + i, 8, 8 + i * SLOT, {
          kind: SlotKind.ARMOR,
          group: 'armor',
          limit: 1,
          accepts: (s) => s.item?.armor?.slot === i,
        }));
      }
    }
    this.addGrid(this.craft, 0, 2, 2, 98, 18, { kind: SlotKind.CRAFT, group: 'craft' });
    this.addSlot(new Slot(this.result, 0, 154, 28, {
      kind: SlotKind.RESULT, group: 'result', takeOnly: true,
    }));
    this.addPlayerSlots(84, 142);
  }

  /** Shift-clicking a piece of armour puts it straight on, as vanilla does. */
  quickMove(slot) {
    if (slot.group === 'main' || slot.group === 'hotbar') {
      const inv = this.inv;
      const armorSlot = slot.stack.item?.armor?.slot;
      if (inv && armorSlot !== undefined && inv.get(ARMOR_START + armorSlot).isEmpty) {
        const piece = slot.stack.clone().split(1);
        this.takeFrom(slot, 1);
        inv.set(ARMOR_START + armorSlot, piece);
        return;
      }
    }
    super.quickMove(slot);
  }

  drawPanelContent(ctx, px, py, dt) {
    drawText(ctx, 'Crafting', 98, 8, { color: LABEL_COLOR, shadow: false });
    // Between the 2x2 grid (frames end at 134) and the result frame (starts at 153).
    drawArrow(ctx, 136, 30, 16, 13, 1, '#8b8b8b');
    drawPlayerDoll(ctx, 26, 8, 50, 71, this.player, px, py, this.time);
  }
}
