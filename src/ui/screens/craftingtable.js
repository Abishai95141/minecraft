// The crafting table GUI: a 3x3 grid whose result slot is a live preview, so
// ingredients are only spent when the player actually lifts the output out.

import { drawText } from '../font.js';
import { Inventory } from '../../item/inventory.js';
import { ContainerScreen, Slot, SlotKind, drawArrow, toPos } from './inventory.js';

const LABEL_COLOR = 0x404040;

export class CraftingTableScreen extends ContainerScreen {
  constructor(game, pos = null) {
    super(game, { panelW: 176, panelH: 166, title: 'Crafting' });
    this.pos = toPos(pos);
    this.craft = new Inventory(9);
    this.craftW = 3;
    this.result = new Inventory(1);
    this._unsubs.push(this.craft.onChange(() => this.refreshRecipe()));
    this.refreshRecipe();
  }

  buildSlots() {
    this.addGrid(this.craft, 0, 3, 3, 30, 17, { kind: SlotKind.CRAFT, group: 'craft' });
    this.addSlot(new Slot(this.result, 0, 124, 35, {
      kind: SlotKind.RESULT, group: 'result', takeOnly: true,
    }));
    this.addPlayerSlots(84, 142);
  }

  drawPanelContent(ctx, px, py, dt) {
    drawText(ctx, 'Crafting', 30, 6, { color: LABEL_COLOR, shadow: false });
    this.drawInventoryLabel(ctx);
    // The grid's frames end at x 84 and the result's begin at 123; vanilla's
    // 22x15 arrow bridges the gap.
    drawArrow(ctx, 90, 35, 22, 15, 1, '#8b8b8b');
  }
}
