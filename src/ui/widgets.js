// The GUI widget kit: the 200x20 button and its relatives, plus the panel,
// slot and background painters every screen shares. Everything works in GUI
// pixels — the 2D context is already scaled by guiScale before render() runs.

import { drawText, measureFormatted } from './font.js';
import { settings, OPTION_DEFS, keyName } from '../core/settings.js';
import { atlas } from '../render/atlas.js';
import { clamp } from '../core/math.js';

export const BUTTON_W = 200;
export const BUTTON_H = 20;

const TEXT_NORMAL = 0xffffff;
const TEXT_HOVER = 0xffffa0;
const TEXT_DISABLED = 0xa0a0a0;
const TEXT_CONFLICT = 0xff5555;

/**
 * Widget faces. Vanilla's button is a vertical grey-blue gradient with a black
 * outline, a lighter top edge and a darker bottom edge; hover brightens the
 * whole face and disabled goes flat.
 */
const STYLES = {
  button: { outline: '#000000', top: '#6b6b6b', bottom: '#565656', light: 'rgba(255,255,255,0.18)', shade: 'rgba(0,0,0,0.30)' },
  hover: { outline: '#000000', top: '#8d8d8d', bottom: '#6e6e6e', light: 'rgba(255,255,255,0.28)', shade: 'rgba(0,0,0,0.26)' },
  pressed: { outline: '#000000', top: '#4f4f4f', bottom: '#606060', light: 'rgba(0,0,0,0.25)', shade: 'rgba(255,255,255,0.12)' },
  disabled: { outline: '#000000', top: '#4a4a4a', bottom: '#4a4a4a', light: 'rgba(255,255,255,0.06)', shade: 'rgba(0,0,0,0.18)' },
  track: { outline: '#000000', top: '#2c2c2c', bottom: '#1d1d1d', light: 'rgba(255,255,255,0.05)', shade: 'rgba(0,0,0,0.35)' },
  field: { outline: '#000000', top: '#0e0e0e', bottom: '#0a0a0a', light: 'rgba(255,255,255,0.10)', shade: 'rgba(0,0,0,0.30)' },
  header: { outline: '#000000', top: '#3a3a3a', bottom: '#2e2e2e', light: 'rgba(255,255,255,0.10)', shade: 'rgba(0,0,0,0.25)' },
};

/** Border drawn as four edges so the corner pixels stay transparent — that
 *  1px nibble out of each corner is what makes the button read as rounded. */
function edgeOutline(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y, w - 2, 1);
  ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillRect(x, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/** Nine-sliced widget face. `style` is a STYLES key or a style object. */
export function drawNinePatch(ctx, style, x, y, w, h) {
  const s = typeof style === 'string' ? (STYLES[style] || STYLES.button) : style;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 2 || h < 2) return;

  edgeOutline(ctx, s.outline, x, y, w, h);

  const grad = ctx.createLinearGradient(0, y + 1, 0, y + h - 1);
  grad.addColorStop(0, s.top);
  grad.addColorStop(1, s.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

  ctx.fillStyle = s.light;
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x + 1, y + 2, 1, h - 4);
  ctx.fillStyle = s.shade;
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
}

/** The vanilla GUI window frame: light face, white top-left, dark bottom-right. */
export function drawPanel(ctx, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  edgeOutline(ctx, '#000000', x, y, w, h);
  ctx.fillStyle = '#c6c6c6';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 1, y + 1, w - 3, 2);
  ctx.fillRect(x + 1, y + 1, 2, h - 3);
  ctx.fillStyle = '#555555';
  ctx.fillRect(x + 2, y + h - 3, w - 3, 2);
  ctx.fillRect(x + w - 3, y + 2, 2, h - 3);
}

/** An 18x18 inventory slot, sunk into the panel. */
export function drawSlot(ctx, x, y) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#8b8b8b';
  ctx.fillRect(x, y, 18, 18);
  ctx.fillStyle = '#373737';
  ctx.fillRect(x, y, 18, 1);
  ctx.fillRect(x, y, 1, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 1, y + 17, 17, 1);
  ctx.fillRect(x + 17, y + 1, 1, 17);
}

// ------------------------------------------------------------------ backgrounds

let dirtTile = null;
let dirtTileSize = 0;

/** One prebuilt canvas holding 8x8 darkened dirt tiles, so a full-screen
 *  background costs a handful of blits instead of hundreds. */
function dirtTileSheet(tile) {
  if (dirtTile && dirtTileSize === tile) return dirtTile;
  const REPEAT = 8;
  const c = document.createElement('canvas');
  c.width = c.height = tile * REPEAT;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const src = atlas.canvasOf('dirt');
  if (src) {
    for (let ty = 0; ty < REPEAT; ty++) {
      for (let tx = 0; tx < REPEAT; tx++) g.drawImage(src, tx * tile, ty * tile, tile, tile);
    }
  } else {
    // The atlas has not been built yet (very first frame) — a flat dirt brown
    // keeps the menu readable instead of showing a hole.
    g.fillStyle = '#96683f';
    g.fillRect(0, 0, c.width, c.height);
  }
  // Vanilla multiplies the menu background by 0.25.
  g.fillStyle = 'rgba(0,0,0,0.75)';
  g.fillRect(0, 0, c.width, c.height);
  dirtTile = c;
  dirtTileSize = tile;
  return c;
}

/** Tiled, darkened dirt — the out-of-game menu background. */
export function drawDirtBackground(ctx, w, h, scale = 32) {
  const tile = Math.max(4, Math.round(scale));
  const sheet = dirtTileSheet(tile);
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y += sheet.height) {
    for (let x = 0; x < w; x += sheet.width) ctx.drawImage(sheet, x, y);
  }
}

/** The in-game dim: ARGB 0xC0101010 at the top to 0xD0101010 at the bottom. */
export function drawGradientOverlay(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(16,16,16,0.753)');
  g.addColorStop(1, 'rgba(16,16,16,0.816)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Trims a label to fit, appending an ellipsis. Used by every text widget. */
function fitLabel(text, maxWidth) {
  let s = String(text);
  if (maxWidth <= 0 || measureFormatted(s) <= maxWidth) return s;
  while (s.length > 1 && measureFormatted(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

// ------------------------------------------------------------------ widgets

export class Widget {
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.w = opts.w ?? BUTTON_W;
    this.h = opts.h ?? BUTTON_H;
    this.enabled = opts.enabled !== false;
    this.visible = opts.visible !== false;
    this.focused = false;
    this.tooltip = opts.tooltip ?? null;
    this.id = opts.id ?? '';
    /** Set by `Screen.add`, so widgets can reach the game for sounds. */
    this.screen = null;
  }

  contains(mx, my) {
    return this.visible && mx >= this.x && mx < this.x + this.w && my >= this.y && my < this.y + this.h;
  }

  hoveredAt(mx, my) { return this.enabled && this.contains(mx, my); }

  playClick() { this.screen?.game?.playSound?.('click', { volume: 0.4 }); }

  render(ctx, mx, my, dt) {}
  mouseDown(x, y, button) { return false; }
  mouseUp(x, y, button) { return false; }
  mouseDrag(x, y) {}
  wheel(delta, mx, my) { return false; }
  keyDown(code, e) { return false; }
  charTyped(ch) { return false; }
  tick() {}
  onFocus(on) { this.focused = on; }
}

export class Button extends Widget {
  constructor(opts = {}) {
    super({ w: BUTTON_W, h: BUTTON_H, ...opts });
    this.text = opts.text ?? '';
    this.onClick = opts.onClick ?? null;
    this.color = opts.color ?? null;
    this.pressed = false;
  }

  get label() { return typeof this.text === 'function' ? String(this.text()) : String(this.text); }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    const hovered = this.hoveredAt(mx, my);
    const style = !this.enabled ? 'disabled' : this.pressed ? 'pressed' : hovered ? 'hover' : 'button';
    drawNinePatch(ctx, style, this.x, this.y, this.w, this.h);
    const color = !this.enabled ? TEXT_DISABLED : hovered ? TEXT_HOVER : (this.color ?? TEXT_NORMAL);
    drawText(ctx, fitLabel(this.label, this.w - 8), this.x + this.w / 2, this.y + (this.h - 8) / 2,
      { color, shadow: true, align: 'center' });
  }

  mouseDown(x, y, button) {
    if (button !== 0 || !this.enabled) return false;
    this.pressed = true;
    this.playClick();
    this.onClick?.(this);
    return true;
  }

  mouseUp(x, y, button) { this.pressed = false; return false; }

  keyDown(code) {
    if (!this.focused || !this.enabled) return false;
    if (code !== 'Enter' && code !== 'Space' && code !== 'NumpadEnter') return false;
    this.playClick();
    this.onClick?.(this);
    return true;
  }
}

export class Slider extends Widget {
  constructor(opts = {}) {
    super({ w: 150, h: BUTTON_H, ...opts });
    this.optionKey = opts.optionKey ?? null;
    const def = this.optionKey ? OPTION_DEFS[this.optionKey] : null;
    this.min = opts.min ?? def?.min ?? 0;
    this.max = opts.max ?? def?.max ?? 1;
    this.step = opts.step ?? def?.step ?? 0.01;
    this.label = opts.label ?? def?.label ?? '';
    this.format = opts.format ?? def?.format ?? null;
    this.tooltip = opts.tooltip ?? def?.tooltip ?? null;
    this.onChange = opts.onChange ?? null;
    this._value = this.optionKey ? settings.get(this.optionKey) : (opts.value ?? this.min);
    this.dragging = false;
  }

  get value() { return this.optionKey ? settings.get(this.optionKey) : this._value; }
  get fraction() { return this.max > this.min ? clamp((this.value - this.min) / (this.max - this.min), 0, 1) : 0; }

  setValue(v) {
    const steps = Math.round((v - this.min) / this.step);
    // Snapping through the step index keeps 0.01-step sliders off floating dust.
    const snapped = Math.round((this.min + steps * this.step) * 1e6) / 1e6;
    const next = clamp(snapped, this.min, this.max);
    if (next === this.value) return;
    if (this.optionKey) settings.set(this.optionKey, next);
    else this._value = next;
    this.onChange?.(next, this);
  }

  setFromMouse(x) {
    const t = clamp((x - this.x - 4) / Math.max(1, this.w - 8), 0, 1);
    this.setValue(this.min + t * (this.max - this.min));
  }

  labelText() {
    if (this.optionKey) return settings.buttonLabel(this.optionKey);
    const shown = this.format ? this.format(this.value) : String(this.value);
    return this.label ? `${this.label}: ${shown}` : shown;
  }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    const hovered = this.hoveredAt(mx, my) || this.dragging;
    drawNinePatch(ctx, 'track', this.x, this.y, this.w, this.h);
    const hx = Math.round(this.x + 1 + this.fraction * (this.w - 10));
    drawNinePatch(ctx, this.enabled ? (hovered ? 'hover' : 'button') : 'disabled', hx, this.y + 1, 8, this.h - 2);
    const color = this.enabled ? (hovered ? TEXT_HOVER : TEXT_NORMAL) : TEXT_DISABLED;
    drawText(ctx, fitLabel(this.labelText(), this.w - 10), this.x + this.w / 2, this.y + (this.h - 8) / 2,
      { color, shadow: true, align: 'center' });
  }

  mouseDown(x, y, button) {
    if (button !== 0 || !this.enabled) return false;
    this.dragging = true;
    this.setFromMouse(x);
    return true;
  }

  mouseDrag(x, y) { if (this.dragging) this.setFromMouse(x); }
  mouseUp(x, y, button) { const was = this.dragging; this.dragging = false; return was; }

  wheel(delta, mx, my) {
    if (!this.enabled || !this.contains(mx, my)) return false;
    this.setValue(this.value - delta * this.step);
    return true;
  }

  keyDown(code) {
    if (!this.focused || !this.enabled) return false;
    if (code === 'ArrowLeft') { this.setValue(this.value - this.step); return true; }
    if (code === 'ArrowRight') { this.setValue(this.value + this.step); return true; }
    return false;
  }
}

/** A settings-backed button that steps through OPTION_DEFS values on click. */
export class CycleButton extends Widget {
  constructor(opts = {}) {
    super({ w: 150, h: BUTTON_H, ...opts });
    this.optionKey = opts.optionKey ?? null;
    const def = this.optionKey ? OPTION_DEFS[this.optionKey] : null;
    this.tooltip = opts.tooltip ?? def?.tooltip ?? null;
    this.onChange = opts.onChange ?? null;
    this.pressed = false;
  }

  labelText() {
    return this.optionKey ? settings.buttonLabel(this.optionKey) : '';
  }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    const hovered = this.hoveredAt(mx, my);
    const style = !this.enabled ? 'disabled' : this.pressed ? 'pressed' : hovered ? 'hover' : 'button';
    drawNinePatch(ctx, style, this.x, this.y, this.w, this.h);
    const color = !this.enabled ? TEXT_DISABLED : hovered ? TEXT_HOVER : TEXT_NORMAL;
    drawText(ctx, fitLabel(this.labelText(), this.w - 8), this.x + this.w / 2, this.y + (this.h - 8) / 2,
      { color, shadow: true, align: 'center' });
  }

  step(dir) {
    if (!this.optionKey || !this.enabled) return;
    this.playClick();
    const v = settings.cycle(this.optionKey, dir);
    this.onChange?.(v, this);
  }

  mouseDown(x, y, button) {
    if (!this.enabled || (button !== 0 && button !== 2)) return false;
    this.pressed = true;
    this.step(button === 2 ? -1 : 1);
    return true;
  }

  mouseUp(x, y, button) { this.pressed = false; return false; }

  keyDown(code) {
    if (!this.focused || !this.enabled) return false;
    if (code === 'Enter' || code === 'Space' || code === 'ArrowRight') { this.step(1); return true; }
    if (code === 'ArrowLeft') { this.step(-1); return true; }
    return false;
  }
}

/** ON/OFF options. `settings.cycle` already flips TOGGLE kinds. */
export class ToggleButton extends CycleButton {
  mouseDown(x, y, button) {
    if (!this.enabled || button !== 0) return false;
    this.pressed = true;
    this.step(1);
    return true;
  }
}

export class TextField extends Widget {
  constructor(opts = {}) {
    super({ w: BUTTON_W, h: BUTTON_H, ...opts });
    this.value = String(opts.value ?? '');
    this.placeholder = opts.placeholder ?? '';
    this.label = opts.label ?? '';
    this.maxLength = opts.maxLength ?? 32;
    this.filter = opts.filter ?? null;
    this.onChange = opts.onChange ?? null;
    this.onSubmit = opts.onSubmit ?? null;
    this.cursor = this.value.length;
    this.blink = 0;
  }

  setValue(v) {
    const s = String(v).slice(0, this.maxLength);
    if (s === this.value) return;
    this.value = s;
    this.cursor = clamp(this.cursor, 0, this.value.length);
    this.onChange?.(this.value, this);
  }

  tick() { this.blink = (this.blink + 1) % 20; }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    if (this.label) {
      drawText(ctx, this.label, this.x, this.y - 11, { color: 0xa0a0a0, shadow: true });
    }
    drawNinePatch(ctx, this.focused ? 'header' : 'field', this.x, this.y, this.w, this.h);
    const ty = this.y + (this.h - 8) / 2;
    const inner = this.w - 10;
    if (!this.value && this.placeholder) {
      drawText(ctx, fitLabel(this.placeholder, inner), this.x + 5, ty, { color: 0x6b6b6b, shadow: true });
    } else {
      const shown = fitLabel(this.value, inner);
      drawText(ctx, shown, this.x + 5, ty, { color: this.enabled ? 0xe0e0e0 : TEXT_DISABLED, shadow: true });
      if (this.focused && this.blink < 10) {
        const cx = this.x + 5 + measureFormatted(shown.slice(0, this.cursor));
        ctx.fillStyle = '#d0d0d0';
        ctx.fillRect(Math.round(Math.min(cx, this.x + this.w - 6)), ty - 1, 1, 10);
      }
    }
  }

  mouseDown(x, y, button) {
    if (!this.enabled || button !== 0) return false;
    // Put the caret where the click landed, measuring prefix by prefix.
    let best = 0;
    for (let i = 0; i <= this.value.length; i++) {
      if (this.x + 5 + measureFormatted(this.value.slice(0, i)) <= x) best = i;
    }
    this.cursor = best;
    this.blink = 0;
    return true;
  }

  charTyped(ch) {
    if (!this.enabled || !this.focused) return false;
    if (ch.length !== 1 || ch < ' ') return false;
    if (this.filter && !this.filter(ch)) return false;
    if (this.value.length >= this.maxLength) return true;
    this.setValue(this.value.slice(0, this.cursor) + ch + this.value.slice(this.cursor));
    this.cursor++;
    this.blink = 0;
    return true;
  }

  keyDown(code, e) {
    if (!this.enabled || !this.focused) return false;
    switch (code) {
      case 'Backspace':
        if (this.cursor > 0) {
          this.setValue(this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor));
          this.cursor--;
        }
        return true;
      case 'Delete':
        if (this.cursor < this.value.length) {
          this.setValue(this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1));
        }
        return true;
      case 'ArrowLeft': this.cursor = Math.max(0, this.cursor - 1); this.blink = 0; return true;
      case 'ArrowRight': this.cursor = Math.min(this.value.length, this.cursor + 1); this.blink = 0; return true;
      case 'Home': this.cursor = 0; return true;
      case 'End': this.cursor = this.value.length; return true;
      case 'Enter':
      case 'NumpadEnter': this.onSubmit?.(this.value, this); return true;
      default: return false;
    }
  }
}

/** A clipped, scrollable region. `renderContent(ctx, scroll, mx, my, dt)` draws
 *  in screen space and offsets itself by `scroll`. */
export class ScrollPanel extends Widget {
  constructor(opts = {}) {
    super({ w: BUTTON_W, h: 100, ...opts });
    this.scroll = 0;
    this.contentHeight = opts.contentHeight ?? 0;
    this.renderContent = opts.renderContent ?? null;
    this.scrollStep = opts.scrollStep ?? 12;
    this.darkBackground = opts.darkBackground !== false;
    this.barWidth = 6;
    this._dragBar = false;
  }

  get maxScroll() { return Math.max(0, this.contentHeight - this.h); }

  clampScroll() { this.scroll = clamp(this.scroll, 0, this.maxScroll); }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    this.clampScroll();
    if (this.darkBackground) {
      // The list interior is the dirt background at 0.125 brightness.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x, this.y, this.w, this.h);
    ctx.clip();
    this.renderContent?.(ctx, this.scroll, mx, my, dt);
    ctx.restore();
    this.renderEdges(ctx);
    this.renderScrollbar(ctx);
  }

  /** 4px black fades top and bottom, so content reads as running under the edge. */
  renderEdges(ctx) {
    const top = ctx.createLinearGradient(0, this.y, 0, this.y + 4);
    top.addColorStop(0, 'rgba(0,0,0,0.85)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(this.x, this.y, this.w, 4);
    const bot = ctx.createLinearGradient(0, this.y + this.h - 4, 0, this.y + this.h);
    bot.addColorStop(0, 'rgba(0,0,0,0)');
    bot.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = bot;
    ctx.fillRect(this.x, this.y + this.h - 4, this.w, 4);
  }

  get barRect() {
    const max = this.maxScroll;
    if (max <= 0) return null;
    const bx = this.x + this.w - this.barWidth;
    const bh = Math.max(12, Math.round((this.h * this.h) / Math.max(1, this.contentHeight)));
    const by = this.y + Math.round((this.scroll / max) * (this.h - bh));
    return { x: bx, y: by, w: this.barWidth, h: bh };
  }

  renderScrollbar(ctx) {
    const bar = this.barRect;
    if (!bar) return;
    ctx.fillStyle = '#000000';
    ctx.fillRect(bar.x, this.y, this.barWidth, this.h);
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = '#c6c6c6';
    ctx.fillRect(bar.x, bar.y, bar.w - 1, bar.h - 1);
  }

  wheel(delta, mx, my) {
    if (!this.contains(mx, my)) return false;
    this.scroll = clamp(this.scroll + delta * this.scrollStep, 0, this.maxScroll);
    return true;
  }

  mouseDown(x, y, button) {
    if (button !== 0 || !this.enabled) return false;
    const bar = this.barRect;
    if (bar && x >= bar.x) {
      this._dragBar = true;
      this.scrollTo(y - bar.h / 2);
      return true;
    }
    return false;
  }

  scrollTo(topY) {
    const bar = this.barRect;
    const bh = bar ? bar.h : 12;
    const t = clamp((topY - this.y) / Math.max(1, this.h - bh), 0, 1);
    this.scroll = t * this.maxScroll;
  }

  mouseDrag(x, y) { if (this._dragBar) this.scrollTo(y - 6); }
  mouseUp() { const was = this._dragBar; this._dragBar = false; return was; }
}

/** A selectable, scrollable list of arbitrary entries. */
export class ListWidget extends ScrollPanel {
  constructor(opts = {}) {
    super(opts);
    this.itemHeight = opts.itemHeight ?? 25;
    this.gap = opts.gap ?? 4;
    this.selected = opts.selected ?? -1;
    this.onSelect = opts.onSelect ?? null;
    this.onActivate = opts.onActivate ?? null;
    this.drawItem = opts.drawItem ?? null;
    this.emptyText = opts.emptyText ?? '';
    this.items = [];
    this._lastClickAt = -1e9;
    this._lastClickIndex = -1;
    this._age = 0;
    this.setItems(opts.items ?? []);
    this.renderContent = (ctx, scroll, mx, my, dt) => this.renderItems(ctx, scroll, mx, my, dt);
  }

  setItems(items) {
    this.items = items.slice();
    this.contentHeight = this.items.length * (this.itemHeight + this.gap);
    if (this.selected >= this.items.length) this.selected = this.items.length - 1;
    this.clampScroll();
  }

  get selectedItem() { return this.selected >= 0 ? this.items[this.selected] ?? null : null; }

  indexAt(x, y) {
    if (!this.contains(x, y)) return -1;
    const local = y - this.y + this.scroll;
    const i = Math.floor(local / (this.itemHeight + this.gap));
    if (i < 0 || i >= this.items.length) return -1;
    if (local - i * (this.itemHeight + this.gap) > this.itemHeight) return -1;
    return i;
  }

  renderItems(ctx, scroll, mx, my, dt) {
    this._age += dt || 0;
    if (!this.items.length && this.emptyText) {
      drawText(ctx, this.emptyText, this.x + this.w / 2, this.y + this.h / 2 - 4,
        { color: 0x9a9a9a, shadow: true, align: 'center' });
      return;
    }
    const hover = this.indexAt(mx, my);
    for (let i = 0; i < this.items.length; i++) {
      const iy = this.y - scroll + i * (this.itemHeight + this.gap);
      if (iy > this.y + this.h || iy + this.itemHeight < this.y) continue;
      const state = { index: i, hovered: hover === i, selected: this.selected === i };
      if (this.drawItem) {
        this.drawItem(ctx, this.items[i], this.x, iy, this.w - this.barWidth - 2, this.itemHeight, state);
      } else {
        drawNinePatch(ctx, state.selected ? 'hover' : 'header', this.x, iy, this.w - this.barWidth - 2, this.itemHeight);
        drawText(ctx, String(this.items[i]), this.x + 6, iy + (this.itemHeight - 8) / 2, { color: 0xffffff, shadow: true });
      }
    }
  }

  mouseDown(x, y, button) {
    if (super.mouseDown(x, y, button)) return true;
    if (button !== 0 || !this.enabled) return false;
    const i = this.indexAt(x, y);
    if (i < 0) return false;
    this.playClick();
    const doubled = i === this._lastClickIndex && this._age - this._lastClickAt < 0.4;
    this._lastClickIndex = i;
    this._lastClickAt = this._age;
    this.selected = i;
    this.onSelect?.(this.items[i], i);
    if (doubled) this.onActivate?.(this.items[i], i);
    return true;
  }

  keyDown(code) {
    if (!this.enabled || !this.items.length) return false;
    if (code === 'ArrowDown') { this.select(this.selected + 1); return true; }
    if (code === 'ArrowUp') { this.select(this.selected - 1); return true; }
    if (code === 'Enter' && this.selectedItem) { this.onActivate?.(this.selectedItem, this.selected); return true; }
    return false;
  }

  select(i) {
    this.selected = clamp(i, 0, this.items.length - 1);
    const iy = this.selected * (this.itemHeight + this.gap);
    if (iy < this.scroll) this.scroll = iy;
    else if (iy + this.itemHeight > this.scroll + this.h) this.scroll = iy + this.itemHeight - this.h;
    this.clampScroll();
    this.onSelect?.(this.selectedItem, this.selected);
  }
}

/** A key binding row's button. Rebinding is driven by the owning screen, which
 *  feeds it the next key or mouse button that arrives. */
export class KeyBindButton extends Widget {
  constructor(opts = {}) {
    super({ w: 75, h: BUTTON_H, ...opts });
    this.action = opts.action ?? '';
    this.onRebind = opts.onRebind ?? null;
    this.onBegin = opts.onBegin ?? null;
    this.listening = false;
  }

  get code() { return settings.bindings[this.action] ?? ''; }
  get conflicting() { return settings.isConflicting(this.action); }

  labelText() {
    if (this.listening) return `§f> §e${keyName(this.code)} §f<`;
    return keyName(this.code);
  }

  render(ctx, mx, my, dt) {
    if (!this.visible) return;
    const hovered = this.hoveredAt(mx, my);
    drawNinePatch(ctx, !this.enabled ? 'disabled' : this.listening ? 'pressed' : hovered ? 'hover' : 'button',
      this.x, this.y, this.w, this.h);
    let color = TEXT_NORMAL;
    if (!this.enabled) color = TEXT_DISABLED;
    else if (this.conflicting) color = TEXT_CONFLICT;
    else if (!this.code) color = TEXT_DISABLED;
    else if (hovered || this.listening) color = TEXT_HOVER;
    drawText(ctx, fitLabel(this.labelText(), this.w - 6), this.x + this.w / 2, this.y + (this.h - 8) / 2,
      { color, shadow: true, align: 'center' });
  }

  mouseDown(x, y, button) {
    if (!this.enabled) return false;
    if (this.listening) { this.apply(`Mouse${button}`); return true; }
    if (button !== 0) return false;
    this.playClick();
    this.listening = true;
    this.onBegin?.(this);
    return true;
  }

  /** '' unbinds, which is what Escape does while listening. */
  apply(code) {
    this.listening = false;
    if (code === '') settings.unbind(this.action);
    else settings.bind(this.action, code);
    this.playClick();
    this.onRebind?.(this.action, code, this);
  }
}
