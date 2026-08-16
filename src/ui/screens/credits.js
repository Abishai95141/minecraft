// The end credits: a slow upward scroll over black, shown once the Ember is
// relit. Hold the mouse or Space to hurry it along.

import { Screen } from '../screen.js';
import { Button, BUTTON_H } from '../widgets.js';
import { drawText, wrapText, LINE_HEIGHT } from '../font.js';
import { drawWordmark } from '../logo.js';
import { hash2f } from '../../core/rng.js';
import { clamp, TAU } from '../../core/math.js';

const SPEED = 24;          // GUI px per second
const FAST = 5;            // multiplier while held

const H1 = { color: 0xffd479, scale: 2, gap: 16 };
const H2 = { color: 0xffd479, scale: 1, gap: 10 };
const P = { color: 0xdcdcdc, scale: 1, gap: 4 };
const DIM = { color: 0x8a8a8a, scale: 1, gap: 4 };
const GAP = { color: 0x000000, scale: 1, gap: 16, blank: true };

const CREDITS = [
  { text: 'The Ember of Sowmi', ...H1 },
  { text: 'a story in seven chapters', ...DIM },
  GAP,
  { text: 'WORLD', ...H2 },
  { text: 'Terrain, caves and the shape of the land', ...P },
  { text: 'Biomes, weather tints and the sea', ...P },
  { text: 'Light that floods, decays and remembers', ...P },
  GAP,
  { text: 'THINGS THAT MOVE', ...H2 },
  { text: 'Players, mobs and the physics they share', ...P },
  { text: 'Goals, panic, hunger and pathfinding', ...P },
  { text: 'Every animation, one cuboid at a time', ...P },
  GAP,
  { text: 'THE LOOK', ...H2 },
  { text: 'Two hundred textures, painted in code', ...P },
  { text: 'A bitmap font written as string art', ...P },
  { text: 'Chunk meshing, smooth light and ambient occlusion', ...P },
  { text: 'Sky, clouds, particles and the wordmark above', ...P },
  GAP,
  { text: 'THE SOUND', ...H2 },
  { text: 'Oscillators, noise and envelopes — no samples', ...P },
  { text: 'Original music in F Lydian, played slowly', ...P },
  GAP,
  { text: 'EMBERHOLD', ...H2 },
  { text: 'Elder Sowmi, who kept the fire lit', ...P },
  { text: 'Torvin, who never trusted the quiet', ...P },
  { text: 'Mira, who wrote it all down anyway', ...P },
  { text: 'Pim, who followed you into the dark', ...P },
  GAP,
  { text: 'AND THE HOLLOW WARDEN', ...H2 },
  { text: 'who is, at last, asleep', ...DIM },
  GAP,
  GAP,
  { text: 'No files were shipped with this game.', ...P },
  { text: 'Every texture, glyph, skin and sound above', ...DIM },
  { text: 'is generated the moment you open the page.', ...DIM },
  GAP,
  { text: 'A tribute, built from scratch.', ...P },
  { text: 'Thank you for playing.', ...H2 },
];

export class CreditsScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Credits';
    this.pausesGame = true;
    this.blursBackground = false;
    this.closeOnEscape = false;
    this.scroll = 0;
    this.finished = false;
    this.lines = [];
    this.contentHeight = 0;
    this.mouseHeld = false;
  }

  build(w, h) {
    this.layoutLines(w);
    this.add(new Button({
      x: w - 104, y: h - 24, w: 100, h: BUTTON_H, text: 'Back to Title',
      onClick: () => this.finish(),
    }));
  }

  /** Wraps once per width so the scroll loop stays a plain vertical walk. */
  layoutLines(w) {
    const maxW = Math.max(140, Math.min(340, w - 40));
    this.lines = [];
    let y = 0;
    for (const entry of CREDITS) {
      if (entry.blank) { y += entry.gap; continue; }
      const scale = entry.scale ?? 1;
      for (const text of wrapText(entry.text, maxW / scale)) {
        this.lines.push({ text, color: entry.color, scale, y });
        y += LINE_HEIGHT * scale;
      }
      y += entry.gap;
    }
    // Room at the end for the wordmark and a final breath.
    this.contentHeight = y + 90;
  }

  finish() {
    this.finished = true;
    if (this.game?.quitToTitle) this.game.quitToTitle();
    else this.close();
  }

  render(ctx, mx, my, dt) {
    const step = dt || 0;
    this.time += step;
    const w = this.width, h = this.height;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);

    // A quiet starfield, so black is never flat black.
    for (let i = 0; i < 60; i++) {
      const sx = hash2f(i, 301) * w;
      const sy = (hash2f(i, 302) * h * 2 - this.scroll * 0.12) % h;
      const a = 0.25 + 0.25 * Math.sin(this.time * 0.9 + hash2f(i, 303) * TAU);
      ctx.fillStyle = `rgba(200,210,255,${a.toFixed(3)})`;
      ctx.fillRect(Math.round(sx), Math.round(sy < 0 ? sy + h : sy), 1, 1);
    }

    const held = this.mouseHeld || !!this.game?.input?.isDown?.('Space');
    this.scroll += step * SPEED * (held ? FAST : 1);
    const end = this.contentHeight + h * 0.5;
    this.scroll = clamp(this.scroll, 0, end);

    const top = h - this.scroll;
    for (const line of this.lines) {
      const y = top + line.y;
      if (y < -12 || y > h + 4) continue;
      drawText(ctx, line.text, w / 2, y, { color: line.color, shadow: true, align: 'center', scale: line.scale });
    }

    const logoY = top + this.contentHeight - 70;
    if (logoY > -40 && logoY < h + 10) {
      drawWordmark(ctx, 'SOWMICRAFT', w / 2, logoY, Math.min(w - 60, 240));
    }

    if (this.scroll >= end) {
      drawText(ctx, 'The end.', w / 2, Math.round(h / 2) - 4, { color: 0xffd479, shadow: true, align: 'center' });
    }

    this.renderWidgets(ctx, mx, my, dt);
    this.renderTooltip(ctx, mx, my);
  }

  onMouseDown(x, y, button) {
    if (super.onMouseDown(x, y, button)) return true;
    this.holding = true;
    return true;
  }

  onMouseUp(x, y, button) {
    this.holding = false;
    return super.onMouseUp(x, y, button);
  }

  onKeyDown(code, e) {
    if (code === 'Escape') { this.finish(); return true; }
    if (code === 'Space') { this.holding = true; return true; }
    return super.onKeyDown(code, e);
  }

  tick() {
    super.tick();
    // Holding is released by keyup, which screens do not see — decay it here so
    // a tapped Space speeds the scroll for a beat rather than for ever.
    if (this.holding && !this.game?.input?.isDown?.('Space')) this.holding = false;
  }
}
