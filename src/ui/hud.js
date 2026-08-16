// The in-game HUD: crosshair, hotbar, health/hunger/armour/air, the XP bar,
// the held-item name, the boss bar, the objective tracker, chat, toasts,
// subtitles and the F3 debug overlay. Drawn in GUI pixels into a scaled ctx.

import { drawText, measureFormatted, LINE_HEIGHT, tickObfuscation } from './font.js';
import { icons } from './icons.js';
import { chat } from './chat.js';
import { settings } from '../core/settings.js';
import { PLAYER } from '../core/constants.js';
import { clamp, cssHex, mixHex } from '../core/math.js';
import { hash2 } from '../core/rng.js';
import { getItem, RARITY_COLOR } from '../item/items.js';
import { BLOCKS } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';

const HOTBAR_W = 182;
const HOTBAR_H = 22;
const SLOT = 20;

/** Status icons are 9x9 sprites pitched 8px apart, so their rims share a pixel. */
const ICON = 9;
const ICON_PITCH = 8;

const HELD_NAME_TIME = 2.5;    // seconds the held-item name stays up
const HELD_NAME_FADE = 0.5;    // seconds of fade at the end of that window

const TOAST_W = 160;
const TOAST_H = 32;

const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// ================================================================= status icons
// 7x7 string art grown by a 1px black rim into a 9x9 cell. Building them once
// into offscreen canvases keeps a full health row down to ten drawImage calls.

const HEART_ART = [
  '.++.##.',
  '#++####',
  '#######',
  '######-',
  '.####-.',
  '..##-..',
  '...-...',
];

const DRUMSTICK_ART = [
  '..+##..',
  '.++###.',
  '.#####.',
  '.#####.',
  '..###..',
  '.oo....',
  'oo.....',
];

const ARMOR_ART = [
  '##.#.##',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '.#####.',
  '.#####.',
];

const BUBBLE_ART = [
  '..###..',
  '.++###.',
  '#+#####',
  '#######',
  '#######',
  '.#####.',
  '..###..',
];

const BUBBLE_POP_ART = [
  '.......',
  '.#...#.',
  '..#.#..',
  '.......',
  '..#.#..',
  '.#...#.',
  '.......',
];

const EMPTY_PALETTE = { '#': '#3a3a3a', '+': '#4a4a4a', '-': '#2a2a2a', o: '#4a4a4a' };
// The blink keeps two tones so a half heart still reads while it is flashing.
const FLASH_CONTAINER_PALETTE = { '#': '#8d8d8d', '+': '#9d9d9d', '-': '#6f6f6f' };
const FLASH_PALETTE = { '#': '#ffffff', '+': '#ffffff', '-': '#dedede' };
const HEART_PALETTE = { '#': '#ff2020', '+': '#ff7a7a', '-': '#c01414' };
const FOOD_PALETTE = { '#': '#8a4b21', '+': '#b0703a', o: '#e8e0d0' };
const ARMOR_PALETTE = { '#': '#c4c4c4', '+': '#e4e4e4', '-': '#8f8f8f' };
const BUBBLE_PALETTE = { '#': '#b8d4ff', '+': '#ffffff' };

/** Blanks out every cell the mask rejects, leaving a half icon. */
function maskArt(art, keep) {
  return art.map((row, y) => row
    .split('')
    .map((ch, x) => (keep(x, y) ? ch : '.'))
    .join(''));
}

function buildSprite(art, palette, cell = ICON, rim = '#000000') {
  const canvas = document.createElement('canvas');
  canvas.width = cell;
  canvas.height = cell;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.imageSmoothingEnabled = false;

  const rows = art.length;
  let cols = 0;
  for (const row of art) cols = Math.max(cols, row.length);
  const ox = Math.floor((cell - cols) / 2);
  const oy = Math.floor((cell - rows) / 2);

  const filled = (x, y) => {
    const row = art[y];
    if (!row) return false;
    const ch = row[x];
    return !!ch && ch !== '.' && ch !== ' ';
  };

  if (rim) {
    g.fillStyle = rim;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!filled(x, y)) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || filled(x + dx, y + dy)) continue;
            const px = ox + x + dx;
            const py = oy + y + dy;
            if (px < 0 || py < 0 || px >= cell || py >= cell) continue;
            g.fillRect(px, py, 1, 1);
          }
        }
      }
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!filled(x, y)) continue;
      g.fillStyle = palette[art[y][x]] || palette['#'] || '#ffffff';
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  return canvas;
}

/** @type {Record<string, HTMLCanvasElement>|null} */
let SPR = null;

function ensureSprites() {
  if (SPR) return SPR;
  const leftHalf = (x) => x <= 3;
  const rightHalf = (x) => x >= 3;
  SPR = {
    heartEmpty: buildSprite(HEART_ART, EMPTY_PALETTE),
    heartEmptyFlash: buildSprite(HEART_ART, FLASH_CONTAINER_PALETTE),
    heartFull: buildSprite(HEART_ART, HEART_PALETTE),
    heartHalf: buildSprite(maskArt(HEART_ART, leftHalf), HEART_PALETTE),
    heartFullFlash: buildSprite(HEART_ART, FLASH_PALETTE),
    heartHalfFlash: buildSprite(maskArt(HEART_ART, leftHalf), FLASH_PALETTE),
    foodEmpty: buildSprite(DRUMSTICK_ART, EMPTY_PALETTE),
    foodFull: buildSprite(DRUMSTICK_ART, FOOD_PALETTE),
    foodHalf: buildSprite(maskArt(DRUMSTICK_ART, rightHalf), FOOD_PALETTE),
    armorEmpty: buildSprite(ARMOR_ART, EMPTY_PALETTE),
    armorFull: buildSprite(ARMOR_ART, ARMOR_PALETTE),
    armorHalf: buildSprite(maskArt(ARMOR_ART, leftHalf), ARMOR_PALETTE),
    bubble: buildSprite(BUBBLE_ART, BUBBLE_PALETTE),
    bubblePop: buildSprite(BUBBLE_POP_ART, BUBBLE_PALETTE),
  };
  return SPR;
}

// ================================================================= small helpers

function strokeRect1(ctx, x, y, w, h) {
  if (w < 2 || h < 2) return;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}

function fit(line, maxWidth) {
  if (maxWidth <= 0 || measureFormatted(line) <= maxWidth) return line;
  let s = String(line);
  while (s.length > 1 && measureFormatted(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** Yaw 0 looks toward +Z, and increasing yaw turns toward -X (see §Conventions). */
const FACINGS = [
  { name: 'south', axis: 'Towards positive Z' },
  { name: 'west', axis: 'Towards negative X' },
  { name: 'north', axis: 'Towards negative Z' },
  { name: 'east', axis: 'Towards positive X' },
];

function facingOf(yaw) {
  const deg = ((num(yaw, 0) * 180 / Math.PI) % 360 + 360) % 360;
  return FACINGS[Math.round(deg / 90) % 4];
}

function degrees(rad) {
  let d = num(rad, 0) * 180 / Math.PI;
  d = ((d % 360) + 540) % 360 - 180;
  return d.toFixed(1);
}

function heldNameOf(player) {
  if (!player) return null;
  const direct = player.heldItemName;
  if (typeof direct === 'string' && direct) return direct;
  const stack = player.inventory?.held;
  if (stack && !stack.isEmpty) return stack.name ?? null;
  return null;
}

/**
 * Story modules are written in parallel, so the boss bar is read structurally
 * rather than by one hard-coded shape.
 */
function readBossBar(story) {
  if (!story) return null;
  let raw = story.bossBar ?? story.bossbar ?? story.boss ?? null;
  if (!raw && typeof story.getBossBar === 'function') raw = story.getBossBar();
  if (!raw || typeof raw !== 'object') return null;
  if (raw.visible === false || raw.active === false || raw.dead === true) return null;

  let progress = raw.progress ?? raw.percent ?? raw.fraction;
  if (!Number.isFinite(Number(progress))) {
    const hp = num(raw.health ?? raw.hp, NaN);
    const max = num(raw.maxHealth ?? raw.maxHp ?? raw.max, NaN);
    progress = Number.isFinite(hp) && Number.isFinite(max) && max > 0 ? hp / max : NaN;
  }
  if (!Number.isFinite(Number(progress))) return null;

  return {
    name: String(raw.name ?? raw.title ?? raw.label ?? raw.display ?? 'Boss'),
    // The siege bar carries its wave count and countdown here; without it the
    // player has no way to read how much of the night is left.
    subtitle: String(raw.subtitle ?? raw.status ?? raw.desc ?? ''),
    progress: clamp(Number(progress), 0, 1),
    color: Number.isFinite(Number(raw.color)) ? Number(raw.color) : 0xc03fd8,
  };
}

function questTitleOf(story) {
  if (!story) return '';
  const quest = story.currentQuest ?? null;
  if (quest && typeof quest === 'object') {
    return String(quest.title ?? quest.name ?? quest.display ?? '');
  }
  return typeof story.progressText === 'string' ? story.progressText : '';
}

/** Objectives may be plain strings or records; both render the same way. */
function objectiveLine(o) {
  if (o == null) return '';
  if (typeof o === 'string') return `§f▶ ${o}`;
  const text = String(o.text ?? o.title ?? o.label ?? o.desc ?? o.description ?? o.name ?? '');
  if (!text) return '';
  const done = !!(o.done ?? o.complete ?? o.completed);
  if (done) return `§a✓ §7§m${text}`;
  const have = Number(o.progress ?? o.count ?? o.have);
  const need = Number(o.target ?? o.goal ?? o.need ?? o.max);
  const counter = Number.isFinite(have) && Number.isFinite(need) && need > 1
    ? ` §7${clamp(Math.floor(have), 0, need)}/${need}`
    : '';
  return `§f▶ ${text}${counter}`;
}

// ================================================================= the HUD

export class Hud {
  constructor(game = null) {
    this.game = game;

    /** Toggled by the 'objectives' key binding in game.js. */
    this.showObjectives = true;

    this.time = 0;
    this.ticks = 0;
    this._tickAccum = 0;

    this.flashTime = 0;          // seconds of the damage blink left
    this.heldNameTime = 0;
    this.lastHeldName = undefined;
    this._trackerBottom = 4;
  }

  // ---------------------------------------------------------------- callbacks

  /** game.onPlayerHurt -> the hearts blink white for half a second. */
  onHurt() {
    this.flashTime = 0.5;
  }

  /** game.onHeldItemChanged -> re-show the item name even for the same item. */
  onHeldItemChanged() {
    this.heldNameTime = HELD_NAME_TIME;
    this.lastHeldName = undefined;
  }

  // ---------------------------------------------------------------- frame

  render(ctx, game, w, h, dt) {
    const g = game || this.game;
    const step = clamp(num(dt, 0), 0, 0.25);
    this.time += step;
    this.flashTime = Math.max(0, this.flashTime - step);

    // A 20 Hz beat for blinks, jitter and the §k obfuscation shuffle.
    this._tickAccum += step;
    let guard = 0;
    while (this._tickAccum >= 0.05 && guard++ < 8) {
      this._tickAccum -= 0.05;
      this.ticks++;
      tickObfuscation();
    }

    ensureSprites();
    const player = g?.player ?? null;

    this.drawCrosshair(ctx, g, w, h);
    this.drawHotbar(ctx, player, w, h);
    if (player) {
      this.drawStatusBars(ctx, player, w, h);
      this.drawExperience(ctx, player, w, h);
      this.drawHeldItemName(ctx, player, w, h, step);
    }
    this.drawBossBar(ctx, g, w, h);
    this.drawObjectives(ctx, g, w, h);
    chat.render(ctx, g, w, h, step);
    this.drawToasts(ctx, g, w, h);
    if (g?.debugOverlay) this.drawDebug(ctx, g, w, h);
    this.drawSubtitles(ctx, g, w, h);

    chat.poll(g);
  }

  // ---------------------------------------------------------------- 1. crosshair

  drawCrosshair(ctx, g, w, h) {
    if (g?.player?.perspective) return;      // hidden in third person, as in vanilla
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    ctx.save();
    // 'difference' inverts the crosshair against whatever is behind it, so it
    // stays visible over both a snow field and a cave wall.
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 4, cy, 9, 1);
    ctx.fillRect(cx, cy - 4, 1, 9);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 2. hotbar

  drawHotbar(ctx, player, w, h) {
    const x = Math.round((w - HOTBAR_W) / 2);
    const y = Math.round(h - HOTBAR_H);

    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, HOTBAR_W, HOTBAR_H);
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(x + 1, y + 1, HOTBAR_W - 2, HOTBAR_H - 2);

    for (let i = 0; i < 9; i++) {
      const sx = x + 1 + i * SLOT;
      const sy = y + 1;
      ctx.fillStyle = '#373737';
      ctx.fillRect(sx, sy, SLOT, 1);
      ctx.fillRect(sx, sy, 1, SLOT);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(sx + 1, sy + SLOT - 1, SLOT - 1, 1);
      ctx.fillRect(sx + SLOT - 1, sy + 1, 1, SLOT - 1);
    }

    const inv = player?.inventory ?? null;
    const selected = clamp(Math.floor(num(inv?.selected ?? player?.selectedSlot, 0)), 0, 8);

    // The 24x24 selector overhangs the 22x22 slot cell by one pixel each side.
    const fx = x - 1 + selected * SLOT;
    const fy = y - 1;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    strokeRect1(ctx, fx, fy, 24, 24);
    ctx.fillStyle = '#dedede';
    strokeRect1(ctx, fx + 1, fy + 1, 22, 22);
    ctx.fillStyle = '#b0b0b0';
    strokeRect1(ctx, fx + 2, fy + 2, 20, 20);

    if (!inv?.get) return;
    for (let i = 0; i < 9; i++) {
      const stack = inv.get(i);
      if (!stack || stack.isEmpty) continue;
      icons?.drawStack?.(ctx, stack, x + 3 + i * SLOT, y + 3);
    }
  }

  // ------------------------------------------------- 3-6. health, food, armour, air

  drawStatusBars(ctx, player, w, h) {
    const s = ensureSprites();
    const left = Math.round(w / 2) - 91;
    const right = Math.round(w / 2) + 91;
    const rowY = Math.round(h - 39);

    const maxHealth = Math.max(1, num(player.maxHealth, 20));
    const health = clamp(num(player.health, 0), 0, maxHealth);
    const hearts = Math.max(1, Math.ceil(maxHealth / 2));
    const rows = Math.ceil(hearts / 10);
    const rowPitch = rows > 1 ? Math.max(3, 10 - (rows - 2)) : 10;
    const low = health <= 4;
    // Vanilla toggles the blink every five ticks, so two flashes per hit.
    const flash = this.flashTime > 0 && Math.floor(this.flashTime * 4) % 2 === 0;

    for (let i = 0; i < hearts; i++) {
      const row = Math.floor(i / 10);
      const col = i % 10;
      // Vanilla jitters low hearts a pixel; a hash of the tick keeps it stable
      // within a frame instead of shimmering at the render rate.
      const jitter = low ? (hash2(this.ticks, i) & 1) : 0;
      const hx = left + col * ICON_PITCH;
      const hy = rowY - row * rowPitch + jitter;

      ctx.drawImage(flash ? s.heartEmptyFlash : s.heartEmpty, hx, hy);
      if (health >= i * 2 + 2) ctx.drawImage(flash ? s.heartFullFlash : s.heartFull, hx, hy);
      else if (health > i * 2) ctx.drawImage(flash ? s.heartHalfFlash : s.heartHalf, hx, hy);
    }

    const food = clamp(num(player.food, 20), 0, 20);
    for (let i = 0; i < 10; i++) {
      const fx = right - i * ICON_PITCH - ICON;
      ctx.drawImage(s.foodEmpty, fx, rowY);
      if (food >= i * 2 + 2) ctx.drawImage(s.foodFull, fx, rowY);
      else if (food > i * 2) ctx.drawImage(s.foodHalf, fx, rowY);
    }

    const points = clamp(
      typeof player.armorPoints === 'function' ? num(player.armorPoints(), 0) : num(player.armorPoints, 0),
      0, 20,
    );
    if (points > 0) {
      const ay = rowY - 10;
      for (let i = 0; i < 10; i++) {
        const ax = left + i * ICON_PITCH;
        ctx.drawImage(s.armorEmpty, ax, ay);
        if (points >= i * 2 + 2) ctx.drawImage(s.armorFull, ax, ay);
        else if (points > i * 2) ctx.drawImage(s.armorHalf, ax, ay);
      }
    }

    const maxAir = Math.max(1, num(PLAYER?.MAX_AIR_TICKS, 300));
    const air = clamp(num(player.air, maxAir), 0, maxAir);
    if (air < maxAir) {
      const by = rowY - 10;
      const full = Math.max(0, Math.ceil(((air - 2) * 10) / maxAir));
      const popping = Math.max(0, Math.ceil((air * 10) / maxAir) - full);
      for (let i = 0; i < full + popping && i < 10; i++) {
        ctx.drawImage(i < full ? s.bubble : s.bubblePop, right - i * ICON_PITCH - ICON, by);
      }
    }
  }

  // ---------------------------------------------------------------- 7. XP bar

  drawExperience(ctx, player, w, h) {
    const left = Math.round(w / 2) - 91;
    const y = Math.round(h - 29);

    ctx.fillStyle = '#000000';
    ctx.fillRect(left, y, HOTBAR_W, 5);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(left + 1, y + 1, HOTBAR_W - 2, 3);

    const progress = clamp(num(player.xpProgress, 0), 0, 1);
    const fill = Math.round(progress * (HOTBAR_W - 2));
    if (fill > 0) {
      ctx.fillStyle = '#7fdd35';
      ctx.fillRect(left + 1, y + 1, fill, 3);
      ctx.fillStyle = '#a8ff62';
      ctx.fillRect(left + 1, y + 1, fill, 1);
    }

    const level = Math.max(0, Math.floor(num(player.xpLevel, 0)));
    if (level <= 0) return;
    const text = String(level);
    const cx = Math.round(w / 2);
    const ty = Math.round(h - 35);
    for (const [dx, dy] of OUTLINE) {
      drawText(ctx, text, cx + dx, ty + dy, { color: 0x000000, shadow: false, align: 'center' });
    }
    drawText(ctx, text, cx, ty, { color: 0x80ff20, shadow: false, align: 'center' });
  }

  // ---------------------------------------------------------------- 8. held item

  drawHeldItemName(ctx, player, w, h, dt) {
    const name = heldNameOf(player);
    if (name !== this.lastHeldName) {
      this.lastHeldName = name;
      this.heldNameTime = name ? HELD_NAME_TIME : 0;
    }
    if (!name || this.heldNameTime <= 0) return;

    this.heldNameTime = Math.max(0, this.heldNameTime - dt);
    const alpha = clamp(this.heldNameTime / HELD_NAME_FADE, 0, 1);
    if (alpha <= 0.01) return;

    const item = getItem(name);
    const label = item?.display || name;
    const color = RARITY_COLOR[item?.rarity ?? 0] ?? 0xffffff;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawText(ctx, label, Math.round(w / 2), Math.round(h - 59), {
      color, shadow: true, align: 'center',
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 9. boss bar

  drawBossBar(ctx, g, w, h) {
    const bar = readBossBar(g?.story);
    if (!bar) return;

    const x = Math.round((w - HOTBAR_W) / 2);
    const y = 14;
    drawText(ctx, bar.name, Math.round(w / 2), y - 11, { color: 0xffffff, shadow: true, align: 'center' });

    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, HOTBAR_W, 7);
    ctx.fillStyle = '#232330';
    ctx.fillRect(x + 1, y + 1, HOTBAR_W - 2, 5);

    const fill = Math.round(bar.progress * (HOTBAR_W - 2));
    if (fill > 0) {
      ctx.fillStyle = cssHex(bar.color);
      ctx.fillRect(x + 1, y + 1, fill, 5);
      ctx.fillStyle = cssHex(mixHex(bar.color, 0xffffff, 0.45));
      ctx.fillRect(x + 1, y + 1, fill, 1);
    }

    if (bar.subtitle) {
      drawText(ctx, fit(bar.subtitle, HOTBAR_W), Math.round(w / 2), y + 9, {
        color: 0xc8c8c8, shadow: true, align: 'center',
      });
    }
  }

  // ---------------------------------------------------------------- 10. objectives

  drawObjectives(ctx, g, w, h) {
    this._trackerBottom = 4;
    if (!this.showObjectives) return;
    const story = g?.story;
    if (!story) return;

    const lines = [];
    const title = questTitleOf(story);
    if (title) lines.push(`§e§l${title}`);
    const objectives = Array.isArray(story.objectives) ? story.objectives : [];
    for (const o of objectives.slice(0, 6)) {
      const line = objectiveLine(o);
      if (line) lines.push(line);
    }
    if (!lines.length) return;

    const maxW = Math.max(60, Math.floor(w / 2) - 12);
    let boxW = 0;
    for (let i = 0; i < lines.length; i++) {
      lines[i] = fit(lines[i], maxW);
      boxW = Math.max(boxW, measureFormatted(lines[i]));
    }

    const x = Math.round(w - boxW - 6);
    const y = 8;
    const boxH = lines.length * LINE_HEIGHT + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 4, y - 4, boxW + 8, boxH);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    strokeRect1(ctx, x - 4, y - 4, boxW + 8, boxH);

    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, lines[i], x, y + i * LINE_HEIGHT, { color: 0xffffff, shadow: true });
    }
    this._trackerBottom = y - 4 + boxH + 4;
  }

  // ---------------------------------------------------------------- 11. toasts

  drawToasts(ctx, g, w, h) {
    const toasts = Array.isArray(g?.toasts) ? g.toasts : null;
    if (!toasts || !toasts.length) return;

    let y = Math.max(4, Math.round(this._trackerBottom));
    for (let i = 0; i < toasts.length && i < 4; i++) {
      const t = toasts[i];
      if (!t) continue;
      const life = Math.max(1, num(t.life, 100));
      const age = clamp(num(t.age, 0), 0, life);
      // Slide in over the first third of a second, back out over the last.
      const slide = clamp(Math.min(age / 7, (life - age) / 7), 0, 1);
      if (slide <= 0) continue;
      const x = Math.round(w - 4 - TOAST_W * slide);

      ctx.fillStyle = 'rgba(12,12,18,0.88)';
      ctx.fillRect(x, y, TOAST_W, TOAST_H);
      ctx.fillStyle = '#6f6f8a';
      strokeRect1(ctx, x, y, TOAST_W, TOAST_H);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 1, y + 1, TOAST_W - 2, 1);

      const inner = TOAST_W - 12;
      drawText(ctx, fit(String(t.title ?? ''), inner), x + 6, y + 7, { color: 0xffe066, shadow: true });
      if (t.subtitle) {
        drawText(ctx, fit(String(t.subtitle), inner), x + 6, y + 19, { color: 0xdcdcdc, shadow: true });
      }
      y += TOAST_H + 4;
      if (y > h - 60) break;
    }
  }

  // ---------------------------------------------------------------- 12. F3 overlay

  drawDebug(ctx, g, w, h) {
    const half = Math.max(40, Math.floor(w / 2) - 6);
    const left = this.debugLeft(g);
    const right = this.debugRight(g);

    for (let i = 0; i < left.length; i++) {
      const line = fit(left[i], half);
      if (!line) continue;
      const y = 2 + i * LINE_HEIGHT;
      if (y > h - 12) break;
      const tw = measureFormatted(line);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(1, y - 1, tw + 2, LINE_HEIGHT);
      drawText(ctx, line, 2, y, { color: 0xe0e0e0, shadow: false });
    }

    for (let i = 0; i < right.length; i++) {
      const line = fit(right[i], half);
      if (!line) continue;
      const y = 2 + i * LINE_HEIGHT;
      if (y > h - 12) break;
      const tw = measureFormatted(line);
      const x = w - 2 - tw;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 1, y - 1, tw + 2, LINE_HEIGHT);
      drawText(ctx, line, x, y, { color: 0xe0e0e0, shadow: false });
    }
  }

  debugLeft(g) {
    const lines = [];
    const fps = Math.round(num(g?.fps, 0));
    const ms = num(g?.frameTimeMs, NaN);
    lines.push(`SowmiCraft §e${fps} fps§r${Number.isFinite(ms) ? ` (${ms.toFixed(1)} ms)` : ''}`);

    const stats = g?.renderer?.stats ?? null;
    if (stats) {
      const mesh = num(stats.meshTimeMs, 0);
      lines.push(`C: ${num(stats.chunks, 0)}  Q: ${num(stats.quads, 0)}  D: ${num(stats.drawCalls, 0)}  M: ${mesh.toFixed(1)} ms`);
    }

    const world = g?.world ?? null;
    lines.push(`Chunks: ${world?.chunks?.size ?? 0} loaded`);
    lines.push(`E: ${world?.entities?.length ?? 0}  P: ${num(g?.particles?.count, 0)}`);
    lines.push('');

    const p = g?.player ?? null;
    if (!p) {
      lines.push('No player');
      return lines;
    }

    const px = num(p.x, 0), py = num(p.y, 0), pz = num(p.z, 0);
    const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
    lines.push(`XYZ: ${px.toFixed(3)} / ${py.toFixed(3)} / ${pz.toFixed(3)}`);
    lines.push(`Block: ${bx} ${by} ${bz}`);
    lines.push(`Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`);

    const face = facingOf(p.yaw);
    lines.push(`Facing: ${face.name} (${face.axis}) (${degrees(p.yaw)} / ${degrees(p.pitch)})`);

    if (world) {
      const biome = BIOMES[world.getBiome?.(bx, bz) ?? 0];
      lines.push(`Biome: ${biome?.display ?? 'Unknown'}`);
      const sky = num(world.getSkyLight?.(bx, by, bz), 0);
      const block = num(world.getBlockLight?.(bx, by, bz), 0);
      lines.push(`Light: ${Math.max(sky, block)} (${sky} sky, ${block} block)`);
      lines.push(`Time: ${Math.floor(num(world.timeOfDay, 0))} (${world.isDay ? 'day' : 'night'})`);
    }
    return lines;
  }

  debugRight(g) {
    const lines = [];
    lines.push(`Display: ${Math.round(num(g?.width, 0))}x${Math.round(num(g?.height, 0))} (GUI ${num(g?.guiScale, 1)}x)`);
    lines.push(`Render distance: ${settings.get('renderDistance')} chunks`);
    lines.push(`Graphics: ${settings.format('graphics')}`);

    const mem = typeof performance !== 'undefined' ? performance.memory : null;
    if (mem && Number.isFinite(mem.usedJSHeapSize)) {
      const used = mem.usedJSHeapSize / 1048576;
      const cap = Math.max(1, (mem.jsHeapSizeLimit || mem.totalJSHeapSize || 0) / 1048576);
      lines.push(`Mem: ${Math.round((used / cap) * 100)}% ${Math.round(used)}/${Math.round(cap)} MB`);
    } else {
      lines.push('Mem: unavailable');
    }
    lines.push('');

    const info = g?.glInfo ?? null;
    lines.push(info?.renderer ? String(info.renderer) : 'GPU: unknown');
    if (info?.vendor) lines.push(String(info.vendor));
    if (info?.version) lines.push(String(info.version));
    lines.push('');

    const hit = g?.player?.lookingAt ?? null;
    if (hit) {
      const def = BLOCKS[hit.blockId];
      lines.push('§eTargeted Block');
      lines.push(`${hit.x} ${hit.y} ${hit.z}`);
      lines.push(def?.display ?? `id ${hit.blockId}`);
      lines.push(`face ${hit.face}`);
    }
    return lines;
  }

  // ---------------------------------------------------------------- 13. subtitles

  drawSubtitles(ctx, g, w, h) {
    if (!settings.get('showSubtitles')) return;
    const subs = Array.isArray(g?.subtitles) ? g.subtitles : null;
    if (!subs || !subs.length) return;

    const baseY = Math.round(h - 64);
    for (let i = 0; i < subs.length && i < 4; i++) {
      const s = subs[subs.length - 1 - i];
      if (!s) continue;
      const alpha = clamp(1 - num(s.age, 0) / 60, 0, 1);
      if (alpha <= 0.02) continue;
      const text = String(s.text ?? '');
      if (!text) continue;
      const tw = measureFormatted(text);
      const x = Math.round(w - tw - 10);
      const y = baseY - i * (LINE_HEIGHT + 2);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 3, y - 2, tw + 6, LINE_HEIGHT + 2);
      drawText(ctx, text, x, y, { color: 0xffffff, shadow: true });
      ctx.restore();
    }
  }
}
