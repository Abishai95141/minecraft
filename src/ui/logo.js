// The SOWMICRAFT wordmark: chunky orthogonal letterforms, a rock-textured
// face, a hard black outline and a down-right extrusion — the same
// construction language as the Minecraft title logo, drawn from scratch.

import { Random } from '../core/rng.js';

const H = 15;      // letter height in logo pixels
const S = 3;       // stroke thickness

/**
 * Letters are lists of axis-aligned rects [x, y, w, h] in a H-tall grid.
 * Everything is built from rectangles, which is what gives the blocky look.
 */
const LETTERS = {
  S: { w: 12, rects: [
    [0, 0, 12, S],            // top bar
    [0, S, S, S * 2],         // upper-left stem
    [0, H / 2 - 1.5, 12, S],  // middle bar
    [9, H / 2 + 1.5, S, S * 2 - 1],
    [0, H - S, 12, S],        // bottom bar
  ] },
  O: { w: 12, rects: [
    [0, 0, 12, S],
    [0, S, S, H - S * 2],
    [9, S, S, H - S * 2],
    [0, H - S, 12, S],
  ] },
  W: { w: 17, rects: [
    [0, 0, S, H],
    [14, 0, S, H],
    [7, 6, S, H - 6],
    [0, H - S, 17, S],
  ] },
  M: { w: 17, rects: [
    [0, 0, S, H],
    [14, 0, S, H],
    [7, 0, S, 9],
    [0, 0, 17, S],
  ] },
  I: { w: 3, rects: [
    [0, 0, S, H],
  ] },
  C: { w: 12, rects: [
    [0, 0, 12, S],
    [0, S, S, H - S * 2],
    [0, H - S, 12, S],
  ] },
  R: { w: 12, rects: [
    [0, 0, 12, S],
    [0, 0, S, H],
    [9, S, S, 3],
    [0, 6, 12, S],
    [6, 9, S, 3],
    [9, 12, S, 3],
  ] },
  A: { w: 12, rects: [
    [0, 0, 12, S],
    [0, 0, S, H],
    [9, 0, S, H],
    [0, 6, 12, S],
  ] },
  F: { w: 12, rects: [
    [0, 0, 12, S],
    [0, 0, S, H],
    [0, 6, 10, S],
  ] },
  T: { w: 15, rects: [
    [0, 0, 15, S],
    [6, 0, S, H],
  ] },
  N: { w: 12, rects: [
    [0, 0, S, H],
    [9, 0, S, H],
    [3, 3, S, 5],
    [6, 7, S, 5],
  ] },
  E: { w: 12, rects: [
    [0, 0, 12, S],
    [0, 0, S, H],
    [0, 6, 10, S],
    [0, H - S, 12, S],
  ] },
  D: { w: 12, rects: [
    [0, 0, 10, S],
    [0, 0, S, H],
    [9, S, S, H - S * 2],
    [0, H - S, 10, S],
  ] },
  Y: { w: 12, rects: [
    [0, 0, S, 6],
    [9, 0, S, 6],
    [0, 6, 12, S],
    [4.5, 9, S, 6],
  ] },
  ' ': { w: 6, rects: [] },
};

const GAP = 3;  // spacing between letters, in logo pixels

/** Logical size of a wordmark, before scaling. */
export function measureWordmark(text) {
  let w = 0;
  for (const ch of text.toUpperCase()) {
    const L = LETTERS[ch];
    if (!L) continue;
    w += L.w + GAP;
  }
  return { w: Math.max(0, w - GAP), h: H };
}

const cache = new Map();

/**
 * Renders the wordmark to an offscreen canvas at `scale` device pixels per
 * logo pixel, and caches it. Returns { canvas, w, h, depth }.
 */
export function buildWordmark(text, scale = 4, opts = {}) {
  const key = `${text}|${scale}|${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const depth = opts.depth ?? 2;                 // extrusion in logo px
  const outline = opts.outline ?? 1;             // outline in logo px
  const face = opts.face ?? '#a0a0a0';
  const faceDark = opts.faceDark ?? '#6e6e6e';
  const top = opts.top ?? '#d4d4d4';
  const side = opts.side ?? '#4a4a4a';
  const rim = opts.rim ?? '#2b2b2b';

  const m = measureWordmark(text);
  const padL = outline;
  const padT = outline;
  const padR = depth + outline;
  const padB = depth + outline;
  const cw = (m.w + padL + padR) * scale;
  const ch = (m.h + padT + padB) * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(cw));
  canvas.height = Math.max(1, Math.ceil(ch));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Collect every rect in wordmark space.
  const rects = [];
  let cx = 0;
  for (const chr of text.toUpperCase()) {
    const L = LETTERS[chr];
    if (!L) continue;
    for (const r of L.rects) rects.push([cx + r[0], r[1], r[2], r[3]]);
    cx += L.w + GAP;
  }

  const px = (v) => Math.round(v * scale);
  const fill = (x, y, w, h) => ctx.fillRect(px(x + padL), px(y + padT), px(w), px(h));

  // 1. Extruded side + outline behind everything. Drawing the shape offset by
  //    1..depth builds the solid 3D body without any per-face bookkeeping.
  ctx.fillStyle = rim;
  for (let d = depth; d >= 1; d--) {
    for (const r of rects) {
      fill(r[0] + d - outline, r[1] + d - outline, r[2] + outline * 2, r[3] + outline * 2);
    }
  }
  ctx.fillStyle = side;
  for (let d = depth; d >= 1; d--) {
    for (const r of rects) fill(r[0] + d, r[1] + d, r[2], r[3]);
  }

  // 2. Outline around the front face.
  ctx.fillStyle = rim;
  for (const r of rects) fill(r[0] - outline, r[1] - outline, r[2] + outline * 2, r[3] + outline * 2);

  // 3. Front face.
  ctx.fillStyle = face;
  for (const r of rects) fill(r[0], r[1], r[2], r[3]);

  // 4. Rock speckle on the face, clipped to the letter shape.
  ctx.save();
  ctx.beginPath();
  for (const r of rects) ctx.rect(px(r[0] + padL), px(r[1] + padT), px(r[2]), px(r[3]));
  ctx.clip();
  const rnd = new Random(0x50574d43);
  const cell = Math.max(1, Math.round(scale));
  for (let y = 0; y < canvas.height; y += cell) {
    for (let x = 0; x < canvas.width; x += cell) {
      const v = rnd.next();
      if (v < 0.16) { ctx.fillStyle = faceDark; ctx.fillRect(x, y, cell, cell); }
      else if (v < 0.28) { ctx.fillStyle = top; ctx.fillRect(x, y, cell, cell); }
    }
  }
  ctx.restore();

  // 5. Top highlight: one logo-pixel band along the upper edge of every rect.
  ctx.fillStyle = top;
  for (const r of rects) fill(r[0], r[1], r[2], 1);
  // 6. Bottom shade.
  ctx.fillStyle = faceDark;
  for (const r of rects) fill(r[0], r[1] + r[3] - 1, r[2], 1);

  const out = { canvas, w: canvas.width, h: canvas.height, depth, scale, logicalW: m.w, logicalH: m.h };
  if (cache.size > 16) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * Draws the wordmark centred on `cx`, top-aligned at `y`, scaled so its width
 * is `targetWidth` device pixels.
 */
export function drawWordmark(ctx, text, cx, y, targetWidth, opts = {}) {
  const m = measureWordmark(text);
  const scale = Math.max(1, Math.round(targetWidth / (m.w + 4)));
  const wm = buildWordmark(text, scale, opts);
  const x = Math.round(cx - wm.w / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wm.canvas, x, Math.round(y));
  return { x, y, w: wm.w, h: wm.h };
}

export const LOGO_ASPECT = () => {
  const m = measureWordmark('SOWMICRAFT');
  return m.w / m.h;
};
