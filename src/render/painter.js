// A tiny 16x16 pixel-art canvas. Every block and item texture in the game is
// painted through this, so textures are deterministic (seeded per name),
// dependency-free, and cost nothing to ship.

import { Random } from '../core/rng.js';

export const TEX_SIZE = 16;

export class Painter {
  constructor(seed, size = TEX_SIZE) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rng = typeof seed === 'string' ? Random.fromString(seed) : new Random(seed >>> 0);
  }

  rand() { return this.rng.next(); }
  randInt(a, b) { return this.rng.int(a, b); }
  pick(arr) { return this.rng.pick(arr); }
  chance(p) { return this.rng.next() < p; }

  index(x, y) { return (y * this.size + x) * 4; }

  /** Reads a pixel as [r, g, b, a]. */
  get(x, y) {
    const i = this.index(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Sets a pixel. `color` is 0xRRGGBB; alpha is 0-255. */
  set(x, y, color, alpha = 255) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return this;
    const i = this.index(x, y);
    this.data[i] = (color >> 16) & 255;
    this.data[i + 1] = (color >> 8) & 255;
    this.data[i + 2] = color & 255;
    this.data[i + 3] = alpha;
    return this;
  }

  /** Alpha-blends a colour over the existing pixel. */
  blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return this;
    const i = this.index(x, y);
    const a = alpha / 255;
    const ia = 1 - a;
    this.data[i] = ((color >> 16) & 255) * a + this.data[i] * ia;
    this.data[i + 1] = ((color >> 8) & 255) * a + this.data[i + 1] * ia;
    this.data[i + 2] = (color & 255) * a + this.data[i + 2] * ia;
    this.data[i + 3] = Math.max(this.data[i + 3], alpha);
    return this;
  }

  fill(color, alpha = 255) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, color, alpha);
    return this;
  }

  clear() { this.data.fill(0); return this; }

  rect(x, y, w, h, color, alpha = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color, alpha);
    return this;
  }

  outline(x, y, w, h, color, alpha = 255) {
    for (let xx = x; xx < x + w; xx++) { this.set(xx, y, color, alpha); this.set(xx, y + h - 1, color, alpha); }
    for (let yy = y; yy < y + h; yy++) { this.set(x, yy, color, alpha); this.set(x + w - 1, yy, color, alpha); }
    return this;
  }

  hline(x, y, w, color, alpha = 255) { return this.rect(x, y, w, 1, color, alpha); }
  vline(x, y, h, color, alpha = 255) { return this.rect(x, y, 1, h, color, alpha); }

  /** Bresenham line. */
  line(x0, y0, x1, y1, color, alpha = 255) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  circle(cx, cy, r, color, alpha = 255) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, color, alpha);
      }
    }
    return this;
  }

  /** Fills every pixel by picking from a weighted palette. */
  noise(palette, weights = null) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const i = weights ? this.rng.weighted(weights) : this.rng.below(palette.length);
        this.set(x, y, palette[i]);
      }
    }
    return this;
  }

  /** Scatters a colour over the existing image. */
  speckle(color, chance, alpha = 255) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) if (this.chance(chance)) this.set(x, y, color, alpha);
    }
    return this;
  }

  /** Multiplies every pixel's brightness by a per-pixel random in [lo, hi]. */
  jitter(lo = 0.9, hi = 1.1) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const i = this.index(x, y);
        if (this.data[i + 3] === 0) continue;
        const f = this.rng.float(lo, hi);
        this.data[i] *= f; this.data[i + 1] *= f; this.data[i + 2] *= f;
      }
    }
    return this;
  }

  /** Multiplies the whole texture by a colour (used for tinted variants). */
  multiply(color) {
    const mr = ((color >> 16) & 255) / 255, mg = ((color >> 8) & 255) / 255, mb = (color & 255) / 255;
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] *= mr; this.data[i + 1] *= mg; this.data[i + 2] *= mb;
    }
    return this;
  }

  /** Scales brightness of a region. */
  shade(x, y, w, h, factor) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= this.size || yy >= this.size) continue;
        const i = this.index(xx, yy);
        this.data[i] *= factor; this.data[i + 1] *= factor; this.data[i + 2] *= factor;
      }
    }
    return this;
  }

  /** Copies another painter's pixels over this one. */
  copyFrom(other) { this.data.set(other.data); return this; }

  /** Draws `other` where its alpha is non-zero. */
  overlay(other) {
    for (let i = 0; i < this.data.length; i += 4) {
      const a = other.data[i + 3];
      if (!a) continue;
      const f = a / 255, inv = 1 - f;
      this.data[i] = other.data[i] * f + this.data[i] * inv;
      this.data[i + 1] = other.data[i + 1] * f + this.data[i + 1] * inv;
      this.data[i + 2] = other.data[i + 2] * f + this.data[i + 2] * inv;
      this.data[i + 3] = Math.max(this.data[i + 3], a);
    }
    return this;
  }

  /**
   * Paints from string art. Each row is a string; each character indexes
   * `palette`. Characters missing from the palette are left transparent.
   */
  art(rows, palette, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        const col = palette[c];
        if (col === undefined || col === null) continue;
        if (Array.isArray(col)) this.set(x + ox, y + oy, col[0], col[1]);
        else this.set(x + ox, y + oy, col);
      }
    }
    return this;
  }

  /** Adds a 1px darker outline just outside every opaque pixel. */
  outlineAlpha(color = 0x000000, alpha = 255) {
    const src = new Uint8ClampedArray(this.data);
    const at = (x, y) => (x < 0 || y < 0 || x >= this.size || y >= this.size ? 0 : src[this.index(x, y) + 3]);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (at(x, y) > 0) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) this.set(x, y, color, alpha);
      }
    }
    return this;
  }

  /** A soft top-left highlight / bottom-right shadow, for a chiselled look. */
  bevel(x, y, w, h, light = 1.25, dark = 0.75) {
    this.shade(x, y, w, 1, light);
    this.shade(x, y, 1, h, light);
    this.shade(x, y + h - 1, w, 1, dark);
    this.shade(x + w - 1, y, 1, h, dark);
    return this;
  }

  /** Vertical wood grain: streaks of varying darkness down the texture. */
  grain(base, dark, light, density = 0.35) {
    this.fill(base);
    for (let x = 0; x < this.size; x++) {
      if (!this.chance(density)) continue;
      const col = this.chance(0.5) ? dark : light;
      let y = 0;
      while (y < this.size) {
        const run = this.randInt(2, 6);
        if (this.chance(0.7)) this.rect(x, y, 1, run, col);
        y += run + this.randInt(0, 2);
      }
    }
    return this;
  }

  /** Cobble-style irregular stones separated by darker mortar. */
  pebbles(mortar, stones, cells = 4) {
    this.fill(mortar);
    const step = this.size / cells;
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const px = Math.floor(cx * step) + this.randInt(0, 1);
        const py = Math.floor(cy * step) + this.randInt(0, 1);
        const w = Math.floor(step) - this.randInt(0, 1);
        const h = Math.floor(step) - this.randInt(0, 1);
        const col = this.pick(stones);
        this.rect(px, py, w, h, col);
        // Chip a corner off so the stones do not read as a perfect grid.
        if (this.chance(0.5)) this.set(px + w - 1, py, mortar);
        if (this.chance(0.5)) this.set(px, py + h - 1, mortar);
        this.shade(px, py, w, 1, 1.12);
        this.shade(px, py + h - 1, w, 1, 0.85);
      }
    }
    return this;
  }

  /** Regular brick courses with alternating offsets. */
  bricks(mortar, brickColors, rows = 4, offset = true) {
    this.fill(mortar);
    const h = this.size / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * h;
      const shift = offset && r % 2 === 1 ? this.size / 4 : 0;
      for (let bx = -1; bx < 2; bx++) {
        const x = bx * (this.size / 2) + shift;
        this.rect(x, y, this.size / 2 - 1, h - 1, this.pick(brickColors));
      }
    }
    return this;
  }

  /** Horizontal plank courses with a seam line between them. */
  planks(base, dark, light, count = 4) {
    const h = this.size / count;
    for (let p = 0; p < count; p++) {
      const y = p * h;
      this.rect(0, y, this.size, h, base);
      for (let x = 0; x < this.size; x++) {
        if (this.chance(0.28)) {
          const yy = y + this.randInt(0, h - 1);
          this.set(x, yy, this.chance(0.5) ? dark : light);
        }
      }
      this.hline(0, y, this.size, dark);          // seam
      this.hline(0, y + h - 1, this.size, dark);
      // A couple of nail/knot marks per plank.
      if (this.chance(0.6)) this.set(this.randInt(1, this.size - 2), y + 1 + this.randInt(0, h - 3), dark);
    }
    return this;
  }

  /** Concentric log rings for a log's end grain. */
  rings(center, mid, outer, bark) {
    this.fill(outer);
    const c = (this.size - 1) / 2;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const d = Math.max(Math.abs(x - c), Math.abs(y - c)) + this.rng.float(-0.6, 0.6);
        if (d < 1.8) this.set(x, y, center);
        else if (d < 4.2) this.set(x, y, mid);
        else if (d < 6.6) this.set(x, y, outer);
        else this.set(x, y, bark);
      }
    }
    return this;
  }

  /** Random blobs of ore in a stone base. */
  oreBlobs(colors, count = 4, minR = 1, maxR = 2) {
    for (let i = 0; i < count; i++) {
      const cx = this.randInt(2, this.size - 3);
      const cy = this.randInt(2, this.size - 3);
      const r = this.randInt(minR, maxR);
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > r + this.rng.float(-0.4, 0.4)) continue;
          this.set(x, y, colors[Math.min(colors.length - 1, Math.floor(d))] ?? colors[colors.length - 1]);
        }
      }
    }
    return this;
  }

  /** Exports to an ImageData-backed canvas, for UI drawing. */
  toCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.size, this.size);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

/** Multiplies a packed 0xRRGGBB colour by a scalar. */
export function scaleColor(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Builds a small palette ramp around a base colour. */
export function ramp(base, steps = 3, spread = 0.18) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i / (steps - 1)) * 2 - 1;
    out.push(scaleColor(base, 1 + t * spread));
  }
  return out;
}
