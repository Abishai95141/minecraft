// Controls: the mouse options on top, then every key binding grouped by
// category in a scrolling list. Click a binding, press the next key to rebind;
// Escape while listening clears it. Conflicts are drawn in red.

import { Screen } from '../screen.js';
import { Button, KeyBindButton, BUTTON_H } from '../widgets.js';
import { drawText } from '../font.js';
import { settings, DEFAULT_BINDINGS, BINDING_CATEGORIES } from '../../core/settings.js';
import { clamp } from '../../core/math.js';

const LIST_W = 310;
const HEADER_H = 16;
const ROW_H = 22;
const KEY_W = 80;

export class ControlsScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Controls';
    this.pausesGame = true;
    this.scroll = 0;
    this.listening = null;
    this.bindButtons = [];
    this.rows = [];
    this.listX = 0;
    this.listY = 0;
    this.listW = LIST_W;
    this.listH = 0;
    this.contentHeight = 0;
  }

  /** Bindings in declaration order, grouped by BINDING_CATEGORIES. */
  buildRows() {
    const rows = [];
    const actions = Object.keys(DEFAULT_BINDINGS);
    const seen = new Set();
    const categories = [...BINDING_CATEGORIES];
    for (const a of actions) {
      const c = DEFAULT_BINDINGS[a].category;
      if (!categories.includes(c)) categories.push(c);
    }
    for (const cat of categories) {
      const inCat = actions.filter((a) => DEFAULT_BINDINGS[a].category === cat && !seen.has(a));
      if (!inCat.length) continue;
      rows.push({ type: 'header', label: cat, h: HEADER_H });
      for (const a of inCat) {
        seen.add(a);
        rows.push({ type: 'bind', action: a, label: DEFAULT_BINDINGS[a].label, h: ROW_H });
      }
    }
    return rows;
  }

  build(w, h) {
    const optionsBottom = this.addOptionRows(settings.optionsIn('controls'), { y: 30, rowPitch: 22 });

    this.listX = Math.round(w / 2 - this.listW / 2);
    this.listY = optionsBottom + 4;
    this.listH = Math.max(ROW_H * 2, h - this.listY - 32);

    this.rows = this.buildRows();
    this.bindButtons = [];
    let cy = 0;
    for (const row of this.rows) {
      row.contentY = cy;
      if (row.type === 'bind') {
        const btn = this.add(new KeyBindButton({
          x: this.listX + this.listW - KEY_W - 12, y: 0, w: KEY_W, h: BUTTON_H,
          action: row.action,
          onBegin: (b) => this.beginRebind(b),
          onRebind: () => { this.listening = null; },
        }));
        row.button = btn;
        this.bindButtons.push(btn);
      }
      cy += row.h;
    }
    this.contentHeight = cy;
    this.applyScroll();

    const colW = 150;
    this.add(new Button({
      x: Math.round(w / 2 - colW - 5), y: h - 27, w: colW, h: BUTTON_H, text: 'Reset Keys',
      tooltip: 'Puts every binding back to its default.',
      onClick: () => { settings.resetBindings(); this.listening = null; },
    }));
    this.add(new Button({
      x: Math.round(w / 2 + 5), y: h - 27, w: colW, h: BUTTON_H, text: 'Done',
      onClick: () => this.close(),
    }));
  }

  get maxScroll() { return Math.max(0, this.contentHeight - this.listH); }

  /** Moves the binding buttons with the scroll and hides the ones off-list, so
   *  hit-testing never lands on a row you cannot see. */
  applyScroll() {
    this.scroll = clamp(this.scroll, 0, this.maxScroll);
    for (const row of this.rows) {
      row.screenY = this.listY + row.contentY - this.scroll;
      if (!row.button) continue;
      row.button.y = Math.round(row.screenY + (row.h - BUTTON_H) / 2);
      row.button.visible = row.button.y + BUTTON_H > this.listY && row.button.y < this.listY + this.listH;
    }
  }

  beginRebind(button) {
    for (const b of this.bindButtons) if (b !== button) b.listening = false;
    this.listening = button;
  }

  // ---------------------------------------------------------------- drawing

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    const w = this.width, h = this.height;
    this.mouseX = mx;
    this.mouseY = my;
    this._active?.mouseDrag(mx, my);
    this._tooltip = null;
    this.applyScroll();

    this.renderBackground(ctx, w, h);
    this.renderTitle(ctx, 15);

    // Everything outside the scrolling list.
    for (const wg of this.widgets) {
      if (!wg.visible || this.bindButtons.includes(wg)) continue;
      wg.render(ctx, mx, my, dt);
      if (wg.tooltip && wg.enabled && wg.contains(mx, my)) this._tooltip = wg.tooltip;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(this.listX, this.listY, this.listW, this.listH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.listX, this.listY, this.listW, this.listH);
    ctx.clip();
    for (const row of this.rows) {
      if (row.screenY + row.h < this.listY || row.screenY > this.listY + this.listH) continue;
      if (row.type === 'header') {
        drawText(ctx, `§7${row.label}`, this.listX + this.listW / 2, row.screenY + 5,
          { color: 0xb0b0b0, shadow: true, align: 'center' });
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(this.listX + 8, row.screenY + HEADER_H - 2, this.listW - 16, 1);
        continue;
      }
      const conflict = settings.isConflicting(row.action);
      const unbound = !settings.bindings[row.action];
      const color = conflict ? 0xff5555 : unbound ? 0xa0a0a0 : 0xffffff;
      drawText(ctx, row.label, this.listX + 12, row.screenY + (row.h - 8) / 2, { color, shadow: true });
      row.button?.render(ctx, mx, my, dt);
      if (conflict) {
        drawText(ctx, '§c✗', this.listX + this.listW - 10, row.screenY + (row.h - 8) / 2,
          { color: 0xff5555, shadow: true, align: 'right' });
      }
    }
    ctx.restore();

    // Edge fades and a scrollbar, matching the list chrome elsewhere.
    const top = ctx.createLinearGradient(0, this.listY, 0, this.listY + 4);
    top.addColorStop(0, 'rgba(0,0,0,0.85)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(this.listX, this.listY, this.listW, 4);
    const bot = ctx.createLinearGradient(0, this.listY + this.listH - 4, 0, this.listY + this.listH);
    bot.addColorStop(0, 'rgba(0,0,0,0)');
    bot.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = bot;
    ctx.fillRect(this.listX, this.listY + this.listH - 4, this.listW, 4);

    if (this.maxScroll > 0) {
      const bh = Math.max(12, Math.round((this.listH * this.listH) / this.contentHeight));
      const by = this.listY + Math.round((this.scroll / this.maxScroll) * (this.listH - bh));
      ctx.fillStyle = '#000000';
      ctx.fillRect(this.listX + this.listW - 6, this.listY, 6, this.listH);
      ctx.fillStyle = '#c6c6c6';
      ctx.fillRect(this.listX + this.listW - 6, by, 5, bh);
    }

    if (this.listening) {
      drawText(ctx, 'Press a key, or Escape to clear it', w / 2, h - 40,
        { color: 0xffffa0, shadow: true, align: 'center' });
    }

    this.renderTooltip(ctx, mx, my);
  }

  // ---------------------------------------------------------------- input

  onWheel(delta) {
    if (this.mouseY >= this.listY && this.mouseY <= this.listY + this.listH) {
      this.scroll = clamp(this.scroll + delta * 12, 0, this.maxScroll);
      this.applyScroll();
      return true;
    }
    return super.onWheel(delta);
  }

  onMouseDown(x, y, button) {
    // While listening, any click binds that mouse button — vanilla's behaviour.
    if (this.listening) {
      this.listening.apply(`Mouse${button}`);
      this.listening = null;
      return true;
    }
    return super.onMouseDown(x, y, button);
  }

  onKeyDown(code, e) {
    if (this.listening) {
      this.listening.apply(code === 'Escape' ? '' : code);
      this.listening = null;
      return true;
    }
    if (code === 'ArrowDown' || code === 'ArrowUp') {
      this.scroll = clamp(this.scroll + (code === 'ArrowDown' ? ROW_H : -ROW_H), 0, this.maxScroll);
      this.applyScroll();
      return true;
    }
    return super.onKeyDown(code, e);
  }

  onClose() {
    super.onClose();
    this.listening = null;
    settings.save();
  }
}
