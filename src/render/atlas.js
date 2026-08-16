// Builds every texture once at startup into
//   1. a WebGL2 TEXTURE_2D_ARRAY (one 16x16 layer per texture — no atlas
//      bleeding, mipmaps work per-layer), and
//   2. a set of 2D canvases the UI layer draws from.

import { TEXTURES, paint } from './textures.js';
import { TEX_SIZE } from './painter.js';

export class TextureAtlas {
  constructor() {
    this.size = TEX_SIZE;
    /** @type {Map<string, number>} texture name -> array layer */
    this.index = new Map();
    /** @type {string[]} layer -> name */
    this.names = [];
    /** @type {Uint8Array} layers * size * size * 4 */
    this.pixels = null;
    /** @type {HTMLCanvasElement[]} per-layer canvas for UI drawing */
    this.canvases = [];
    this.layers = 0;
    this.texture = null;
    this.gl = null;
  }

  /**
   * Paints every registered texture. Yields between batches so the loading
   * screen can animate; call with `onProgress` to drive the progress bar.
   */
  async build(onProgress) {
    const names = [...TEXTURES.keys()];
    this.layers = names.length;
    const px = this.size * this.size * 4;
    this.pixels = new Uint8Array(this.layers * px);
    this.names = names;

    const BATCH = 16;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const p = paint(name);
      this.index.set(name, i);
      this.pixels.set(p.data, i * px);
      this.canvases.push(p.toCanvas());
      if (i % BATCH === BATCH - 1) {
        onProgress?.((i + 1) / names.length, name);
        // Let the browser paint the loading bar.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(1, 'done');
    return this;
  }

  /** Synchronous build, for tests and for the isometric icon pre-pass. */
  buildSync() {
    const names = [...TEXTURES.keys()];
    this.layers = names.length;
    const px = this.size * this.size * 4;
    this.pixels = new Uint8Array(this.layers * px);
    this.names = names;
    for (let i = 0; i < names.length; i++) {
      const p = paint(names[i]);
      this.index.set(names[i], i);
      this.pixels.set(p.data, i * px);
      this.canvases.push(p.toCanvas());
    }
    return this;
  }

  upload(gl, { mipmap = true } = {}) {
    this.gl = gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const levels = mipmap ? Math.floor(Math.log2(this.size)) + 1 : 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, this.size, this.size, this.layers);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0,
      this.size, this.size, this.layers,
      gl.RGBA, gl.UNSIGNED_BYTE, this.pixels,
    );
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

    // Nearest magnification keeps the pixel art crisp; mipmapped minification
    // stops distant chunks from shimmering.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
      mipmap ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }

    this.texture = tex;
    return tex;
  }

  /** Layer index for a texture name; missing names fall back to layer 0. */
  layerOf(name) {
    const l = this.index.get(name);
    if (l === undefined) {
      if (!this._warned) this._warned = new Set();
      if (!this._warned.has(name)) {
        console.warn(`[atlas] missing texture "${name}"`);
        this._warned.add(name);
      }
      return 0;
    }
    return l;
  }

  canvasOf(name) {
    const l = this.index.get(name);
    return l === undefined ? null : this.canvases[l];
  }

  /** Average colour of a texture, used for map colours and particle tinting. */
  averageColor(name) {
    const l = this.index.get(name);
    if (l === undefined) return 0x808080;
    const px = this.size * this.size * 4;
    const off = l * px;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px; i += 4) {
      const a = this.pixels[off + i + 3];
      if (a < 16) continue;
      r += this.pixels[off + i]; g += this.pixels[off + i + 1]; b += this.pixels[off + i + 2];
      n++;
    }
    if (!n) return 0x808080;
    return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
  }

  /** Samples one pixel of a texture — used to colour break particles. */
  samplePixel(name, x, y) {
    const l = this.index.get(name);
    if (l === undefined) return 0x808080;
    const i = l * this.size * this.size * 4 + (y * this.size + x) * 4;
    return ((this.pixels[i] << 16) | (this.pixels[i + 1] << 8) | this.pixels[i + 2]) >>> 0;
  }
}

export const atlas = new TextureAtlas();
