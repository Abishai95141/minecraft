// The singleplayer world list: every saved world with its seed, last-played
// time and size, plus create, play and (confirmed) delete.

import { Screen } from '../screen.js';
import { Button, ListWidget, TextField, drawNinePatch, BUTTON_H } from '../widgets.js';
import { drawText, measureFormatted } from '../font.js';
import { listWorlds, deleteWorld, loadWorldData, usageBytes } from '../../core/storage.js';
import { Random } from '../../core/rng.js';

const LIST_W = 310;
const ITEM_H = 36;

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return 'never played';
  const secs = Math.max(0, (Date.now() - ts) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  if (secs < 86400 * 7) return `${Math.round(secs / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Saved size, preferring what the save wrote down over re-measuring it. */
function worldSize(meta) {
  if (Number.isFinite(meta.sizeBytes)) return meta.sizeBytes;
  if (Number.isFinite(meta.size)) return meta.size;
  try {
    const data = loadWorldData(meta.id);
    return data ? JSON.stringify(data).length * 2 : 0;
  } catch {
    return 0;
  }
}

/** Numeric seeds are used literally; anything else is hashed, like vanilla. */
function parseSeed(text) {
  const s = String(text ?? '').trim();
  if (!s) return Date.now() >>> 0;
  if (/^-?\d+$/.test(s)) return Number(s) >>> 0;
  return Random.fromString(s).seed;
}

export class WorldSelectScreen extends Screen {
  constructor(game) {
    super(game);
    this.title = 'Select World';
    this.mode = 'list';        // 'list' | 'create' | 'confirm'
    this.worlds = [];
    this.pending = null;       // the world awaiting delete confirmation
    this.newName = 'New World';
    this.newSeed = '';
    this.selectedIndex = 0;
    this.list = null;
    this.playButton = null;
    this.deleteButton = null;
    this.refresh();
  }

  refresh() {
    this.worlds = listWorlds().map((meta) => ({
      id: meta.id ?? '',
      name: meta.name || 'Unnamed World',
      seed: meta.seed ?? 0,
      lastPlayed: meta.lastPlayed ?? 0,
      story: !!meta.story,
      difficulty: meta.difficulty ?? 'normal',
      bytes: worldSize(meta),
    }));
  }

  setMode(mode) {
    this.mode = mode;
    this.layout(this.width, this.height);
  }

  build(w, h) {
    if (this.mode === 'create') return this.buildCreate(w, h);
    if (this.mode === 'confirm') return this.buildConfirm(w, h);
    return this.buildList(w, h);
  }

  // ---------------------------------------------------------------- list mode

  buildList(w, h) {
    const listX = Math.round(w / 2 - LIST_W / 2);
    const listH = Math.max(ITEM_H, h - 32 - 60);
    this.list = this.add(new ListWidget({
      x: listX, y: 32, w: LIST_W, h: listH,
      itemHeight: ITEM_H, gap: 2,
      items: this.worlds,
      emptyText: 'No worlds yet — create one below.',
      selected: this.worlds.length ? Math.min(this.selectedIndex, this.worlds.length - 1) : -1,
      drawItem: (ctx, item, x, y, iw, ih, state) => this.drawWorld(ctx, item, x, y, iw, ih, state),
      onSelect: (item, i) => { this.selectedIndex = Math.max(0, i); this.syncButtons(); },
      onActivate: (item) => this.play(item),
    }));

    const colW = 150;
    const left = Math.round(w / 2 - colW - 4);
    const right = Math.round(w / 2 + 4);
    const row1 = h - 52;
    const row2 = h - 28;

    this.playButton = this.add(new Button({
      x: left, y: row1, w: colW, h: BUTTON_H, text: 'Play Selected World',
      onClick: () => this.play(this.list?.selectedItem),
    }));
    this.add(new Button({
      x: right, y: row1, w: colW, h: BUTTON_H, text: 'Create New World',
      onClick: () => this.setMode('create'),
    }));
    this.deleteButton = this.add(new Button({
      x: left, y: row2, w: colW, h: BUTTON_H, text: 'Delete',
      onClick: () => this.askDelete(this.list?.selectedItem),
    }));
    this.add(new Button({
      x: right, y: row2, w: colW, h: BUTTON_H, text: 'Cancel',
      onClick: () => this.close(),
    }));

    this.syncButtons();
  }

  syncButtons() {
    const has = !!this.list?.selectedItem;
    if (this.playButton) this.playButton.enabled = has;
    if (this.deleteButton) this.deleteButton.enabled = has;
  }

  drawWorld(ctx, item, x, y, w, h, state) {
    drawNinePatch(ctx, state.selected ? 'hover' : state.hovered ? 'button' : 'header', x, y, w, h);
    const name = item.story ? `${item.name} §6[Story]` : item.name;
    drawText(ctx, name, x + 6, y + 4, { color: 0xffffff, shadow: true });
    drawText(ctx, `§7seed §f${item.seed}`, x + 6, y + 15, { color: 0x9a9a9a, shadow: true });
    drawText(ctx, `${formatWhen(item.lastPlayed)} · ${item.difficulty}`, x + 6, y + 25,
      { color: 0x8a8a8a, shadow: true });
    drawText(ctx, formatBytes(item.bytes), x + w - 6, y + 25, { color: 0x8a8a8a, shadow: true, align: 'right' });
  }

  play(item) {
    if (!item) return;
    this.game?.startWorld?.({
      id: item.id,
      name: item.name,
      seed: item.seed,
      story: item.story,
      difficulty: item.difficulty,
    });
  }

  // ---------------------------------------------------------------- create mode

  buildCreate(w, h) {
    const fieldW = Math.min(300, w - 40);
    const fx = Math.round(w / 2 - fieldW / 2);
    const top = Math.round(h / 2 - 58);

    this.add(new TextField({
      x: fx, y: top, w: fieldW, h: BUTTON_H, value: this.newName,
      label: 'World Name', placeholder: 'New World', maxLength: 32,
      onChange: (v) => { this.newName = v; },
    }));
    this.add(new TextField({
      x: fx, y: top + 44, w: fieldW, h: BUTTON_H, value: this.newSeed,
      label: 'Seed for the World Generator', placeholder: 'Leave blank for a random seed',
      maxLength: 32,
      onChange: (v) => { this.newSeed = v; },
    }));

    const colW = 150;
    this.add(new Button({
      x: Math.round(w / 2 - colW - 4), y: h - 40, w: colW, h: BUTTON_H, text: 'Create New World',
      onClick: () => this.create(),
    }));
    this.add(new Button({
      x: Math.round(w / 2 + 4), y: h - 40, w: colW, h: BUTTON_H, text: 'Cancel',
      onClick: () => this.setMode('list'),
    }));
  }

  create() {
    const name = (this.newName || '').trim() || 'New World';
    this.game?.startWorld?.({
      name,
      seed: parseSeed(this.newSeed),
      story: false,
      difficulty: 'normal',
    });
  }

  // ---------------------------------------------------------------- confirm mode

  askDelete(item) {
    if (!item) return;
    this.pending = item;
    this.setMode('confirm');
  }

  buildConfirm(w, h) {
    const colW = 150;
    const y = Math.round(h / 2 + 10);
    this.add(new Button({
      x: Math.round(w / 2 - colW - 4), y, w: colW, h: BUTTON_H, text: 'Delete',
      onClick: () => this.confirmDelete(),
    }));
    this.add(new Button({
      x: Math.round(w / 2 + 4), y, w: colW, h: BUTTON_H, text: 'Cancel',
      onClick: () => { this.pending = null; this.setMode('list'); },
    }));
  }

  confirmDelete() {
    if (this.pending) deleteWorld(this.pending.id);
    this.pending = null;
    this.refresh();
    this.setMode('list');
  }

  // ---------------------------------------------------------------- drawing

  render(ctx, mx, my, dt) {
    this.time += dt || 0;
    const w = this.width, h = this.height;
    this.renderBackground(ctx, w, h);

    if (this.mode === 'confirm') {
      this.title = 'Delete World';
      this.renderTitle(ctx, 20);
      const name = this.pending?.name ?? 'this world';
      drawText(ctx, `Delete "${name}"?`, w / 2, Math.round(h / 2) - 30,
        { color: 0xffffff, shadow: true, align: 'center' });
      drawText(ctx, 'This cannot be undone. The save is removed for good.', w / 2, Math.round(h / 2) - 16,
        { color: 0xff8080, shadow: true, align: 'center' });
    } else if (this.mode === 'create') {
      this.title = 'Create New World';
      this.renderTitle(ctx, 20);
      drawText(ctx, 'A seed can be any text. The same seed always builds the same world.',
        w / 2, Math.round(h / 2) + 12, { color: 0x9a9a9a, shadow: true, align: 'center' });
    } else {
      this.title = 'Select World';
      this.renderTitle(ctx, 15);
    }

    this.renderWidgets(ctx, mx, my, dt);

    if (this.mode === 'list') {
      const used = `Storage used: ${formatBytes(usageBytes())}`;
      drawText(ctx, used, 4, h - 10, { color: 0x707070, shadow: true });
      const count = `${this.worlds.length} world${this.worlds.length === 1 ? '' : 's'}`;
      if (measureFormatted(used) + measureFormatted(count) + 16 < w) {
        drawText(ctx, count, w - 4, h - 10, { color: 0x707070, shadow: true, align: 'right' });
      }
    }

    this.renderTooltip(ctx, mx, my);
  }

  onKeyDown(code, e) {
    if (this.mode !== 'list' && code === 'Escape') {
      this.pending = null;
      this.setMode('list');
      return true;
    }
    if (this.mode === 'list' && code === 'Enter' && this.list?.selectedItem) {
      this.play(this.list.selectedItem);
      return true;
    }
    return super.onKeyDown(code, e);
  }
}
