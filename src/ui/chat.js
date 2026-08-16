// The chat overlay: the scrolling message log the HUD draws, plus the chat
// input line. The input line is a Screen so game.js routes keys to it and the
// player stops walking while you type. Owns command history and slash commands.

import { Screen } from './screen.js';
import { drawText, measureFormatted, wrapText, LINE_HEIGHT } from './font.js';
import { settings } from '../core/settings.js';
import { clamp } from '../core/math.js';
import { ITEMS } from '../item/items.js';
import { ItemStack } from '../item/inventory.js';

/** game.js caps `chatLog` at 100 entries; the sent-line history matches it. */
const MAX_SENT = 100;
const MAX_INPUT = 256;

/** Ages are in ticks, counted up by game.tickToasts(). 200 ticks = 10 seconds. */
const FADE_START = 200;
const FADE_TICKS = 20;

const CLOSED_LINES = 10;
const OPEN_LINES = 20;
const CHAT_WIDTH = 320;
const INPUT_H = 12;

const HELP = [
  '§e--- SowmiCraft commands ---',
  '§f/help §7- this list',
  '§f/clear §7- wipe the chat log',
  '§f/seed §7- print the world seed',
  '§f/time set <day|noon|night|midnight> §7- set the time',
  '§f/tp <x> <y> <z> §7- teleport',
  '§f/give <item> [count] §7- put an item in the hotbar',
  '§f/gamemode <survival|creative> §7- switch mode',
  '§f/xp <amount> §7- grant experience',
  '§f/kill §7- die on purpose',
];

const TIME_PRESETS = {
  day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000,
};

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Lines hold full opacity for 10s, then fade out over one more second. */
function fadeFor(age) {
  if (age < FADE_START) return 1;
  const t = (age - FADE_START) / FADE_TICKS;
  return t >= 1 ? 0 : 1 - t;
}

/**
 * Word wrapping is the only real cost in the log loop, and the log barely
 * changes between frames, so each entry keeps its last result. The guard
 * compares both the source text and the width, so the cache cannot go stale.
 */
function wrapCached(entry, width) {
  const text = String(entry?.text ?? '');
  if (!entry || typeof entry !== 'object') return wrapText(text, width);
  if (entry._wrapW !== width || entry._wrapSrc !== text) {
    entry._wrapW = width;
    entry._wrapSrc = text;
    entry._wrapped = wrapText(text, width);
  }
  return entry._wrapped;
}

export class ChatOverlay {
  constructor() {
    this.isOpen = false;
    this.text = '';
    this.cursor = 0;
    /** How many lines back the log is scrolled while the input is open. */
    this.scrollOffset = 0;
    /** Previously sent lines, oldest first — the arrow-key history. */
    this.sent = [];
    this.sentIndex = 0;
    this.blink = 0;
    this.screen = null;
    this._draft = '';
  }

  // ================================================================ opening

  /**
   * Opens the input line. Polled from the HUD, so the chat key works without
   * game.js knowing this module exists.
   */
  poll(game) {
    if (!game || this.isOpen || game.screen || !game.inGame) return;
    if (game.dialogue?.active) return;
    const input = game.input;
    if (!input?.actionPressed) return;
    if (input.actionPressed('chat')) this.openInput(game, '');
    else if (input.actionPressed('command')) this.openInput(game, '/');
  }

  openInput(game, prefix = '') {
    if (this.isOpen) return this.screen;
    this.text = String(prefix || '');
    this.cursor = this.text.length;
    this.scrollOffset = 0;
    this.sentIndex = this.sent.length;
    this._draft = this.text;
    this.blink = 0;
    this.isOpen = true;
    if (game?.openScreen) {
      this.screen = new ChatScreen(game, this);
      game.openScreen(this.screen);
    }
    return this.screen;
  }

  closeInput(game) {
    const screen = this.screen;
    // Closing the screen fires onClose, which is the single place state resets.
    if (screen && game?.screen === screen && game.closeScreen) game.closeScreen();
    else this._closed(game);
  }

  /** Called by ChatScreen.onClose, however the screen went away. */
  _closed(game) {
    this.isOpen = false;
    this.screen = null;
    this.scrollOffset = 0;
    if (game?.input) game.input.textMode = false;
  }

  // ================================================================ the log

  /**
   * Draws the message log bottom-left. Called by the HUD every frame, whether
   * or not the input line is open.
   */
  render(ctx, game, w, h, dt) {
    this.blink += Number.isFinite(dt) ? dt : 0;
    const log = Array.isArray(game?.chatLog) ? game.chatLog : null;
    if (!log || !log.length) return;

    const scale = clamp(num(settings.get('chatScale'), 1), 0.25, 1);
    const opacity = clamp(num(settings.get('chatOpacity'), 1), 0, 1);
    if (opacity <= 0.01) return;

    const boxW = Math.max(60, Math.min(CHAT_WIDTH, Math.floor((w - 6) / scale)));
    const maxLines = this.isOpen ? OPEN_LINES : CLOSED_LINES;
    const wanted = maxLines + this.scrollOffset;

    // Newest line first: wrapping each entry back-to-front keeps the newest
    // wrapped row adjacent to the input box, exactly like vanilla.
    const rows = [];
    for (let i = log.length - 1; i >= 0 && rows.length < wanted; i--) {
      const entry = log[i];
      const age = num(entry?.age, 0);
      if (!this.isOpen && fadeFor(age) <= 0) break;
      const wrapped = wrapCached(entry, boxW - 4);
      for (let k = wrapped.length - 1; k >= 0 && rows.length < wanted; k--) {
        rows.push({ text: wrapped[k], age });
      }
    }
    if (!rows.length) return;
    // Scrolling past the oldest line would thin the box out a row at a time;
    // stop as soon as the oldest line reaches the top of the window.
    if (this.scrollOffset + maxLines > rows.length) {
      this.scrollOffset = Math.max(0, rows.length - maxLines);
    }

    const bottom = Math.round(this.isOpen ? h - INPUT_H - 4 : h - 48);

    ctx.save();
    ctx.translate(3, bottom);
    ctx.scale(scale, scale);
    for (let j = this.scrollOffset; j < rows.length; j++) {
      const slot = j - this.scrollOffset;
      if (slot >= maxLines) break;
      const row = rows[j];
      const alpha = this.isOpen ? 1 : fadeFor(row.age);
      if (alpha <= 0.01) continue;
      const y = -(slot + 1) * LINE_HEIGHT;
      ctx.globalAlpha = alpha * opacity * 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(-2, y - 1, boxW, LINE_HEIGHT);
      ctx.globalAlpha = alpha * opacity;
      drawText(ctx, row.text, 0, y, { color: 0xffffff, shadow: true });
    }
    ctx.restore();
  }

  // ================================================================ the input line

  /** Drawn by ChatScreen, so it sits above every other HUD element. The caret
   *  clock is advanced by render(), which the HUD calls first every frame. */
  renderInput(ctx, w, h, dt) {
    const y = Math.round(h - INPUT_H - 2);
    const boxW = Math.max(20, w - 4);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(2, y, boxW, INPUT_H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(2, y, boxW, 1);

    const inner = boxW - 8;
    const beforeCursor = measureFormatted(this.text.slice(0, this.cursor));
    // Keep the caret in view by sliding the line left once it overflows.
    const shift = Math.max(0, beforeCursor - inner + 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(4, y, inner + 2, INPUT_H);
    ctx.clip();
    drawText(ctx, this.text, 4 - shift, y + 2, { color: 0xffffff, shadow: true });
    if (Math.floor(this.blink * 2.5) % 2 === 0) {
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(Math.round(4 - shift + beforeCursor), y + 1, 1, 10);
    }
    ctx.restore();

    if (this.scrollOffset > 0) {
      drawText(ctx, `§7↑${this.scrollOffset}`, boxW, y + 2, { color: 0xaaaaaa, shadow: true, align: 'right' });
    }
  }

  onKeyDown(code, e, game) {
    switch (code) {
      case 'Escape':
        this.closeInput(game);
        return true;
      case 'Enter':
      case 'NumpadEnter':
        this.submit(game);
        return true;
      case 'Backspace':
        if (this.cursor > 0) {
          this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
          this.cursor--;
        }
        this.blink = 0;
        return true;
      case 'Delete':
        if (this.cursor < this.text.length) {
          this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
        }
        this.blink = 0;
        return true;
      case 'ArrowLeft':
        this.cursor = Math.max(0, this.cursor - 1);
        this.blink = 0;
        return true;
      case 'ArrowRight':
        this.cursor = Math.min(this.text.length, this.cursor + 1);
        this.blink = 0;
        return true;
      case 'ArrowUp':
        this.recall(-1);
        return true;
      case 'ArrowDown':
        this.recall(1);
        return true;
      case 'PageUp':
        this.scroll(OPEN_LINES - 1);
        return true;
      case 'PageDown':
        this.scroll(-(OPEN_LINES - 1));
        return true;
      case 'Home':
        this.cursor = 0;
        return true;
      case 'End':
        this.cursor = this.text.length;
        return true;
      case 'Tab':
        // Plain text entry: tab neither completes nor inserts.
        return true;
      default:
        break;
    }
    // game.js only routes key events to screens, so printable characters have
    // to come off the event itself rather than input.takeTyped().
    const ch = e?.key;
    if (typeof ch === 'string' && ch.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.insert(ch);
    }
    return true;
  }

  insert(ch) {
    if (typeof ch !== 'string' || !ch.length) return;
    if (this.text.length >= MAX_INPUT) return;
    this.text = this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor);
    this.cursor += ch.length;
    this.blink = 0;
  }

  /** Arrow-key history. Index `sent.length` is the line being typed. */
  recall(dir) {
    if (!this.sent.length) return;
    if (this.sentIndex >= this.sent.length) this._draft = this.text;
    const next = clamp(this.sentIndex + dir, 0, this.sent.length);
    if (next === this.sentIndex) return;
    this.sentIndex = next;
    this.text = next >= this.sent.length ? this._draft : this.sent[next];
    this.cursor = this.text.length;
    this.blink = 0;
  }

  scroll(delta) {
    const d = Math.round(Number(delta) || 0);
    this.scrollOffset = clamp(this.scrollOffset + d, 0, MAX_SENT);
  }

  submit(game) {
    const text = this.text.trim();
    this.text = '';
    this.cursor = 0;
    if (text) {
      this.sent.push(text);
      if (this.sent.length > MAX_SENT) this.sent.shift();
      // Typed § codes are stripped so a message cannot recolour the whole log.
      if (text.startsWith('/')) this.runCommand(game, text.slice(1));
      else game?.chat?.(`§7<Player>§r ${text.replace(/§/g, '')}`);
    }
    this.sentIndex = this.sent.length;
    this._draft = '';
    this.closeInput(game);
  }

  // ================================================================ commands

  runCommand(game, raw) {
    const parts = String(raw).split(/\s+/).filter(Boolean);
    const cmd = (parts.shift() || '').toLowerCase();
    const say = (t) => game?.chat?.(t);
    const player = game?.player ?? null;
    const world = game?.world ?? null;

    switch (cmd) {
      case 'help':
      case '?':
        for (const line of HELP) say(line);
        return;

      case 'clear':
        if (Array.isArray(game?.chatLog)) game.chatLog.length = 0;
        return;

      case 'seed':
        say(world ? `§7Seed: §f${world.seed}` : '§cNo world is loaded.');
        return;

      case 'time': {
        if (!world) { say('§cNo world is loaded.'); return; }
        const when = String((parts[0] === 'set' ? parts[1] : parts[0]) || '').toLowerCase();
        // hasOwnProperty, so a name like 'constructor' cannot reach the prototype.
        if (Object.prototype.hasOwnProperty.call(TIME_PRESETS, when)) {
          world.timeOfDay = TIME_PRESETS[when];
          say(`§7Time set to §f${when}§7.`);
          return;
        }
        const ticks = when ? Number(when) : NaN;
        if (Number.isFinite(ticks)) {
          world.timeOfDay = Math.max(0, Math.floor(ticks));
          say(`§7Time set to §f${world.timeOfDay}§7.`);
          return;
        }
        say('§cUsage: /time set <day|noon|sunset|night|midnight|sunrise|ticks>');
        return;
      }

      case 'tp': {
        if (!player) { say('§cThere is nobody to teleport.'); return; }
        const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          say('§cUsage: /tp <x> <y> <z>');
          return;
        }
        player.x = x; player.y = y; player.z = z;
        player.prevX = x; player.prevY = y; player.prevZ = z;
        player.vx = 0; player.vy = 0; player.vz = 0;
        player.fallDistance = 0;
        say(`§7Teleported to §f${x} ${y} ${z}§7.`);
        return;
      }

      case 'give': {
        if (!player?.inventory) { say('§cThere is nobody to give it to.'); return; }
        const name = String(parts[0] || '').toLowerCase();
        if (!ITEMS[name]) { say(`§cUnknown item: §f${name || '(none)'}`); return; }
        const count = clamp(Math.floor(num(parts[1], 1)), 1, 64);
        const left = player.inventory.addToHotbarFirst?.(new ItemStack(name, count));
        const remaining = left && !left.isEmpty ? left.count : 0;
        say(remaining
          ? `§7Gave §f${count - remaining}§7 ${name} - no room for the rest.`
          : `§7Gave §f${count}§7 ${name}.`);
        return;
      }

      case 'gm':
      case 'gamemode': {
        if (!player) { say('§cThere is nobody to change.'); return; }
        const mode = String(parts[0] || '').toLowerCase();
        if (mode === 'creative' || mode === 'c' || mode === '1') {
          player.creative = true;
          say('§7Game mode set to §fCreative§7.');
        } else if (mode === 'survival' || mode === 's' || mode === '0') {
          player.creative = false;
          player.flying = false;
          say('§7Game mode set to §fSurvival§7.');
        } else {
          say('§cUsage: /gamemode <survival|creative>');
        }
        return;
      }

      case 'xp': {
        if (!player) { say('§cThere is nobody to reward.'); return; }
        const amount = Math.floor(num(parts[0], 0));
        if (amount <= 0) { say('§cUsage: /xp <amount>'); return; }
        player.addXp?.(amount);
        say(`§7Gave §f${amount}§7 experience.`);
        return;
      }

      case 'kill':
        if (!player) { say('§cThere is nobody to kill.'); return; }
        // 'void' is the one source that bypasses creative mode and armour.
        player.damage?.(10000, 'void');
        return;

      default:
        say(`§cUnknown command: §f/${cmd}§c. Try §f/help§c.`);
    }
  }
}

/**
 * The screen that owns keyboard focus while the input line is open. It pauses
 * nothing and dims nothing — the world keeps running behind it, as in vanilla.
 */
export class ChatScreen extends Screen {
  constructor(game, overlay) {
    super(game);
    this.overlay = overlay || chat;
    this.pausesGame = false;
    this.blursBackground = false;
    // The overlay closes itself so its state and the screen stack stay in step.
    this.closeOnEscape = false;
  }

  init(w, h) {
    this.width = w;
    this.height = h;
    if (this.game?.input) this.game.input.textMode = true;
  }

  layout(w, h) {
    this.width = w;
    this.height = h;
  }

  render(ctx, mx, my, dt) {
    const w = this.width || this.game?.width || 0;
    const h = this.height || this.game?.height || 0;
    this.overlay.renderInput(ctx, w, h, dt);
  }

  onKeyDown(code, e) { return this.overlay.onKeyDown(code, e, this.game); }
  onChar(ch) { this.overlay.insert(ch); return true; }
  onWheel(delta) { this.overlay.scroll(-(Number(delta) || 0)); return true; }
  onMouseDown() { return true; }
  onMouseUp() { return true; }

  onClose() {
    super.onClose();
    this.overlay._closed(this.game);
  }
}

/** The instance the HUD draws and the chat key opens. */
export const chat = new ChatOverlay();
