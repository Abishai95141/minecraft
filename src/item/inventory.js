// Item stacks and the containers that hold them: a generic Inventory used by
// chests, furnaces and crafting grids, plus the 41-slot PlayerInventory
// (hotbar, main, armour, offhand) that the HUD and container screens read.

import { ITEMS, itemForBlock, ArmorSlot } from './items.js';

const HOTBAR_SIZE = 9;
const MAIN_END = 36;          // slots [0,36) are the player's carried grid
const ARMOR_START = 36;       // 36..39, helmet -> boots
const OFFHAND = 40;
const PLAYER_SLOTS = 41;

/**
 * A quantity of one item, optionally worn. Empty stacks carry a null name so
 * `isEmpty` is the single truth test everywhere else in the codebase.
 */
export class ItemStack {
  constructor(itemName = null, count = 1, damage = 0) {
    this.name = itemName || null;
    this.count = this.name ? Math.max(0, count | 0) : 0;
    this.damage = Math.max(0, damage | 0);
    if (this.count <= 0) { this.name = null; this.count = 0; this.damage = 0; }
  }

  get item() { return this.name ? ITEMS[this.name] || null : null; }
  get isEmpty() { return this.name === null || this.count <= 0; }
  get maxStack() { const it = this.item; return it ? it.maxStack : 64; }
  get maxDamage() { const it = this.item; return it ? it.durability : 0; }
  get displayName() { const it = this.item; return it ? it.display : ''; }
  /** Free room in this stack, used by the merge passes below. */
  get spaceLeft() { return this.isEmpty ? 0 : Math.max(0, this.maxStack - this.count); }
  /** 1 = pristine, 0 = about to break. Indestructible items report 1. */
  get durabilityFraction() {
    const max = this.maxDamage;
    return max > 0 ? Math.max(0, (max - this.damage) / max) : 1;
  }

  /** Always a fresh object, so callers cloning EMPTY get one they own. */
  clone() { return new ItemStack(this.name, this.count, this.damage); }

  /** Same item and same wear — the test slot merging and recipes both need. */
  equalsIgnoreCount(other) {
    if (!other) return false;
    if (this.isEmpty || other.isEmpty) return this.isEmpty && other.isEmpty;
    return this.name === other.name && this.damage === other.damage;
  }

  canStackWith(other) {
    if (!other || this.isEmpty || other.isEmpty) return false;
    if (this.name !== other.name || this.maxStack <= 1) return false;
    return this.damage === other.damage;
  }

  /** Takes up to `n` off this stack into a new one (right-click half, drag). */
  split(n) {
    if (this.isEmpty || n <= 0) return ItemStack.EMPTY;
    const taken = Math.min(n | 0, this.count);
    const out = new ItemStack(this.name, taken, this.damage);
    this.shrink(taken);
    return out;
  }

  grow(n) {
    if (!this.isEmpty) this.count += n | 0;
    return this;
  }

  shrink(n) {
    if (this.isEmpty) return this;
    this.count -= n | 0;
    if (this.count <= 0) { this.count = 0; this.name = null; this.damage = 0; }
    return this;
  }

  /**
   * Wear the item by `n` points. Returns true when it broke — the stack has
   * already emptied itself by then, so the caller only plays the break sound.
   */
  damageBy(n) {
    const max = this.maxDamage;
    if (this.isEmpty || max <= 0) return false;
    this.damage += Math.max(0, n | 0);
    if (this.damage >= max) {
      this.name = null; this.count = 0; this.damage = 0;
      return true;
    }
    return false;
  }

  toJSON() {
    if (this.isEmpty) return null;
    return this.damage > 0
      ? { n: this.name, c: this.count, d: this.damage }
      : { n: this.name, c: this.count };
  }

  static fromJSON(o) {
    if (!o || !o.n) return ItemStack.EMPTY;
    return new ItemStack(o.n, o.c ?? 1, o.d ?? 0);
  }
}

// A shared empty singleton so slot arrays never hold null. Every mutator above
// short-circuits on `isEmpty`, so handing it out is safe.
ItemStack.EMPTY = new ItemStack(null, 0, 0);

/** A fixed run of slots with change notification. */
export class Inventory {
  constructor(size) {
    this._slots = new Array(Math.max(0, size | 0)).fill(ItemStack.EMPTY);
    this._listeners = [];
    /** Bumped on every mutation so screens can cheaply detect staleness. */
    this.version = 0;
  }

  get size() { return this._slots.length; }

  get(i) { return i >= 0 && i < this._slots.length ? this._slots[i] : ItemStack.EMPTY; }

  set(i, stack) {
    if (i < 0 || i >= this._slots.length) return;
    this._slots[i] = stack && !stack.isEmpty ? stack : ItemStack.EMPTY;
    this.changed(i);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  /** Fire the listeners. `slot` is -1 for a change that touched several. */
  changed(slot = -1) {
    this.version++;
    for (const fn of this._listeners) fn(this, slot);
  }

  /**
   * Merge `stack` in, topping up matching partial stacks before claiming empty
   * slots. Mutates `stack` and returns it, so the return value is the
   * remainder that did not fit (empty when everything went in).
   */
  add(stack) { return this.addRange(stack, 0, this._slots.length); }

  /** `add` restricted to slots [from, to) — the hotbar/main split uses this. */
  addRange(stack, from, to) {
    if (!stack || stack.isEmpty) return stack || ItemStack.EMPTY;
    const lo = Math.max(0, from | 0);
    const hi = Math.min(this._slots.length, to | 0);
    let touched = false;

    for (let i = lo; i < hi && !stack.isEmpty; i++) {
      const cur = this._slots[i];
      if (!cur.canStackWith(stack)) continue;
      const room = Math.min(cur.spaceLeft, stack.count);
      if (room <= 0) continue;
      cur.grow(room);
      stack.shrink(room);
      touched = true;
    }
    for (let i = lo; i < hi && !stack.isEmpty; i++) {
      if (!this._slots[i].isEmpty) continue;
      const take = Math.min(stack.maxStack, stack.count);
      this._slots[i] = new ItemStack(stack.name, take, stack.damage);
      stack.shrink(take);
      touched = true;
    }
    if (touched) this.changed();
    return stack;
  }

  remove(i, count) {
    const cur = this.get(i);
    if (cur.isEmpty) return ItemStack.EMPTY;
    const out = cur.split(count);
    if (cur.isEmpty) this._slots[i] = ItemStack.EMPTY;
    this.changed(i);
    return out;
  }

  countOf(itemName) {
    let n = 0;
    for (const s of this._slots) if (!s.isEmpty && s.name === itemName) n += s.count;
    return n;
  }

  hasItems(itemName, n = 1) { return this.countOf(itemName) >= n; }

  /** All-or-nothing withdrawal — quests and crafting rely on that. */
  consume(itemName, n = 1) {
    if (n <= 0) return true;
    if (!this.hasItems(itemName, n)) return false;
    let left = n;
    for (let i = 0; i < this._slots.length && left > 0; i++) {
      const s = this._slots[i];
      if (s.isEmpty || s.name !== itemName) continue;
      const take = Math.min(left, s.count);
      s.shrink(take);
      left -= take;
      if (s.isEmpty) this._slots[i] = ItemStack.EMPTY;
    }
    this.changed();
    return true;
  }

  firstEmpty() {
    for (let i = 0; i < this._slots.length; i++) if (this._slots[i].isEmpty) return i;
    return -1;
  }

  find(itemName) {
    for (let i = 0; i < this._slots.length; i++) {
      const s = this._slots[i];
      if (!s.isEmpty && s.name === itemName) return i;
    }
    return -1;
  }

  clear() {
    for (let i = 0; i < this._slots.length; i++) this._slots[i] = ItemStack.EMPTY;
    this.changed();
  }

  /** Every non-empty stack, for death drops and container transfers. */
  contents() { return this._slots.filter((s) => !s.isEmpty); }

  toJSON() { return { size: this._slots.length, slots: this._slots.map((s) => s.toJSON()) }; }

  fromJSON(o) {
    const arr = Array.isArray(o) ? o : (o && o.slots) || [];
    for (let i = 0; i < this._slots.length; i++) {
      this._slots[i] = i < arr.length ? ItemStack.fromJSON(arr[i]) : ItemStack.EMPTY;
    }
    this.changed();
    return this;
  }
}

/**
 * 0-8 hotbar, 9-35 main, 36-39 armour (helmet..boots), 40 offhand. The hotbar
 * sits at the front of the slot array on purpose: every scan walks it first, so
 * a new stack lands within reach without any special-casing.
 */
export class PlayerInventory extends Inventory {
  constructor() {
    super(PLAYER_SLOTS);
    this.selected = 0;
  }

  get held() { return this.get(this.selected); }
  get offhand() { return this.get(OFFHAND); }

  get armor() {
    return [
      this.get(ARMOR_START + ArmorSlot.HELMET),
      this.get(ARMOR_START + ArmorSlot.CHESTPLATE),
      this.get(ARMOR_START + ArmorSlot.LEGGINGS),
      this.get(ARMOR_START + ArmorSlot.BOOTS),
    ];
  }

  armorPoints() {
    let p = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const it = this.get(i).item;
      if (it?.armor) p += it.armor.points;
    }
    return p;
  }

  /** Wear every worn piece; anything that breaks simply vanishes, as in vanilla. */
  damageArmor(n) {
    let broke = false;
    let worn = false;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = this._slots[i];
      if (s.isEmpty) continue;
      if (s.damageBy(n)) { this._slots[i] = ItemStack.EMPTY; broke = true; }
      worn = true;
    }
    if (worn) this.changed();
    return broke;
  }

  /**
   * Pickups only ever reach the carried grid, never the armour or offhand
   * slots. Because the hotbar occupies slots 0-8 it is scanned first in both
   * the top-up and the claim-an-empty-slot pass, exactly as in vanilla.
   */
  add(stack) { return this.addRange(stack, 0, MAIN_END); }

  /**
   * Stricter than `add`: the hotbar is filled to exhaustion before the main
   * grid is touched at all, so a handed-over quest reward ends up in reach.
   */
  addToHotbarFirst(stack) {
    if (!stack || stack.isEmpty) return stack || ItemStack.EMPTY;
    this.addRange(stack, 0, HOTBAR_SIZE);
    if (stack.isEmpty) return stack;
    return this.addRange(stack, HOTBAR_SIZE, MAIN_END);
  }

  /**
   * Middle-click: put the item for `blockId` in hand if the player already has
   * one, swapping it out of the main grid when needed. In creative the block is
   * conjured instead; in survival an item they do not own returns false.
   */
  pickBlock(blockId, creative = false) {
    const it = itemForBlock(blockId);
    if (!it) return false;
    if (this.held.name === it.name) return true;

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this._slots[i].name === it.name) {
        this.selected = i;
        this.changed(i);
        return true;
      }
    }
    for (let i = HOTBAR_SIZE; i < MAIN_END; i++) {
      if (this._slots[i].name !== it.name) continue;
      const tmp = this._slots[this.selected];
      this._slots[this.selected] = this._slots[i];
      this._slots[i] = tmp;
      this.changed();
      return true;
    }
    if (!creative) return false;

    // Prefer a free hotbar slot so nothing the player was holding is lost.
    let target = -1;
    for (let i = 0; i < HOTBAR_SIZE && target < 0; i++) if (this._slots[i].isEmpty) target = i;
    if (target < 0) target = this.selected;
    this._slots[target] = new ItemStack(it.name, 1);
    this.selected = target;
    this.changed(target);
    return true;
  }

  toJSON() {
    const o = super.toJSON();
    o.selected = this.selected;
    return o;
  }

  fromJSON(o) {
    super.fromJSON(o);
    if (o && typeof o.selected === 'number') {
      this.selected = Math.min(HOTBAR_SIZE - 1, Math.max(0, o.selected | 0));
    }
    return this;
  }
}
