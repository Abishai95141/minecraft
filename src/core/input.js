// Keyboard / mouse / pointer-lock input. Screens consume discrete events
// (click, keypress, wheel) while the player controller polls held state.

import { settings } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    /** @type {Set<string>} currently-held key codes ('KeyW', 'Mouse0', ...) */
    this.held = new Set();
    /** Codes that went down since the last `endFrame`. */
    this.pressed = new Set();
    /** Codes that went up since the last `endFrame`. */
    this.released = new Set();

    this.mouseX = 0;
    this.mouseY = 0;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    /** Queued printable characters for text fields. */
    this.typed = [];
    /** True while a screen wants raw keys (text field focused). */
    this.textMode = false;

    this._listeners = { keydown: new Set(), keyup: new Set(), mousedown: new Set(), mouseup: new Set(), wheel: new Set(), lockchange: new Set() };
    this._bindEvents();
  }

  on(type, fn) { this._listeners[type].add(fn); return () => this._listeners[type].delete(fn); }
  _emit(type, ...args) { for (const fn of this._listeners[type]) fn(...args); }

  _bindEvents() {
    const c = this.canvas;

    window.addEventListener('keydown', (e) => {
      // Let the browser keep its own shortcuts when nothing is captured.
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.code !== 'ControlLeft' && e.code !== 'ControlRight') return;
      }
      if (PREVENT_DEFAULT.has(e.code) || (this.locked && e.code !== 'Escape')) e.preventDefault();
      if (e.repeat) {
        if (this.textMode && isPrintable(e)) this.typed.push(e.key);
        this._emit('keydown', e.code, e, true);
        return;
      }
      this.held.add(e.code);
      this.pressed.add(e.code);
      if (this.textMode && isPrintable(e)) this.typed.push(e.key);
      this._emit('keydown', e.code, e, false);
    });

    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.released.add(e.code);
      this._emit('keyup', e.code, e);
    });

    // Losing focus must clear held keys or the player runs forever.
    window.addEventListener('blur', () => this.clearHeld());

    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const code = `Mouse${e.button}`;
      this.held.add(code);
      this.pressed.add(code);
      this._emit('mousedown', code, e);
    });

    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.held.delete(code);
      this.released.add(code);
      this._emit('mouseup', code, e);
    });

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      } else {
        const r = c.getBoundingClientRect();
        this.mouseX = e.clientX - r.left;
        this.mouseY = e.clientY - r.top;
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Normalise line/page deltas to notches.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const notches = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY * unit) / 100));
      this.wheel += notches;
      this._emit('wheel', notches, e);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === c;
      if (!this.locked && wasLocked) this.clearHeld();
      this.dx = this.dy = 0;
      this._emit('lockchange', this.locked);
    });

    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this._emit('lockchange', false);
    });
  }

  clearHeld() {
    this.held.clear();
    this.dx = this.dy = 0;
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    // Chrome returns a promise when passed options; older paths return undefined.
    if (p && typeof p.catch === 'function') {
      p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // --- queries -----------------------------------------------------------

  isDown(code) { return this.held.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }

  /** Held state of a bound action, e.g. `input.action('forward')`. */
  action(name) {
    const code = settings.bindings[name];
    return !!code && this.held.has(code);
  }
  actionPressed(name) {
    const code = settings.bindings[name];
    return !!code && this.pressed.has(code);
  }
  actionReleased(name) {
    const code = settings.bindings[name];
    return !!code && this.released.has(code);
  }
  /** The action bound to a key code, or null. */
  actionFor(code) {
    for (const [k, v] of Object.entries(settings.bindings)) if (v === code) return k;
    return null;
  }

  /** Consumes accumulated mouse delta, scaled by the sensitivity option. */
  takeLook() {
    // Vanilla: f = sensitivity * 0.6 + 0.2, then cubed.
    const s = settings.get('sensitivity') * 0.6 + 0.2;
    const scale = s * s * s * 8 * 0.0015;
    const dx = this.dx * scale;
    const dy = this.dy * scale * (settings.get('invertMouse') ? -1 : 1);
    this.dx = this.dy = 0;
    return { dx, dy };
  }

  takeTyped() {
    const t = this.typed;
    this.typed = [];
    return t;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.typed.length = 0;
    this.wheel = 0;
  }
}

const PREVENT_DEFAULT = new Set([
  'Space', 'Tab', 'F1', 'F2', 'F3', 'F5', 'F11',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote',
]);

function isPrintable(e) {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}
