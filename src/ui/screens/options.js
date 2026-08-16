// The Options hub: the settings that do not belong to a sub-screen, the world
// difficulty, and the doors to Video, Controls, Music & Sounds and Accessibility.

import { Screen } from '../screen.js';
import { Button, BUTTON_H } from '../widgets.js';
import { drawText } from '../font.js';
import { settings, OPTION_DEFS } from '../../core/settings.js';
import { VideoSettingsScreen } from './videosettings.js';
import { ControlsScreen } from './controls.js';
import { AudioSettingsScreen } from './audiosettings.js';
import { AccessibilityScreen } from './accessibility.js';

/** Categories that have a screen of their own; everything else lands here. */
const DELEGATED = new Set(['video', 'controls', 'audio', 'accessibility']);

const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class OptionsScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Options';
    this.pausesGame = true;
  }

  build(w, h) {
    const loose = Object.keys(OPTION_DEFS).filter((k) => !DELEGATED.has(OPTION_DEFS[k].category));
    let y = this.addOptionRows(loose, { y: 32 });

    const colW = 150;
    const left = Math.round(w / 2 - colW - 5);
    const right = Math.round(w / 2 + 5);

    if (this.game?.world) {
      this.add(new Button({
        x: left, y, w: colW * 2 + 10, h: BUTTON_H,
        text: () => `Difficulty: ${titleCase(this.difficulty())}`,
        tooltip: 'Peaceful stops hostile spawns entirely.',
        onClick: () => this.cycleDifficulty(),
      }));
      y += 24;
    }

    const pages = [
      ['Video Settings...', () => new VideoSettingsScreen(this.game)],
      ['Controls...', () => new ControlsScreen(this.game)],
      ['Music & Sounds...', () => new AudioSettingsScreen(this.game)],
      ['Accessibility Settings...', () => new AccessibilityScreen(this.game)],
    ];
    pages.forEach(([label, make], i) => {
      this.add(new Button({
        x: i % 2 === 0 ? left : right,
        y: y + Math.floor(i / 2) * 24,
        w: colW, h: BUTTON_H, text: label,
        onClick: () => this.open(make()),
      }));
    });
    y += Math.ceil(pages.length / 2) * 24;

    this.add(new Button({
      x: Math.round(w / 2 - 100), y: Math.max(y + 8, h - 27), w: 200, h: BUTTON_H, text: 'Done',
      onClick: () => this.close(),
    }));
  }

  difficulty() {
    const cur = String(this.game?.world?.difficulty ?? 'normal');
    return DIFFICULTIES.includes(cur) ? cur : 'normal';
  }

  cycleDifficulty() {
    const next = DIFFICULTIES[(DIFFICULTIES.indexOf(this.difficulty()) + 1) % DIFFICULTIES.length];
    if (this.game?.world) this.game.world.difficulty = next;
  }

  open(screen) {
    screen.parent = this;
    this.game?.openScreen?.(screen);
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    this.renderBackground(ctx, this.width, this.height);
    this.renderTitle(ctx, 15);
    this.renderWidgets(ctx, mx, my, dt);
    if (!this.game?.world) {
      drawText(ctx, 'Difficulty is set once a world is open.', this.width / 2, this.height - 40,
        { color: 0x707070, shadow: true, align: 'center' });
    }
    this.renderTooltip(ctx, mx, my);
  }

  onClose() {
    super.onClose();
    settings.save();
  }
}
