// Video Settings — every option tagged `video` in settings.js, laid out in the
// vanilla two-column grid so a new option appears here without a code change.

import { Screen } from '../screen.js';
import { Button, BUTTON_H } from '../widgets.js';
import { drawText } from '../font.js';
import { settings } from '../../core/settings.js';

export class VideoSettingsScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Video Settings';
    this.pausesGame = true;
  }

  build(w, h) {
    const y = this.addOptionRows(settings.optionsIn('video'), { y: 32 });
    this.add(new Button({
      x: Math.round(w / 2 - 100), y: Math.max(y + 8, h - 27), w: 200, h: BUTTON_H, text: 'Done',
      onClick: () => this.close(),
    }));
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.renderBackground(ctx, this.width, this.height);
    this.renderTitle(ctx, 15);
    this.renderWidgets(ctx, mx, my, dt);
    const fps = Number.isFinite(this.game?.fps) ? Math.round(this.game.fps) : 0;
    drawText(ctx, `${fps} fps`, this.width - 4, 5, { color: 0x8a8a8a, shadow: true, align: 'right' });
    this.renderTooltip(ctx, mx, my);
  }
}
