// Pre-rendered inventory icons. Full-cube blocks become isometric 3D sprites,
// everything else is a flat blit of its atlas texture; each is rasterised once
// into a 32px offscreen canvas. Also draws stack counts and durability bars.

import { BLOCKS, RenderType, Tint } from '../world/blocks.js';
import { ITEMS, ITEM_LIST } from '../item/items.js';
import { cssHex } from '../core/math.js';
import { drawText } from './font.js';

/** Native resolution of a cached sprite; a slot blits it down to 16 GUI px. */
const ICON_SIZE = 32;

/** Vanilla's inventory cube shading: top lit, +Z side mid, +X side darkest. */
const SHADE_TOP = 1.0;
const SHADE_LEFT = 0.8;    // +Z face, drawn on the left
const SHADE_RIGHT = 0.6;   // +X face, drawn on the right

/**
 * Tinted blocks are painted greyscale into the atlas and multiplied by the
 * biome colour at mesh time. An icon has no biome, so it uses plains values.
 */
const TINT_COLOR = [];
TINT_COLOR[Tint.NONE] = 0xffffff;
TINT_COLOR[Tint.GRASS] = 0x91bd59;
TINT_COLOR[Tint.FOLIAGE] = 0x77ab2f;
TINT_COLOR[Tint.WATER] = 0x3f76e4;
TINT_COLOR[Tint.REDSTONE] = 0xff3f30;

/** Faces whose greenery lives in a separate tinted overlay texture. */
const SIDE_OVERLAY = new Map([['grass_block_side', 'grass_block_side_overlay']]);

/** Overlap, in texture pixels, that hides the seams between the three faces. */
const BLEED = 0.3;

// ---------------------------------------------------------------- helpers

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const tintFor = (kind) => TINT_COLOR[kind] ?? 0xffffff;

/** Packed colour scaled by a scalar. */
function mulScalar(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return ((r << 16) | (g << 8) | b) >>> 0;
}

/** Component-wise product of two packed colours. */
function mulHex(a, b) {
  const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255);
  const g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255);
  const bl = Math.round(((a & 255) * (b & 255)) / 255);
  return ((r << 16) | (g << 8) | bl) >>> 0;
}

/**
 * A copy of `src` multiplied by `mul`. The `multiply` pass floods transparent
 * pixels with the tint, so the alpha channel is stencilled back afterwards.
 */
function multiplied(src, mul) {
  const c = newCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0);
  if ((mul & 0xffffff) !== 0xffffff) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = cssHex(mul);
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

/**
 * Maps the whole texture onto the parallelogram `origin + u*U + v*V`, which is
 * what turns a flat 16x16 sprite into one face of a dimetric cube.
 */
function drawFace(g, img, ox, oy, ux, uy, vx, vy) {
  const n = img.width || 16;
  g.setTransform(ux / n, uy / n, vx / n, vy / n, ox, oy);
  g.drawImage(img, 0, 0, n, n, -BLEED, -BLEED, n + BLEED * 2, n + BLEED * 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------------------------------------------------------------- renderer

export class IconRenderer {
  constructor() {
    this.atlas = null;
    this.size = ICON_SIZE;
    this.built = false;
    /** @type {Map<string, HTMLCanvasElement>} item name -> finished sprite */
    this._icons = new Map();
    /** @type {Map<string, HTMLCanvasElement>} 'tex|shade|tint' -> shaded face */
    this._faces = new Map();
    this._missing = null;
  }

  /**
   * Rasterises every registered item once. Called from the loading screen, so
   * it must stay synchronous — a few hundred 32px canvases, a few ms in total.
   */
  buildSync(atlas) {
    this.atlas = atlas || null;
    this._icons.clear();
    this._faces.clear();
    this._missing = null;
    for (const it of ITEM_LIST) this._build(it);
    this.built = true;
    return this;
  }

  /** The cached sprite for an item, built on demand if it is not there yet. */
  iconFor(itemName) {
    if (!itemName) return this._missingIcon();
    const hit = this._icons.get(itemName);
    if (hit) return hit;
    const it = ITEMS[itemName];
    if (!it) {
      const miss = this._missingIcon();
      this._icons.set(itemName, miss);
      return miss;
    }
    return this._build(it);
  }

  /** Blits an icon. `size` is in GUI pixels; slots use the default 16. */
  draw(ctx, itemName, x, y, size = 16) {
    const img = this.iconFor(itemName);
    if (!img) return;
    ctx.drawImage(img, Math.round(x), Math.round(y), size, size);
  }

  /** Icon, then the stack count, then the wear bar — vanilla's slot contents. */
  drawStack(ctx, stack, x, y, size = 16) {
    if (!stack || stack.isEmpty || !stack.name) return;
    const s = size / 16;
    this.draw(ctx, stack.name, x, y, size);

    if (stack.count > 1) {
      // Vanilla hangs the count off the bottom-right corner of the 16px icon.
      drawText(ctx, String(stack.count), x + size + s, y + 9 * s, {
        color: 0xffffff,
        shadow: true,
        align: 'right',
        scale: Math.max(1, Math.round(s)),
      });
    }

    // The wear bar goes last: vanilla lets it sit over the count digits.
    const max = stack.maxDamage | 0;
    const dmg = stack.damage | 0;
    if (max > 0 && dmg > 0) {
      const frac = Math.max(0, Math.min(1, (max - dmg) / max));
      const bx = Math.round(x + 2 * s);
      const by = Math.round(y + 13 * s);
      const bw = Math.max(1, Math.round(13 * s));
      const bh = Math.max(1, Math.round(2 * s));
      ctx.fillStyle = '#000000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = `hsl(${Math.round(120 * frac)}, 100%, 50%)`;
      ctx.fillRect(bx, by, Math.round(bw * frac), Math.max(1, Math.round(bh / 2)));
    }
  }

  /** Frees the sprite cache. Used when the atlas is rebuilt. */
  clear() {
    this._icons.clear();
    this._faces.clear();
    this._missing = null;
    this.built = false;
  }

  // -------------------------------------------------------------- internals

  _build(it) {
    const def = it.block ? BLOCKS[it.block] : null;
    let canvas = null;
    if (def && def.render === RenderType.CUBE) canvas = this._renderCube(def);
    if (!canvas) canvas = this._renderFlat(it, def);
    if (!canvas) canvas = this._missingIcon();
    this._icons.set(it.name, canvas);
    return canvas;
  }

  /**
   * A 2:1 dimetric cube inside the sprite square: the top face is a rhombus,
   * the two visible sides are parallelograms sharing the centre point.
   */
  _renderCube(def) {
    const tint = tintFor(def.tint);
    const top = this._face(def.faceTex[2], SHADE_TOP, tint);
    const right = this._face(def.faceTex[0], SHADE_RIGHT, tint);
    const left = this._face(def.faceTex[4], SHADE_LEFT, tint);
    if (!top || !right || !left) return null;

    const S = ICON_SIZE;
    const h = S / 2;
    const q = S / 4;
    const c = newCanvas(S, S);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;

    // A solid silhouette underneath means the half-pixel seams where the three
    // faces meet show the block's own colour instead of the background.
    const avg = this.atlas ? this.atlas.averageColor(def.faceTex[2]) : 0x808080;
    g.beginPath();
    g.moveTo(h, 0);
    g.lineTo(S, q);
    g.lineTo(S, S - q);
    g.lineTo(h, S);
    g.lineTo(0, S - q);
    g.lineTo(0, q);
    g.closePath();
    g.fillStyle = cssHex(mulScalar(mulHex(avg, tint), 0.78));
    g.fill();

    // Sides first, then the top, so the upper rim overlaps them the way a real
    // cube's top face occludes the walls beneath it.
    drawFace(g, left, 0, q, h, q, 0, h);
    drawFace(g, right, h, h, h, -q, 0, h);
    drawFace(g, top, h, 0, h, q, -h, q);
    return c;
  }

  _renderFlat(it, def) {
    const texName = this._flatTexFor(it, def);
    if (!texName) return null;
    const src = this._face(texName, 1, def ? tintFor(def.tint) : 0xffffff);
    if (!src) return null;
    const c = newCanvas(ICON_SIZE, ICON_SIZE);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, ICON_SIZE, ICON_SIZE);
    return c;
  }

  /**
   * Items name their own sprite, but a block item whose name is not a texture
   * (slabs, panes, carpets) falls back to the block's own faces.
   */
  _flatTexFor(it, def) {
    const a = this.atlas;
    if (!a) return null;
    const candidates = [it.tex, it.name];
    if (def) candidates.push(def.faceTex[2], def.faceTex[0], def.faceTex[4]);
    for (const name of candidates) {
      if (name && a.canvasOf(name)) return name;
    }
    return null;
  }

  /** A shaded, tinted copy of one texture, cached across every block using it. */
  _face(texName, shade, tint) {
    const a = this.atlas;
    if (!a || !texName) return null;
    const key = `${texName}|${shade}|${tint}`;
    const hit = this._faces.get(key);
    if (hit) return hit;

    const src = a.canvasOf(texName);
    if (!src) return null;

    let out;
    const overlayName = SIDE_OVERLAY.get(texName);
    const overlay = overlayName && tint !== 0xffffff ? a.canvasOf(overlayName) : null;
    if (overlay) {
      // Grass block sides are plain dirt plus a separately tinted grass strip.
      out = newCanvas(src.width, src.height);
      const g = out.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(multiplied(src, mulScalar(0xffffff, shade)), 0, 0);
      g.drawImage(multiplied(overlay, mulScalar(tint, shade)), 0, 0);
    } else {
      out = multiplied(src, mulScalar(tint, shade));
    }
    this._faces.set(key, out);
    return out;
  }

  /** The classic missing-texture checker, so a bad name is obvious on screen. */
  _missingIcon() {
    if (this._missing) return this._missing;
    const c = newCanvas(ICON_SIZE, ICON_SIZE);
    const g = c.getContext('2d');
    const cell = ICON_SIZE / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#000000' : '#f800f8';
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    this._missing = c;
    return c;
  }
}

export const icons = new IconRenderer();
