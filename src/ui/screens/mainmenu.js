// The title screen: a slow-panning procedural dusk panorama, the SOWMICRAFT
// wordmark, a rotating yellow splash, and the four ways into the game.

import { Screen } from '../screen.js';
import { Button, BUTTON_W, BUTTON_H } from '../widgets.js';
import { drawText, measure } from '../font.js';
import { drawWordmark } from '../logo.js';
import { hash2f } from '../../core/rng.js';
import { clamp, TAU, DEG } from '../../core/math.js';
import { WorldSelectScreen } from './worldselect.js';
import { OptionsScreen } from './options.js';

const VERSION = 'SowmiCraft 1.0';
const COPYRIGHT = '© 2026 SowmiCraft — every pixel made in code';

/** The story world is authored, so its seed is fixed rather than rolled. */
const STORY_SEED = 0x50574d49;

/** Original splashes, vanilla voice — playful, self-aware, occasionally absurd. */
export const SPLASHES = [
  'Now with 100% more blocks!',
  'Dig responsibly!',
  'Chunk by chunk!',
  'Powered entirely by dirt!',
  'No textures were harmed!',
  'Every pixel hand-placed!',
  'Creepers are just shy!',
  'Mind the gravel!',
  'It compiles in your browser!',
  'Zero downloads, all caves!',
  'The cave is friendly. Probably.',
  'Ember-approved!',
  'Baked at twenty ticks per second!',
  'Torches sold separately!',
  'Contains trace amounts of noise!',
  'Squares all the way down!',
  'Punch the tree. Trust us.',
  'Try turning the render distance down!',
  'Handcrafted, then hand-crafted!',
  'Gravity is only a suggestion!',
  'Now featuring: sky!',
  'Something hollow stirs below!',
  'Bring a shovel!',
  'Lava is not a shortcut!',
  'Made of maths and stubbornness!',
  'Sixty-four is a lucky number!',
  'Do not eat the redstone!',
  'Sheep approve this message!',
  'Ten minutes, well spent!',
  'Beware the long night!',
  'Save often, mine deeper!',
  'Water always finds a way!',
  'Somebody left the beacon off!',
  'Written from scratch, twice!',
  'Bedrock is not a challenge!',
  'The font is a string of hashes!',
  'Please do not mine the pedestal!',
  'Sowmi says hello!',
];

/** Layered hills. Nearer layers are darker, taller and pan faster. */
const RIDGES = [
  { color: '#33375f', base: 0.685, amp: 14, period: 560, speed: 2.5, trees: 0, seed: 11 },
  { color: '#262a49', base: 0.755, amp: 18, period: 440, speed: 5, trees: 7, seed: 23 },
  { color: '#1a1c33', base: 0.835, amp: 20, period: 340, speed: 9, trees: 11, seed: 37 },
  { color: '#0e0f1d', base: 0.945, amp: 16, period: 250, speed: 16, trees: 15, seed: 53 },
];

/** A periodic ridge profile: four hashed sine harmonics, so it tiles exactly. */
function ridgeProfile(u, seed) {
  let v = 0;
  for (let k = 1; k <= 4; k++) v += Math.sin(u * TAU * k + hash2f(k, seed) * TAU) / k;
  return v * 0.24 + 0.5;
}

function ridgeY(u, layer, h) {
  return h * layer.base - ridgeProfile(u, layer.seed) * layer.amp;
}

/** A blocky silhouette tree: trunk plus a stepped canopy. */
function drawTree(ctx, x, groundY, size, pine) {
  const t = Math.max(1, Math.round(size * 0.18));
  ctx.fillRect(x - Math.ceil(t / 2), groundY - size, t, size + 2);
  if (pine) {
    for (let i = 0; i < 3; i++) {
      const wdt = Math.round(size * (0.62 - i * 0.16));
      const yy = groundY - size - Math.round(size * (0.15 + i * 0.32));
      ctx.fillRect(x - wdt, yy, wdt * 2, Math.max(2, Math.round(size * 0.3)));
    }
  } else {
    const r = Math.round(size * 0.55);
    ctx.fillRect(x - r, groundY - size - r, r * 2, Math.round(r * 1.4));
    ctx.fillRect(x - r + 2, groundY - size - r - 3, r * 2 - 4, 4);
  }
}

export class MainMenuScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = '';
    this.pausesGame = false;
    this.blursBackground = false;
    this.closeOnEscape = false;
    this.mode = 'main';       // 'main' | 'quit' | 'farewell'
    this.splash = pickSplash();
    this.logoRect = null;
  }

  setMode(mode) {
    this.mode = mode;
    this.layout(this.width, this.height);
  }

  build(w, h) {
    const cx = Math.round(w / 2 - BUTTON_W / 2);

    if (this.mode === 'quit') {
      const y = Math.round(h / 2);
      this.add(new Button({
        x: cx, y, w: BUTTON_W, h: BUTTON_H, text: 'Quit Game',
        onClick: () => this.quit(),
      }));
      this.add(new Button({
        x: cx, y: y + 24, w: BUTTON_W, h: BUTTON_H, text: 'Cancel',
        onClick: () => this.setMode('main'),
      }));
      return;
    }

    if (this.mode === 'farewell') {
      this.add(new Button({
        x: cx, y: Math.round(h / 2 + 20), w: BUTTON_W, h: BUTTON_H, text: 'Back to Title',
        onClick: () => this.setMode('main'),
      }));
      return;
    }

    const base = Math.min(Math.round(h / 4) + 48, h - 96);
    this.add(new Button({
      x: cx, y: base, w: BUTTON_W, h: BUTTON_H, text: 'Story Mode',
      tooltip: 'The Ember of Sowmi — about ten minutes, start to finish.',
      onClick: () => this.startStory(),
    }));
    this.add(new Button({
      x: cx, y: base + 24, w: BUTTON_W, h: BUTTON_H, text: 'Singleplayer',
      tooltip: 'Load a saved world, or generate a new one.',
      onClick: () => this.open(new WorldSelectScreen(this.game)),
    }));
    this.add(new Button({
      x: cx, y: base + 48, w: BUTTON_W, h: BUTTON_H, text: 'Options...',
      onClick: () => this.open(new OptionsScreen(this.game)),
    }));
    this.add(new Button({
      x: cx, y: base + 72, w: BUTTON_W, h: BUTTON_H, text: 'Quit Game',
      onClick: () => this.setMode('quit'),
    }));
  }

  open(screen) {
    screen.parent = this;
    this.game?.openScreen?.(screen);
  }

  startStory() {
    this.game?.startWorld?.({
      name: 'Emberhold', seed: STORY_SEED, story: true, difficulty: 'normal',
    });
  }

  quit() {
    // A browser tab cannot always close itself; when it refuses, say goodbye
    // properly instead of pretending the click did nothing.
    try { window.close(); } catch { /* blocked by the browser */ }
    this.setMode('farewell');
  }

  // ---------------------------------------------------------------- panorama

  renderPanorama(ctx, w, h, t) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0d1430');
    sky.addColorStop(0.38, '#2c2f61');
    sky.addColorStop(0.62, '#7c4a6d');
    sky.addColorStop(0.8, '#d2703f');
    sky.addColorStop(1, '#f0b25e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars fade out toward the warm horizon.
    for (let i = 0; i < 70; i++) {
      const sx = hash2f(i, 91) * w;
      const sy = hash2f(i, 92) * h * 0.5;
      const twinkle = 0.35 + 0.35 * Math.sin(t * 1.6 + hash2f(i, 93) * TAU);
      ctx.fillStyle = `rgba(255,255,235,${(twinkle * (1 - sy / (h * 0.55))).toFixed(3)})`;
      ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }

    // The setting sun, low and hazy.
    const sunX = Math.round(w * 0.74);
    const sunY = Math.round(h * 0.63);
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, Math.max(40, h * 0.28));
    glow.addColorStop(0, 'rgba(255,214,140,0.55)');
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd98f';
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.max(6, h * 0.045), 0, TAU);
    ctx.fill();

    for (const layer of RIDGES) {
      const off = (t * layer.speed) % layer.period;
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) {
        ctx.lineTo(x, Math.round(ridgeY((x + off) / layer.period, layer, h)));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      for (let i = 0; i < layer.trees; i++) {
        const u = (i + 0.5) / layer.trees + (hash2f(i, layer.seed + 1) - 0.5) / layer.trees;
        const gy = ridgeY(u, layer, h);
        const size = 7 + hash2f(i, layer.seed + 2) * 8;
        const pine = hash2f(i, layer.seed + 3) > 0.45;
        let x = u * layer.period - off;
        x = ((x % layer.period) + layer.period) % layer.period;
        for (let px = x - layer.period; px < w + layer.period; px += layer.period) {
          if (px < -24 || px > w + 24) continue;
          drawTree(ctx, Math.round(px), Math.round(gy) + 1, size, pine);
        }
      }
    }

    // A vignette settles the whole thing down behind the buttons.
    const vig = ctx.createLinearGradient(0, 0, 0, h);
    vig.addColorStop(0, 'rgba(0,0,0,0.35)');
    vig.addColorStop(0.45, 'rgba(0,0,0,0.05)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  renderSplash(ctx, t) {
    const rect = this.logoRect;
    if (!rect) return;
    const ax = rect.x + rect.w - 14;
    const ay = rect.y + rect.h - 2;
    const width = measure(this.splash);
    const fit = clamp(120 / Math.max(30, width + 16), 0.65, 1.5);
    const pulse = 1 + Math.abs(Math.sin(t * 2)) * 0.05;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-20 * DEG);
    ctx.scale(fit * pulse, fit * pulse);
    drawText(ctx, this.splash, 0, -4, { color: 0xffff00, shadow: true, align: 'center' });
    ctx.restore();
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    const w = this.width, h = this.height, t = this.time;

    this.renderPanorama(ctx, w, h, t);

    const logoW = Math.min(w - 40, 320);
    this.logoRect = drawWordmark(ctx, 'SOWMICRAFT', w / 2, Math.round(h * 0.15), logoW);
    this.renderSplash(ctx, t);

    if (this.mode === 'quit') {
      drawText(ctx, 'Quit SowmiCraft?', w / 2, Math.round(h / 2) - 26,
        { color: 0xffffff, shadow: true, align: 'center' });
      drawText(ctx, 'Unsaved progress in an open world is saved first.', w / 2, Math.round(h / 2) - 14,
        { color: 0xa0a0a0, shadow: true, align: 'center' });
    } else if (this.mode === 'farewell') {
      drawText(ctx, 'Thanks for playing SowmiCraft.', w / 2, Math.round(h / 2) - 14,
        { color: 0xffffff, shadow: true, align: 'center' });
      drawText(ctx, 'Your worlds are still here whenever you come back.', w / 2, Math.round(h / 2),
        { color: 0xa0a0a0, shadow: true, align: 'center' });
    }

    this.renderWidgets(ctx, mx, my, dt);

    drawText(ctx, VERSION, 2, h - 10, { color: 0xffffff, shadow: true });
    drawText(ctx, COPYRIGHT, w - 2, h - 10, { color: 0xffffff, shadow: true, align: 'right' });

    this.renderTooltip(ctx, mx, my);
  }
}

/** Splash choice is cosmetic, so a clock-derived pick is fine here. */
function pickSplash() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month === 12 && day === 25) return 'Snow layers all the way down!';
  if (month === 1 && day === 1) return 'New year, new render distance!';
  if (month === 10 && day === 31) return 'Something is scratching at the door!';
  return SPLASHES[Math.floor(hash2f(now.getTime() & 0xffff, (now.getTime() >>> 16) & 0xffff) * SPLASHES.length) % SPLASHES.length];
}
