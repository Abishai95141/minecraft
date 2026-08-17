// The base Screen: a widget container, the event router that game.js drives,
// and the shared menu chrome (dirt or dimmed-world background, title, tooltip).
// Every menu, options page and container GUI inherits from this.

import { drawText, wrapText, measureFormatted, LINE_HEIGHT } from './font.js';
import { OPTION_DEFS, OptionKind } from '../core/settings.js';
import {
  BUTTON_H, Slider, CycleButton, ToggleButton, TextField,
  drawDirtBackground, drawGradientOverlay, drawNinePatch,
} from './widgets.js';

export class Screen {
  constructor(game) {
    this.game = game;
    this.title = '';
    this.parent = null;
    this.pausesGame = false;
    this.blursBackground = true;
    /** Screens draw their own chrome; the game HUD stays hidden behind them. */
    this.drawsHud = false;
    this.closeOnEscape = true;

    /** @type {import('./widgets.js').Widget[]} */
    this.widgets = [];
    this.width = 0;
    this.height = 0;
    this.time = 0;      // seconds this screen has been open
    this.ticks = 0;
    this.mouseX = 0;
    this.mouseY = 0;

    this._active = null;    // widget receiving drag/release
    this._focus = null;
    this._tooltip = null;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Builds the widget set. Subclasses implement `build`. */
  init(w, h) {
    this.width = w;
    this.height = h;
    this.build(w, h);
  }

  /** Resize rebuilds from scratch, exactly like vanilla's screen resize. */
  layout(w, h) {
    this.width = w;
    this.height = h;
    this.widgets.length = 0;
    this._active = null;
    this._focus = null;
    this.init(w, h);
  }

  /** Override point: create widgets here. */
  build(w, h) {}

  onClose() {
    if (this.game?.input) this.game.input.textMode = false;
  }

  close() {
    if (this.game?.closeScreen) this.game.closeScreen();
    else this.game?.openScreen?.(null);
  }

  // ---------------------------------------------------------------- widgets

  add(widget) {
    widget.screen = this;
    this.widgets.push(widget);
    return widget;
  }

  remove(widget) {
    const i = this.widgets.indexOf(widget);
    if (i >= 0) this.widgets.splice(i, 1);
    if (this._focus === widget) this.setFocus(null);
    if (this._active === widget) this._active = null;
    return widget;
  }

  clearWidgets() {
    this.widgets.length = 0;
    this._focus = null;
    this._active = null;
  }

  get focused() { return this._focus; }

  setFocus(widget) {
    if (this._focus === widget) return widget;
    this._focus?.onFocus(false);
    this._focus = widget ?? null;
    this._focus?.onFocus(true);
    // Text fields need raw keys; everything else lets the player keep hotkeys.
    if (this.game?.input) this.game.input.textMode = this._focus instanceof TextField;
    return this._focus;
  }

  cycleFocus(dir = 1) {
    const focusable = this.widgets.filter((wg) => wg.visible && wg.enabled);
    if (!focusable.length) return;
    const at = focusable.indexOf(this._focus);
    const next = focusable[(at + dir + focusable.length) % focusable.length];
    this.setFocus(next);
  }

  /**
   * Lays option keys out in vanilla's two-column grid, choosing the widget kind
   * from OPTION_DEFS so an option added to settings.js appears here for free.
   * Returns the y just past the last row.
   */
  addOptionRows(keys, opts = {}) {
    const columns = opts.columns ?? 2;
    const colWidth = opts.colWidth ?? 150;
    const gap = opts.gap ?? 10;
    const rowPitch = opts.rowPitch ?? 24;
    const totalW = columns * colWidth + (columns - 1) * gap;
    const x0 = opts.x ?? Math.round(this.width / 2 - totalW / 2);
    const y0 = opts.y ?? 32;

    keys.forEach((key, i) => {
      const def = OPTION_DEFS[key];
      if (!def) return;
      const bx = x0 + (i % columns) * (colWidth + gap);
      const by = y0 + Math.floor(i / columns) * rowPitch;
      const common = { x: bx, y: by, w: colWidth, h: BUTTON_H, optionKey: key };
      if (def.kind === OptionKind.SLIDER) this.add(new Slider(common));
      else if (def.kind === OptionKind.TOGGLE) this.add(new ToggleButton(common));
      else this.add(new CycleButton(common));
    });

    return y0 + Math.ceil(keys.length / columns) * rowPitch;
  }

  // ---------------------------------------------------------------- drawing

  /** Dirt out of game, the dimmed world in game. */
  renderBackground(ctx, w, h) {
    if (this.game?.inGame && this.game?.world) {
      if (this.blursBackground) drawGradientOverlay(ctx, w, h);
    } else {
      drawDirtBackground(ctx, w, h, 32);
    }
  }

  renderTitle(ctx, y = 15) {
    if (!this.title) return;
    drawText(ctx, this.title, this.width / 2, y, { color: 0xffffff, shadow: true, align: 'center' });
  }

  renderWidgets(ctx, mx, my, dt) {
    this.mouseX = mx;
    this.mouseY = my;
    this._active?.mouseDrag(mx, my);
    this._tooltip = null;
    for (const wg of this.widgets) {
      if (!wg.visible) continue;
      wg.render(ctx, mx, my, dt);
      if (wg.tooltip && wg.enabled && wg.contains(mx, my)) this._tooltip = wg.tooltip;
    }
  }

  /** Vanilla's dark tooltip box, clamped inside the screen. */
  renderTooltip(ctx, mx, my, text = this._tooltip) {
    if (!text) return;
    const maxW = Math.min(180, Math.max(60, this.width - 24));
    const lines = wrapText(text, maxW);
    let w = 0;
    for (const line of lines) w = Math.max(w, measureFormatted(line));
    const h = lines.length * LINE_HEIGHT - 1;
    let x = Math.round(mx + 8);
    let y = Math.round(my - 14);
    if (x + w + 6 > this.width) x = this.width - w - 6;
    if (y < 2) y = 2;
    if (y + h + 6 > this.height) y = this.height - h - 6;

    ctx.fillStyle = 'rgba(16,0,16,0.94)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#4b2c8a';
    ctx.fillRect(x - 3, y - 3, w + 6, 1);
    ctx.fillRect(x - 3, y + h + 2, w + 6, 1);
    ctx.fillRect(x - 3, y - 2, 1, h + 4);
    ctx.fillRect(x + w + 2, y - 2, 1, h + 4);
    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, lines[i], x, y + i * LINE_HEIGHT, { color: 0xdcdcdc, shadow: true });
    }
  }

  /** A framed header strip, used by the list screens. */
  renderHeaderBar(ctx, y, h) {
    drawNinePatch(ctx, 'header', 0, y, this.width, h);
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.renderBackground(ctx, this.width, this.height);
    this.renderTitle(ctx);
    this.renderWidgets(ctx, mx, my, dt);
    this.renderTooltip(ctx, mx, my);
  }

  tick() {
    this.ticks++;
    for (const wg of this.widgets) wg.tick();
  }

  // ---------------------------------------------------------------- input

  onMouseDown(x, y, button) {
    this.mouseX = x;
    this.mouseY = y;
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const wg = this.widgets[i];
      if (!wg.visible || !wg.enabled || !wg.contains(x, y)) continue;
      this.setFocus(wg);
      if (wg.mouseDown(x, y, button)) {
        this._active = wg;
        return true;
      }
      return true;
    }
    this.setFocus(null);
    return false;
  }

  onMouseUp(x, y, button) {
    if (!this._active) return false;
    const wg = this._active;
    this._active = null;
    wg.mouseUp(x, y, button);
    return true;
  }

  onWheel(delta) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const wg = this.widgets[i];
      if (!wg.visible || !wg.enabled) continue;
      if (wg.wheel(delta, this.mouseX, this.mouseY)) return true;
    }
    return false;
  }

  onKeyDown(code, e) {
    if (this._focus && this._focus.keyDown(code, e)) return true;
    if (code === 'Tab') { this.cycleFocus(e && e.shiftKey ? -1 : 1); return true; }
    if (code === 'Escape' && this.closeOnEscape) { this.close(); return true; }
    return false;
  }

  onChar(ch) {
    return !!this._focus?.charTyped(ch);
  }
}
