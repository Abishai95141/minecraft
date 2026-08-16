// Game options and key bindings, persisted to localStorage. The option
// definitions here drive the Options screens directly, so adding a setting is
// a one-line change that shows up in the UI automatically.

import * as storage from './storage.js';
import { clamp } from './math.js';

export const OptionKind = { SLIDER: 'slider', CYCLE: 'cycle', TOGGLE: 'toggle' };

/**
 * Every option. `format` produces the button label, matching vanilla's
 * "Name: Value" style.
 */
export const OPTION_DEFS = {
  // --- video ---
  fov: {
    kind: OptionKind.SLIDER, category: 'video', label: 'FOV',
    min: 30, max: 110, step: 1, default: 70,
    format: (v) => (v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : String(v)),
    tooltip: 'Vertical field of view, in degrees.',
  },
  renderDistance: {
    kind: OptionKind.SLIDER, category: 'video', label: 'Render Distance',
    min: 2, max: 16, step: 1, default: 8,
    format: (v) => `${v} chunks`,
    tooltip: 'How far the world is drawn. Higher costs more performance.',
  },
  simulationDistance: {
    kind: OptionKind.SLIDER, category: 'video', label: 'Simulation Distance',
    min: 3, max: 12, step: 1, default: 6,
    format: (v) => `${v} chunks`,
    tooltip: 'How far mobs, fluids and block updates keep running.',
  },
  guiScale: {
    kind: OptionKind.CYCLE, category: 'video', label: 'GUI Scale',
    values: [0, 1, 2, 3, 4], default: 0,
    format: (v) => (v === 0 ? 'Auto' : String(v)),
  },
  brightness: {
    kind: OptionKind.SLIDER, category: 'video', label: 'Brightness',
    min: 0, max: 1, step: 0.01, default: 0.5,
    format: (v) => (v <= 0.001 ? 'Moody' : v >= 0.999 ? 'Bright' : `${Math.round(v * 100)}%`),
  },
  graphics: {
    kind: OptionKind.CYCLE, category: 'video', label: 'Graphics',
    values: ['fast', 'fancy'], default: 'fancy',
    format: (v) => (v === 'fast' ? 'Fast' : 'Fancy'),
    tooltip: 'Fancy enables transparent leaves and smoother water.',
  },
  smoothLighting: {
    kind: OptionKind.CYCLE, category: 'video', label: 'Smooth Lighting',
    values: [0, 0.5, 1], default: 1,
    format: (v) => (v === 0 ? 'OFF' : v === 1 ? 'Maximum' : 'Minimum'),
  },
  clouds: {
    kind: OptionKind.CYCLE, category: 'video', label: 'Clouds',
    values: ['off', 'fast', 'fancy'], default: 'fancy',
    format: (v) => (v === 'off' ? 'OFF' : v === 'fast' ? 'Fast' : 'Fancy'),
  },
  particles: {
    kind: OptionKind.CYCLE, category: 'video', label: 'Particles',
    values: ['all', 'decreased', 'minimal'], default: 'all',
    format: (v) => v.charAt(0).toUpperCase() + v.slice(1),
  },
  maxFramerate: {
    kind: OptionKind.SLIDER, category: 'video', label: 'Max Framerate',
    min: 10, max: 260, step: 10, default: 260,
    format: (v) => (v >= 260 ? 'Unlimited' : `${v} fps`),
  },
  viewBobbing: {
    kind: OptionKind.TOGGLE, category: 'video', label: 'View Bobbing', default: true,
  },
  entityShadows: {
    kind: OptionKind.TOGGLE, category: 'video', label: 'Entity Shadows', default: true,
  },
  fullscreen: {
    kind: OptionKind.TOGGLE, category: 'video', label: 'Fullscreen', default: false,
  },
  renderScale: {
    kind: OptionKind.SLIDER, category: 'video', label: 'Render Scale',
    min: 0.5, max: 2, step: 0.25, default: 1,
    format: (v) => `${v}x`,
    tooltip: 'Internal resolution multiplier. Lower for more speed.',
  },

  // --- controls ---
  sensitivity: {
    kind: OptionKind.SLIDER, category: 'controls', label: 'Sensitivity',
    min: 0, max: 2, step: 0.01, default: 1,
    format: (v) => (v <= 0.001 ? '*yawn*' : v >= 1.999 ? 'HYPERSPEED!!!' : `${Math.round(v * 100)}%`),
  },
  invertMouse: { kind: OptionKind.TOGGLE, category: 'controls', label: 'Invert Mouse', default: false },
  autoJump: { kind: OptionKind.TOGGLE, category: 'controls', label: 'Auto-Jump', default: false },
  toggleSprint: {
    kind: OptionKind.CYCLE, category: 'controls', label: 'Sprint',
    values: ['hold', 'toggle'], default: 'hold',
    format: (v) => (v === 'hold' ? 'Hold' : 'Toggle'),
  },
  toggleSneak: {
    kind: OptionKind.CYCLE, category: 'controls', label: 'Sneak',
    values: ['hold', 'toggle'], default: 'hold',
    format: (v) => (v === 'hold' ? 'Hold' : 'Toggle'),
  },

  // --- audio ---
  masterVolume: {
    kind: OptionKind.SLIDER, category: 'audio', label: 'Master Volume',
    min: 0, max: 1, step: 0.01, default: 0.7,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  musicVolume: {
    kind: OptionKind.SLIDER, category: 'audio', label: 'Music',
    min: 0, max: 1, step: 0.01, default: 0.45,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  soundVolume: {
    kind: OptionKind.SLIDER, category: 'audio', label: 'Blocks',
    min: 0, max: 1, step: 0.01, default: 1,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  hostileVolume: {
    kind: OptionKind.SLIDER, category: 'audio', label: 'Hostile Creatures',
    min: 0, max: 1, step: 0.01, default: 1,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  ambientVolume: {
    kind: OptionKind.SLIDER, category: 'audio', label: 'Ambient/Environment',
    min: 0, max: 1, step: 0.01, default: 0.8,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },

  // --- chat / accessibility ---
  chatOpacity: {
    kind: OptionKind.SLIDER, category: 'chat', label: 'Chat Opacity',
    min: 0, max: 1, step: 0.01, default: 1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  chatScale: {
    kind: OptionKind.SLIDER, category: 'chat', label: 'Chat Text Size',
    min: 0.25, max: 1, step: 0.05, default: 1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  showSubtitles: { kind: OptionKind.TOGGLE, category: 'accessibility', label: 'Show Subtitles', default: false },
  screenShake: {
    kind: OptionKind.SLIDER, category: 'accessibility', label: 'Screen Shake',
    min: 0, max: 1, step: 0.05, default: 1,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  damageTilt: {
    kind: OptionKind.SLIDER, category: 'accessibility', label: 'Damage Tilt',
    min: 0, max: 1, step: 0.05, default: 1,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  distortionEffects: {
    kind: OptionKind.SLIDER, category: 'accessibility', label: 'Distortion Effects',
    min: 0, max: 1, step: 0.05, default: 1,
    format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)}%`),
  },
  autoDialogue: { kind: OptionKind.TOGGLE, category: 'accessibility', label: 'Auto-Advance Dialogue', default: false },
  textSpeed: {
    kind: OptionKind.CYCLE, category: 'accessibility', label: 'Dialogue Speed',
    values: [25, 45, 70, 1000], default: 45,
    format: (v) => (v >= 1000 ? 'Instant' : v === 25 ? 'Slow' : v === 45 ? 'Normal' : 'Fast'),
  },
};

// ------------------------------------------------------------------ key binds

/** Default bindings match Java Edition. `code` is a KeyboardEvent.code or 'MouseN'. */
export const DEFAULT_BINDINGS = {
  forward:      { code: 'KeyW',        label: 'Forward',           category: 'Movement' },
  left:         { code: 'KeyA',        label: 'Strafe Left',       category: 'Movement' },
  back:         { code: 'KeyS',        label: 'Back',              category: 'Movement' },
  right:        { code: 'KeyD',        label: 'Strafe Right',      category: 'Movement' },
  jump:         { code: 'Space',       label: 'Jump',              category: 'Movement' },
  sneak:        { code: 'ShiftLeft',   label: 'Sneak',             category: 'Movement' },
  sprint:       { code: 'ControlLeft', label: 'Sprint',            category: 'Movement' },

  attack:       { code: 'Mouse0',      label: 'Attack/Destroy',    category: 'Gameplay' },
  use:          { code: 'Mouse2',      label: 'Use Item/Place',    category: 'Gameplay' },
  pickBlock:    { code: 'Mouse1',      label: 'Pick Block',        category: 'Gameplay' },
  drop:         { code: 'KeyQ',        label: 'Drop Selected Item', category: 'Gameplay' },
  swapHands:    { code: 'KeyF',        label: 'Swap Item With Offhand', category: 'Gameplay' },

  inventory:    { code: 'KeyE',        label: 'Open/Close Inventory', category: 'Inventory' },
  hotbar1:      { code: 'Digit1',      label: 'Hotbar Slot 1',     category: 'Inventory' },
  hotbar2:      { code: 'Digit2',      label: 'Hotbar Slot 2',     category: 'Inventory' },
  hotbar3:      { code: 'Digit3',      label: 'Hotbar Slot 3',     category: 'Inventory' },
  hotbar4:      { code: 'Digit4',      label: 'Hotbar Slot 4',     category: 'Inventory' },
  hotbar5:      { code: 'Digit5',      label: 'Hotbar Slot 5',     category: 'Inventory' },
  hotbar6:      { code: 'Digit6',      label: 'Hotbar Slot 6',     category: 'Inventory' },
  hotbar7:      { code: 'Digit7',      label: 'Hotbar Slot 7',     category: 'Inventory' },
  hotbar8:      { code: 'Digit8',      label: 'Hotbar Slot 8',     category: 'Inventory' },
  hotbar9:      { code: 'Digit9',      label: 'Hotbar Slot 9',     category: 'Inventory' },

  chat:         { code: 'KeyT',        label: 'Open Chat',         category: 'Multiplayer' },
  command:      { code: 'Slash',       label: 'Open Command',      category: 'Multiplayer' },

  questLog:     { code: 'KeyJ',        label: 'Quest Log',         category: 'Story' },
  objectives:   { code: 'KeyO',        label: 'Toggle Objectives', category: 'Story' },

  perspective:  { code: 'F5',          label: 'Toggle Perspective', category: 'Miscellaneous' },
  debug:        { code: 'F3',          label: 'Debug Screen',      category: 'Miscellaneous' },
  screenshot:   { code: 'F2',          label: 'Take Screenshot',   category: 'Miscellaneous' },
  hideHud:      { code: 'F1',          label: 'Toggle HUD',        category: 'Miscellaneous' },
  fullscreen:   { code: 'F11',         label: 'Toggle Fullscreen', category: 'Miscellaneous' },
};

export const BINDING_CATEGORIES = ['Movement', 'Gameplay', 'Inventory', 'Multiplayer', 'Story', 'Miscellaneous'];

// ------------------------------------------------------------------ store

const STORAGE_KEY = 'options';

function defaults() {
  const o = {};
  for (const [k, d] of Object.entries(OPTION_DEFS)) o[k] = d.default;
  return o;
}

class Settings {
  constructor() {
    this.values = defaults();
    this.bindings = {};
    for (const [k, d] of Object.entries(DEFAULT_BINDINGS)) this.bindings[k] = d.code;
    this._listeners = new Set();
    this.load();
  }

  load() {
    const saved = storage.load(STORAGE_KEY, null);
    if (!saved) return;
    if (saved.values) {
      for (const [k, v] of Object.entries(saved.values)) {
        if (k in OPTION_DEFS) this.values[k] = this._coerce(k, v);
      }
    }
    if (saved.bindings) {
      for (const [k, v] of Object.entries(saved.bindings)) {
        if (k in DEFAULT_BINDINGS && typeof v === 'string') this.bindings[k] = v;
      }
    }
  }

  save() {
    storage.save(STORAGE_KEY, { values: this.values, bindings: this.bindings });
  }

  _coerce(key, v) {
    const d = OPTION_DEFS[key];
    if (!d) return v;
    if (d.kind === OptionKind.SLIDER) {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(n, d.min, d.max) : d.default;
    }
    if (d.kind === OptionKind.TOGGLE) return !!v;
    if (d.kind === OptionKind.CYCLE) return d.values.includes(v) ? v : d.default;
    return v;
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    const v = this._coerce(key, value);
    if (this.values[key] === v) return v;
    this.values[key] = v;
    this.save();
    for (const fn of this._listeners) fn(key, v);
    return v;
  }

  /** Advances a CYCLE option to its next value; returns the new value. */
  cycle(key, dir = 1) {
    const d = OPTION_DEFS[key];
    if (d.kind === OptionKind.TOGGLE) return this.set(key, !this.values[key]);
    if (d.kind !== OptionKind.CYCLE) return this.values[key];
    const i = d.values.indexOf(this.values[key]);
    const n = (i + dir + d.values.length) % d.values.length;
    return this.set(key, d.values[n]);
  }

  format(key) {
    const d = OPTION_DEFS[key];
    const v = this.values[key];
    if (d.kind === OptionKind.TOGGLE) return v ? 'ON' : 'OFF';
    return d.format ? d.format(v) : String(v);
  }

  /** Label shown on the option button, vanilla style. */
  buttonLabel(key) {
    return `${OPTION_DEFS[key].label}: ${this.format(key)}`;
  }

  optionsIn(category) {
    return Object.keys(OPTION_DEFS).filter((k) => OPTION_DEFS[k].category === category);
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  // --- bindings ---
  bind(action, code) {
    // Vanilla clears any other action holding the same key.
    for (const [k, v] of Object.entries(this.bindings)) {
      if (k !== action && v === code) this.bindings[k] = '';
    }
    this.bindings[action] = code;
    this.save();
  }

  unbind(action) { this.bindings[action] = ''; this.save(); }

  resetBindings() {
    for (const [k, d] of Object.entries(DEFAULT_BINDINGS)) this.bindings[k] = d.code;
    this.save();
  }

  /** True when more than one action shares this action's key. */
  isConflicting(action) {
    const code = this.bindings[action];
    if (!code) return false;
    let n = 0;
    for (const v of Object.values(this.bindings)) if (v === code) n++;
    return n > 1;
  }

  resetAll() {
    this.values = defaults();
    this.resetBindings();
    this.save();
    for (const fn of this._listeners) fn('*', null);
  }
}

export const settings = new Settings();

// ------------------------------------------------------------------ key names

const KEY_NAMES = {
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Control', ControlRight: 'Right Control',
  AltLeft: 'Left Alt', AltRight: 'Right Alt',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  CapsLock: 'Caps Lock', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Mouse0: 'Left Button', Mouse1: 'Middle Button', Mouse2: 'Right Button',
  Mouse3: 'Button 4', Mouse4: 'Button 5',
};

/** Human label for a key code, matching vanilla's naming where practical. */
export function keyName(code) {
  if (!code) return 'Not bound';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Keypad ${code.slice(6)}`;
  if (/^F\d+$/.test(code)) return code;
  return code;
}
