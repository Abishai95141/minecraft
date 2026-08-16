// The single-chest GUI: 27 slots backed by the chest's block entity, so what
// the player leaves inside survives a save, a reload and a chunk unload.

import { drawText } from '../font.js';
import { Inventory } from '../../item/inventory.js';
import {
  ContainerScreen, toPos, loadItems, storeItems, readContainerEntity,
} from './inventory.js';

const LABEL_COLOR = 0x404040;
const CHEST_SLOTS = 27;

export class ChestScreen extends ContainerScreen {
  constructor(game, pos = null) {
    super(game, { panelW: 176, panelH: 168, title: 'Chest' });
    this.pos = toPos(pos);
    this.container = new Inventory(CHEST_SLOTS);
    this.data = readContainerEntity(this.game?.world ?? null, this.pos, 'chest', CHEST_SLOTS);
    loadItems(this.container, this.data.items);
    this._unsubs.push(this.container.onChange(() => this.save()));
  }

  save() {
    this.data.items = storeItems(this.container);
    const world = this.game?.world;
    if (world && this.pos) world.setBlockEntity(this.pos.x, this.pos.y, this.pos.z, this.data);
  }

  buildSlots() {
    this.addGrid(this.container, 0, 9, 3, 8, 18, { group: 'container' });
    this.addPlayerSlots(85, 143);
  }

  onContainerClosed() {
    this.save();
    const p = this.pos;
    const at = p ? { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 } : {};
    this.game?.playSound?.('chest_close', at);
  }

  drawPanelContent(ctx, px, py, dt) {
    drawText(ctx, 'Chest', 8, 6, { color: LABEL_COLOR, shadow: false });
    this.drawInventoryLabel(ctx);
  }
}
