// The in-game menu. Dims the paused world, offers the way back in, the story
// log, options, and a save-then-quit that never loses the world.

import { Screen } from '../screen.js';
import { Button, BUTTON_H, drawNinePatch } from '../widgets.js';
import { drawText, wrapText, LINE_HEIGHT } from '../font.js';
import { OptionsScreen } from './options.js';

/** Objectives come from story/quests.js, whose entries are plain data — read
 *  them defensively so a shape change downgrades instead of throwing. */
function objectiveText(o) {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  return String(o.text ?? o.label ?? o.description ?? o.name ?? o.id ?? '');
}

function objectiveDone(o) {
  if (o == null || typeof o === 'string') return false;
  return !!(o.done ?? o.complete ?? o.completed);
}

export class PauseScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Game Menu';
    this.pausesGame = true;
    this.blursBackground = true;
    this.mode = 'menu';       // 'menu' | 'quests'
  }

  setMode(mode) {
    this.mode = mode;
    this.layout(this.width, this.height);
  }

  build(w, h) {
    const wide = 204;
    const half = 98;
    const left = Math.round(w / 2 - wide / 2);
    const top = Math.round(h / 4) + 8;

    if (this.mode === 'quests') {
      this.add(new Button({
        x: left, y: h - 30, w: wide, h: BUTTON_H, text: 'Back',
        onClick: () => this.setMode('menu'),
      }));
      return;
    }

    this.add(new Button({
      x: left, y: top, w: wide, h: BUTTON_H, text: 'Back to Game',
      onClick: () => this.game?.openScreen?.(null),
    }));
    this.add(new Button({
      x: left, y: top + 24, w: half, h: BUTTON_H, text: 'Advancements',
      enabled: !!this.game?.story,
      tooltip: this.game?.story ? 'Your quest log and objectives.' : 'Only available in Story Mode.',
      onClick: () => this.setMode('quests'),
    }));
    this.add(new Button({
      x: left + wide - half, y: top + 24, w: half, h: BUTTON_H, text: 'Options...',
      onClick: () => {
        const s = new OptionsScreen(this.game);
        s.parent = this;
        this.game?.openScreen?.(s);
      },
    }));
    this.add(new Button({
      x: left, y: top + 48, w: wide, h: BUTTON_H, text: 'Save and Quit to Title',
      onClick: () => this.saveAndQuit(),
    }));
  }

  saveAndQuit() {
    this.game?.saveWorld?.();
    this.game?.quitToTitle?.();
  }

  renderQuests(ctx, w, h) {
    const panelW = Math.min(280, w - 40);
    const panelX = Math.round(w / 2 - panelW / 2);
    const panelY = 42;
    const panelH = Math.max(60, h - panelY - 40);
    drawNinePatch(ctx, 'header', panelX, panelY, panelW, panelH);

    const story = this.game?.story;
    const quest = story?.currentQuest ?? null;
    const heading = quest ? String(quest.title ?? quest.name ?? quest.id ?? 'Current chapter') : 'No chapter in progress';
    drawText(ctx, heading, w / 2, panelY + 8, { color: 0xffd479, shadow: true, align: 'center' });

    let y = panelY + 24;
    const summary = quest?.summary ?? quest?.description ?? story?.progressText ?? '';
    if (summary) {
      for (const line of wrapText(String(summary), panelW - 20)) {
        drawText(ctx, line, panelX + 10, y, { color: 0xb9b9b9, shadow: true });
        y += LINE_HEIGHT;
        if (y > panelY + panelH - 20) break;
      }
      y += 4;
    }

    const objectives = story?.objectives ?? [];
    if (!objectives.length) {
      drawText(ctx, 'Nothing to do right now.', panelX + 10, y, { color: 0x8a8a8a, shadow: true });
    }
    for (const o of objectives) {
      if (y > panelY + panelH - 12) break;
      const done = objectiveDone(o);
      const mark = done ? '§a✓' : '§7•';
      const text = objectiveText(o);
      drawText(ctx, `${mark} ${done ? '§7' : '§f'}${text}`, panelX + 10, y, { color: 0xffffff, shadow: true });
      y += LINE_HEIGHT + 1;
    }
  }

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    const w = this.width, h = this.height;
    this.renderBackground(ctx, w, h);

    if (this.mode === 'quests') {
      drawText(ctx, 'Quest Log', w / 2, 24, { color: 0xffffff, shadow: true, align: 'center' });
      this.renderQuests(ctx, w, h);
    } else {
      drawText(ctx, this.title, w / 2, 40, { color: 0xffffff, shadow: true, align: 'center' });
      const name = this.game?.world?.name;
      if (name) drawText(ctx, String(name), w / 2, 52, { color: 0x9a9a9a, shadow: true, align: 'center' });
    }

    this.renderWidgets(ctx, mx, my, dt);
    this.renderTooltip(ctx, mx, my);
  }

  renderTitle() { /* drawn inline, at the vanilla y of 40 */ }

  onKeyDown(code, e) {
    if (this.mode === 'quests' && code === 'Escape') { this.setMode('menu'); return true; }
    return super.onKeyDown(code, e);
  }
}
