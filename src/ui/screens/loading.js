// The loading screen: dirt background, the wordmark, a bordered progress bar
// and a rotating tip. game.js drives it with setProgress(fraction, stageName).

import { Screen } from '../screen.js';
import { drawText, wrapText, LINE_HEIGHT } from '../font.js';
import { drawWordmark } from '../logo.js';
import { clamp } from '../../core/math.js';

const TIPS = [
  'Punching a tree is a perfectly valid opening move.',
  'Torches keep the dark things out. Carry more than you think you need.',
  'Sneak on a ledge and you will not walk off it.',
  'Coal makes torches. Torches make everything else survivable.',
  'A crafting table turns two-by-two thinking into three-by-three thinking.',
  'Water breaks a fall. Lava does the opposite.',
  'Stone needs a pickaxe, wood likes an axe, dirt prefers a shovel.',
  'Sleep is not implemented. Neither is giving up.',
  'Gravel falls. Do not stand under it while you dig.',
  'Diamonds hide deep, and never near lava by accident.',
  'The seed is the whole world in one number. Write it down.',
  'Creepers are quiet. That is the entire problem.',
  'F3 shows what the engine is really thinking.',
  'Every texture here was painted by code, not by a brush.',
  'If a cave sounds bigger than it looks, it is.',
  'Emberhold has been dark for three nights. Somebody should fix that.',
];

const STAGE_FALLBACK = 'Building the world';

export class LoadingScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = '';
    this.pausesGame = true;
    this.blursBackground = false;
    this.closeOnEscape = false;

    this.progress = 0;
    this.shown = 0;          // smoothed, so the bar never jumps
    this.stage = STAGE_FALLBACK;
    // Start somewhere different each minute so a reload does not repeat itself.
    this.tipIndex = Math.floor(Date.now() / 60000) % TIPS.length;
    this.tipTimer = 0;
    this.done = false;
  }

  /** Called from the loaders: fraction 0..1 plus a human stage name. */
  setProgress(progress, stage) {
    this.progress = clamp(Number(progress) || 0, 0, 1);
    if (stage) this.stage = String(stage);
    if (this.progress >= 1) this.done = true;
  }

  build(w, h) {
    // Nothing interactive — the loading screen is pure feedback.
  }

  render(ctx, mx, my, dt) {
    const step = dt || 0;
    this.time += step;
    const w = this.width, h = this.height;

    this.renderBackground(ctx, w, h);

    // Exponential smoothing, the same trick the vanilla overlay uses.
    this.shown += (this.progress - this.shown) * Math.min(1, step * 6);

    const logoW = Math.min(w - 40, 300);
    drawWordmark(ctx, 'SOWMICRAFT', w / 2, Math.round(h * 0.17), logoW);

    const barW = Math.round(clamp(w - 80, 120, 260));
    const barH = 10;
    const barX = Math.round(w / 2 - barW / 2);
    const barY = Math.round(h * 0.70);

    // 2px border, dark interior, bright fill.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#161616';
    ctx.fillRect(barX + 2, barY + 2, barW - 4, barH - 4);
    const fill = Math.round((barW - 6) * clamp(this.shown, 0, 1));
    if (fill > 0) {
      const g = ctx.createLinearGradient(0, barY + 3, 0, barY + barH - 3);
      g.addColorStop(0, '#ffd79a');
      g.addColorStop(1, '#e8913c');
      ctx.fillStyle = g;
      ctx.fillRect(barX + 3, barY + 3, fill, barH - 6);
    }

    const pct = Math.round(clamp(this.shown, 0, 1) * 100);
    drawText(ctx, `${this.stage}…`, w / 2, barY - 16, { color: 0xffffff, shadow: true, align: 'center' });
    drawText(ctx, `${pct}%`, w / 2, barY + barH + 6, { color: 0xa0a0a0, shadow: true, align: 'center' });

    this.tipTimer += step;
    if (this.tipTimer > 4.5) {
      this.tipTimer = 0;
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    }
    // Cross-fade the tip so it changes without a blink.
    const fade = clamp(Math.min(this.tipTimer, 4.5 - this.tipTimer) * 3, 0, 1);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * (0.35 + 0.65 * fade);
    const lines = wrapText(TIPS[this.tipIndex], Math.max(120, w - 40));
    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, lines[i], w / 2, h - 28 + i * LINE_HEIGHT, { color: 0xdcdcdc, shadow: true, align: 'center' });
    }
    ctx.globalAlpha = prevAlpha;

    drawText(ctx, 'SowmiCraft', 4, h - 11, { color: 0x707070, shadow: true });
  }
}
