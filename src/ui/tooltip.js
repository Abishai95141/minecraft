// The vanilla item tooltip: a dark panel with a two-tone purple gradient
// border, the item name in its rarity colour, an optional grey flavour line
// and a durability readout. Container screens and the HUD both draw through it.

import { drawText, measureFormatted, wrapText, LINE_HEIGHT } from './font.js';
import { getItem, RARITY_COLOR } from '../item/items.js';

/** Vanilla's #100010F0 panel and its #5000FF50 -> #28007F50 border pair. */
const PANEL = 'rgba(16, 0, 16, 0.94)';
const BORDER_TOP = 'rgba(80, 0, 255, 0.3125)';
const BORDER_BOTTOM = 'rgba(40, 0, 127, 0.3125)';

const GREY = 0xaaaaaa;
const PAD = 3;
const OFFSET_X = 12;
const OFFSET_Y = -12;

/**
 * Tooltip body for a stack (or a bare item name). Returns `{text, color}` rows
 * in draw order; an empty stack yields an empty list so callers can skip.
 */
export function tooltipLinesFor(stack) {
  const lines = [];
  if (!stack) return lines;

  const asName = typeof stack === 'string';
  const name = asName ? stack : stack.name;
  if (!name || (!asName && stack.isEmpty)) return lines;

  const it = getItem(name);
  if (!it) {
    lines.push({ text: name, color: 0xffffff });
    return lines;
  }

  const rarity = Math.max(0, Math.min(RARITY_COLOR.length - 1, it.rarity | 0));
  lines.push({ text: it.display || name, color: RARITY_COLOR[rarity] });

  if (it.desc) lines.push({ text: it.desc, color: GREY });

  const max = it.durability | 0;
  const damage = asName ? 0 : (stack.damage | 0);
  if (max > 0 && damage > 0) {
    lines.push({ text: `Durability: ${max - damage} / ${max}`, color: GREY });
  }

  if (it.quest) lines.push({ text: 'Quest Item', color: 0x55ffff });

  return lines;
}

/**
 * Draws the panel at the cursor, flipping to the other side and clamping when
 * it would leave the screen. `lines` accepts plain strings or `{text, color}`.
 * Returns the panel bounds so a caller can lay something out against it.
 */
export function drawTooltip(ctx, lines, x, y, screenW, screenH) {
  const w = Math.max(1, screenW | 0);
  const h = Math.max(1, screenH | 0);
  const rows = normalise(lines, w);
  if (!rows.length) return null;

  let boxW = 0;
  for (const row of rows) boxW = Math.max(boxW, measureFormatted(row.text));

  // Vanilla opens a 2px gap under the title once there is more than one line.
  const titleGap = rows.length > 1 ? 2 : 0;
  const boxH = rows.length * LINE_HEIGHT - 1 + titleGap;

  const mx = Math.round(x);
  const my = Math.round(y);
  let bx = mx + OFFSET_X;
  let by = my + OFFSET_Y;
  if (bx + boxW + PAD + 1 > w) bx = mx - boxW - OFFSET_X - PAD - 1;
  if (bx < PAD + 1) bx = PAD + 1;
  if (by + boxH + PAD + 1 > h) by = h - boxH - PAD - 1;
  if (by < PAD + 1) by = PAD + 1;

  // Two overlapping rects give the panel vanilla's notched corners.
  ctx.fillStyle = PANEL;
  ctx.fillRect(bx - PAD - 1, by - PAD, boxW + PAD * 2 + 2, boxH + PAD * 2);
  ctx.fillRect(bx - PAD, by - PAD - 1, boxW + PAD * 2, boxH + PAD * 2 + 2);

  const grad = ctx.createLinearGradient(0, by - PAD + 1, 0, by + boxH + PAD - 1);
  grad.addColorStop(0, BORDER_TOP);
  grad.addColorStop(1, BORDER_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(bx - PAD, by - PAD + 1, 1, boxH + PAD * 2 - 2);
  ctx.fillRect(bx + boxW + PAD - 1, by - PAD + 1, 1, boxH + PAD * 2 - 2);
  ctx.fillStyle = BORDER_TOP;
  ctx.fillRect(bx - PAD, by - PAD, boxW + PAD * 2, 1);
  ctx.fillStyle = BORDER_BOTTOM;
  ctx.fillRect(bx - PAD, by + boxH + PAD - 1, boxW + PAD * 2, 1);

  for (let i = 0; i < rows.length; i++) {
    const ty = by + i * LINE_HEIGHT + (i > 0 ? titleGap : 0);
    drawText(ctx, rows[i].text, bx, ty, { color: rows[i].color, shadow: true });
  }

  return { x: bx, y: by, w: boxW, h: boxH };
}

/** Convenience wrapper: build the rows for a stack and draw them in one call. */
export function drawStackTooltip(ctx, stack, x, y, screenW, screenH) {
  return drawTooltip(ctx, tooltipLinesFor(stack), x, y, screenW, screenH);
}

/**
 * Flattens mixed string / object input into coloured rows, wrapping anything
 * long enough to overrun the screen so a flavour line never pushes off-edge.
 */
function normalise(lines, screenW) {
  const maxW = Math.max(80, screenW - 32);
  const src = Array.isArray(lines) ? lines : [lines];
  const out = [];
  for (const raw of src) {
    if (raw === null || raw === undefined) continue;
    const isText = typeof raw === 'string';
    const text = isText ? raw : String(raw.text ?? '');
    const color = isText ? 0xffffff : (raw.color ?? 0xffffff);
    // A blank entry is a deliberate spacer row, so keep it.
    if (!text || measureFormatted(text) <= maxW) {
      out.push({ text, color });
      continue;
    }
    for (const piece of wrapText(text, maxW)) out.push({ text: piece, color });
  }
  return out;
}
