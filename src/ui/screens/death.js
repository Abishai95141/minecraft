// The death screen: a red wash over the frozen world, the headline at double
// scale, the score, and the two ways forward. Buttons stay dead for a second
// so a panicked click cannot skip past it.

import { Screen } from '../screen.js';
import { Button, BUTTON_W, BUTTON_H } from '../widgets.js';
import { drawText } from '../font.js';

const ARM_TICKS = 20;   // one second, exactly like vanilla

export class DeathScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'You Died!';
    this.pausesGame = true;
    this.blursBackground = false;
    this.closeOnEscape = false;
    this.respawnButton = null;
    this.titleButton = null;
  }

  build(w, h) {
    const x = Math.round(w / 2 - BUTTON_W / 2);
    const y = Math.round(h / 4) + 72;
    this.respawnButton = this.add(new Button({
      x, y, w: BUTTON_W, h: BUTTON_H, text: 'Respawn', enabled: this.ticks >= ARM_TICKS,
      onClick: () => this.game?.respawn?.(),
    }));
    this.titleButton = this.add(new Button({
      x, y: y + 24, w: BUTTON_W, h: BUTTON_H, text: 'Title Screen', enabled: this.ticks >= ARM_TICKS,
      onClick: () => {
        this.game?.saveWorld?.();
        this.game?.quitToTitle?.();
      },
    }));
  }

  tick() {
    super.tick();
    const armed = this.ticks >= ARM_TICKS;
    if (this.respawnButton) this.respawnButton.enabled = armed;
    if (this.titleButton) this.titleButton.enabled = armed;
  }

  score() {
    const p = this.game?.player;
    const raw = p?.score ?? p?.xp ?? 0;
    return Math.max(0, Math.round(Number(raw) || 0));
  }

  cause() {
    const p = this.game?.player;
    return String(p?.deathMessage ?? p?.deathCause ?? 'The dark got there first.');
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    const w = this.width, h = this.height;

    // #7F0000A0 — the world stays visible underneath, soaked in red.
    ctx.fillStyle = 'rgba(127,0,0,0.627)';
    ctx.fillRect(0, 0, w, h);

    drawText(ctx, this.title, w / 2, Math.max(24, Math.round(h / 4) - 12),
      { color: 0xffffff, shadow: true, align: 'center', scale: 2 });
    drawText(ctx, this.cause(), w / 2, Math.max(48, Math.round(h / 4) + 12),
      { color: 0xffffff, shadow: true, align: 'center' });
    drawText(ctx, `Score: §e${this.score()}`, w / 2, Math.max(63, Math.round(h / 4) + 27),
      { color: 0xffffff, shadow: true, align: 'center' });

    this.renderWidgets(ctx, mx, my, dt);

    if (this.ticks < ARM_TICKS) {
      drawText(ctx, 'Steady…', w / 2, h - 24, { color: 0xd0a0a0, shadow: true, align: 'center' });
    }
    this.renderTooltip(ctx, mx, my);
  }

  onKeyDown(code, e) {
    if (this.ticks >= ARM_TICKS && (code === 'Enter' || code === 'Space')) {
      this.game?.respawn?.();
      return true;
    }
    return super.onKeyDown(code, e);
  }
}
