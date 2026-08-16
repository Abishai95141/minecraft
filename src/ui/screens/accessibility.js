// Accessibility Settings — the `accessibility` category: subtitles, motion
// reduction and dialogue pacing.

import { Screen } from '../screen.js';
import { Button, BUTTON_H } from '../widgets.js';
import { drawText, wrapText, LINE_HEIGHT } from '../font.js';
import { settings } from '../../core/settings.js';

const NOTE = 'Screen shake, damage tilt and distortion can each be turned down '
  + 'to zero. Subtitles name every sound the world makes around you.';

export class AccessibilityScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Accessibility Settings';
    this.pausesGame = true;
  }

  build(w, h) {
    const y = this.addOptionRows(settings.optionsIn('accessibility'), { y: 32 });

    this.add(new Button({
      x: Math.round(w / 2 - 155), y: y + 6, w: 310, h: BUTTON_H, text: 'Calm Everything Down',
      tooltip: 'Sets shake, tilt and distortion to zero and turns subtitles on.',
      onClick: () => this.calm(),
    }));

    this.add(new Button({
      x: Math.round(w / 2 - 100), y: Math.max(y + 34, h - 27), w: 200, h: BUTTON_H, text: 'Done',
      onClick: () => this.close(),
    }));
  }

  /** One click for the whole reduced-motion set, since that is how it is used. */
  calm() {
    settings.set('screenShake', 0);
    settings.set('damageTilt', 0);
    settings.set('distortionEffects', 0);
    settings.set('showSubtitles', true);
    this.layout(this.width, this.height);
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.renderBackground(ctx, this.width, this.height);
    this.renderTitle(ctx, 15);
    this.renderWidgets(ctx, mx, my, dt);

    const lines = wrapText(NOTE, Math.max(160, this.width - 60));
    const top = this.height - 34 - lines.length * LINE_HEIGHT;
    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, lines[i], this.width / 2, top + i * LINE_HEIGHT,
        { color: 0x707070, shadow: true, align: 'center' });
    }
    this.renderTooltip(ctx, mx, my);
  }
}
