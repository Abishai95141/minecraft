// Music & Sounds — the `audio` category, plus a button that fires a sound so
// the sliders can be tuned by ear instead of by guesswork.

import { Screen } from '../screen.js';
import { Button, BUTTON_H } from '../widgets.js';
import { drawText } from '../font.js';
import { settings } from '../../core/settings.js';

const PROBE = ['click', 'pop', 'dig.stone', 'xp', 'level_up'];

export class AudioSettingsScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Music & Sounds';
    this.pausesGame = true;
    this.probe = 0;
  }

  build(w, h) {
    const y = this.addOptionRows(settings.optionsIn('audio'), { y: 32 });

    this.add(new Button({
      x: Math.round(w / 2 - 155), y: y + 6, w: 310, h: BUTTON_H,
      text: 'Play a Test Sound',
      tooltip: 'Sounds are synthesised live — nothing is streamed or downloaded.',
      onClick: () => {
        this.game?.playSound?.(PROBE[this.probe % PROBE.length]);
        this.probe++;
      },
    }));

    this.add(new Button({
      x: Math.round(w / 2 - 100), y: Math.max(y + 34, h - 27), w: 200, h: BUTTON_H, text: 'Done',
      onClick: () => this.close(),
    }));
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.renderBackground(ctx, this.width, this.height);
    this.renderTitle(ctx, 15);
    this.renderWidgets(ctx, mx, my, dt);
    if (!this.game?.audio) {
      drawText(ctx, 'Audio starts on your first click in the world.', this.width / 2, this.height - 40,
        { color: 0x707070, shadow: true, align: 'center' });
    }
    this.renderTooltip(ctx, mx, my);
  }
}
