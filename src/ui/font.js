// Hand-authored bitmap pixel font in the Minecraft idiom: strictly orthogonal
// 1px strokes, 7px cap height, 5px x-height, 1px descenders, proportional
// widths with a 1px gap baked into the advance.
//
// Glyphs are written as string art so they can be read and edited directly.
// '#' is an opaque pixel, anything else is transparent. Rows 0-6 are the body
// (baseline under row 6); an optional row 7 is the descender.

const G = {};

// --- punctuation & symbols -------------------------------------------------
G[' '] = ['   ', '   ', '   ', '   ', '   ', '   ', '   '];
G['!'] = ['#', '#', '#', '#', '#', ' ', '#'];
G['"'] = ['# #', '# #', '   ', '   ', '   ', '   ', '   '];
G['#'] = [' # # ', ' # # ', '#####', ' # # ', '#####', ' # # ', ' # # '];
G['$'] = ['  #  ', ' ####', '# #  ', ' ### ', '  # #', '#### ', '  #  '];
G['%'] = ['##  #', '##  #', '   # ', '  #  ', ' #   ', '#  ##', '#  ##'];
G['&'] = [' ##  ', '#  # ', '#  # ', ' ##  ', '#  # ', '#   #', ' ### '];
G["'"] = ['#', '#', ' ', ' ', ' ', ' ', ' '];
G['('] = ['  #', ' # ', '#  ', '#  ', '#  ', ' # ', '  #'];
G[')'] = ['#  ', ' # ', '  #', '  #', '  #', ' # ', '#  '];
G['*'] = ['     ', '# # #', ' ### ', '#####', ' ### ', '# # #', '     '];
G['+'] = ['     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '];
G[','] = ['  ', '  ', '  ', '  ', '  ', ' #', ' #', '# '];
G['-'] = ['     ', '     ', '     ', '#####', '     ', '     ', '     '];
G['.'] = [' ', ' ', ' ', ' ', ' ', ' ', '#'];
G['/'] = ['    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    '];
G[':'] = [' ', ' ', '#', ' ', ' ', '#', ' '];
G[';'] = ['  ', '  ', ' #', '  ', '  ', ' #', ' #', '# '];
G['<'] = ['   #', '  # ', ' #  ', '#   ', ' #  ', '  # ', '   #'];
G['='] = ['     ', '     ', '#####', '     ', '#####', '     ', '     '];
G['>'] = ['#   ', ' #  ', '  # ', '   #', '  # ', ' #  ', '#   '];
G['?'] = [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '];
G['@'] = [' ### ', '#   #', '# ###', '# # #', '# ###', '#    ', ' ####'];
G['['] = ['###', '#  ', '#  ', '#  ', '#  ', '#  ', '###'];
G['\\'] = ['#    ', '#    ', ' #   ', '  #  ', '   # ', '    #', '    #'];
G[']'] = ['###', '  #', '  #', '  #', '  #', '  #', '###'];
G['^'] = ['  #  ', ' # # ', '#   #', '     ', '     ', '     ', '     '];
G['_'] = ['     ', '     ', '     ', '     ', '     ', '     ', '     ', '#####'];
G['`'] = ['# ', ' #', '  ', '  ', '  ', '  ', '  '];
G['{'] = ['  ##', ' #  ', ' #  ', '#   ', ' #  ', ' #  ', '  ##'];
G['|'] = ['#', '#', '#', '#', '#', '#', '#'];
G['}'] = ['##  ', '  # ', '  # ', '   #', '  # ', '  # ', '##  '];
G['~'] = ['     ', '     ', ' #  #', '# ## ', '     ', '     ', '     '];

// --- digits ----------------------------------------------------------------
G['0'] = [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '];
G['1'] = ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '];
G['2'] = [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'];
G['3'] = ['#####', '   # ', '  ## ', '    #', '    #', '#   #', ' ### '];
G['4'] = ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '];
G['5'] = ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '];
G['6'] = ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '];
G['7'] = ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '];
G['8'] = [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '];
G['9'] = [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '];

// --- uppercase -------------------------------------------------------------
G['A'] = [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'];
G['B'] = ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '];
G['C'] = [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '];
G['D'] = ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '];
G['E'] = ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'];
G['F'] = ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '];
G['G'] = [' ### ', '#   #', '#    ', '#  ##', '#   #', '#   #', ' ### '];
G['H'] = ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'];
G['I'] = ['###', ' # ', ' # ', ' # ', ' # ', ' # ', '###'];
G['J'] = ['    #', '    #', '    #', '    #', '    #', '#   #', ' ### '];
G['K'] = ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'];
G['L'] = ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'];
G['M'] = ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'];
G['N'] = ['#   #', '##  #', '##  #', '# # #', '#  ##', '#  ##', '#   #'];
G['O'] = [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '];
G['P'] = ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '];
G['Q'] = [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'];
G['R'] = ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'];
G['S'] = [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '];
G['T'] = ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '];
G['U'] = ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '];
G['V'] = ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '];
G['W'] = ['#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '];
G['X'] = ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'];
G['Y'] = ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '];
G['Z'] = ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'];

// --- lowercase -------------------------------------------------------------
G['a'] = ['     ', '     ', ' ### ', '    #', ' ####', '#   #', ' ####'];
G['b'] = ['#    ', '#    ', '#### ', '#   #', '#   #', '#   #', '#### '];
G['c'] = ['    ', '    ', ' ###', '#   ', '#   ', '#   ', ' ###'];
G['d'] = ['    #', '    #', ' ####', '#   #', '#   #', '#   #', ' ####'];
G['e'] = ['     ', '     ', ' ### ', '#   #', '#####', '#    ', ' ### '];
G['f'] = [' ## ', '#   ', '### ', '#   ', '#   ', '#   ', '#   '];
G['g'] = ['     ', '     ', ' ####', '#   #', '#   #', ' ####', '    #', ' ### '];
G['h'] = ['#    ', '#    ', '#### ', '#   #', '#   #', '#   #', '#   #'];
G['i'] = ['#', ' ', '#', '#', '#', '#', '#'];
G['j'] = ['   #', '    ', '   #', '   #', '   #', '   #', '#  #', ' ## '];
G['k'] = ['#   ', '#   ', '#  #', '# # ', '##  ', '# # ', '#  #'];
G['l'] = ['# ', '# ', '# ', '# ', '# ', '# ', ' #'];
G['m'] = ['     ', '     ', '#####', '# # #', '# # #', '# # #', '# # #'];
G['n'] = ['     ', '     ', '#### ', '#   #', '#   #', '#   #', '#   #'];
G['o'] = ['     ', '     ', ' ### ', '#   #', '#   #', '#   #', ' ### '];
G['p'] = ['     ', '     ', '#### ', '#   #', '#   #', '#### ', '#    ', '#    '];
G['q'] = ['     ', '     ', ' ####', '#   #', '#   #', ' ####', '    #', '    #'];
G['r'] = ['    ', '    ', '# ##', '##  ', '#   ', '#   ', '#   '];
G['s'] = ['     ', '     ', ' ####', '#    ', ' ### ', '    #', '#### '];
G['t'] = [' #  ', ' #  ', '####', ' #  ', ' #  ', ' #  ', '  ##'];
G['u'] = ['     ', '     ', '#   #', '#   #', '#   #', '#   #', ' ####'];
G['v'] = ['     ', '     ', '#   #', '#   #', '#   #', ' # # ', '  #  '];
G['w'] = ['     ', '     ', '#   #', '#   #', '# # #', '# # #', ' # # '];
G['x'] = ['     ', '     ', '#   #', ' # # ', '  #  ', ' # # ', '#   #'];
G['y'] = ['     ', '     ', '#   #', '#   #', '#   #', ' ####', '    #', ' ### '];
G['z'] = ['     ', '     ', '#####', '   # ', '  #  ', ' #   ', '#####'];

// --- extras used by the UI -------------------------------------------------
G['©'] = [' ### ', '#   #', '# ## ', '# #  ', '# ## ', '#   #', ' ### '];   // ©
G['§'] = [' ### ', '#   #', '##   ', ' ### ', '   ##', '#   #', ' ### '];   // § (never drawn — formatting marker)
G['←'] = ['     ', '  #  ', ' #   ', '#####', ' #   ', '  #  ', '     '];   // ←
G['→'] = ['     ', '  #  ', '   # ', '#####', '   # ', '  #  ', '     '];   // →
G['↑'] = ['  #  ', ' ### ', '# # #', '  #  ', '  #  ', '  #  ', '  #  '];   // ↑
G['↓'] = ['  #  ', '  #  ', '  #  ', '  #  ', '# # #', ' ### ', '  #  '];   // ↓
G['★'] = ['  #  ', '  #  ', '#####', ' ### ', ' # # ', '#   #', '     '];   // ★
G['✓'] = ['     ', '    #', '   # ', '#  # ', ' # # ', '  #  ', '     '];   // ✓
G['✗'] = ['     ', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '     '];   // ✗
G['▶'] = ['#    ', '##   ', '###  ', '#### ', '###  ', '##   ', '#    '];   // ▶
G['•'] = ['   ', '   ', ' # ', '###', ' # ', '   ', '   '];                  // •
G['…'] = ['     ', '     ', '     ', '     ', '     ', '     ', '# # #'];   // …
G['❤'] = [' # # ', '#####', '#####', ' ### ', '  #  ', '     ', '     '];   // ❤
G['°'] = [' ## ', '#  #', '#  #', ' ## ', '    ', '    ', '    '];          // °
G['é'] = ['  #  ', '     ', ' ### ', '#   #', '#####', '#    ', ' ### '];   // é

// ---------------------------------------------------------------- compiled

export const FONT_HEIGHT = 8;    // full glyph cell height, including descender row
export const CAP_HEIGHT = 7;     // rows above the baseline
export const LINE_HEIGHT = 9;    // baseline-to-baseline, vanilla spacing

/** @type {Map<string, {w:number, rows:Uint8Array, advance:number}>} */
const glyphs = new Map();

function compile(art) {
  const rows = new Uint8Array(FONT_HEIGHT);
  let w = 0;
  for (let y = 0; y < art.length && y < FONT_HEIGHT; y++) {
    const line = art[y];
    let mask = 0;
    for (let x = 0; x < line.length; x++) {
      if (line[x] === '#') { mask |= 1 << x; if (x + 1 > w) w = x + 1; }
    }
    rows[y] = mask;
  }
  return { w, rows, advance: w + 1 };
}

for (const [ch, art] of Object.entries(G)) glyphs.set(ch, compile(art));

// Space has no ink, so derive its width from the art instead of the ink bounds.
glyphs.set(' ', { w: 3, rows: new Uint8Array(FONT_HEIGHT), advance: 4 });

const MISSING = compile([' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### ']);

export const glyphFor = (ch) => glyphs.get(ch) || MISSING;

// ---------------------------------------------------------------- colours

/** The 16 vanilla formatting colours, §0 - §f. */
export const COLORS = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];
export const COLOR_NAMES = [
  'black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray',
  'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white',
];
const CODE_TO_INDEX = {};
'0123456789abcdef'.split('').forEach((c, i) => { CODE_TO_INDEX[c] = i; CODE_TO_INDEX[c.toUpperCase()] = i; });

/** Vanilla derives the shadow colour by dividing each channel by 4. */
export const shadowOf = (rgb) => (rgb & 0xfcfcfc) >>> 2;

const OBFUSCATE_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

// ---------------------------------------------------------------- glyph sheet
// One white sheet is rasterised at load; tinted copies are cached per colour so
// text draws are plain `drawImage` calls.

let sheet = null;
let sheetIndex = null;   // char -> {x, w}
const tintCache = new Map();

function buildSheet() {
  const order = [...glyphs.keys()];
  let total = 0;
  sheetIndex = new Map();
  for (const ch of order) {
    const g = glyphs.get(ch);
    sheetIndex.set(ch, { x: total, w: Math.max(1, g.w), g });
    total += Math.max(1, g.w) + 1;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, total);
  c.height = FONT_HEIGHT;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  for (const ch of order) {
    const { x, g } = sheetIndex.get(ch);
    for (let y = 0; y < FONT_HEIGHT; y++) {
      const mask = g.rows[y];
      if (!mask) continue;
      // Coalesce horizontal runs into single fills.
      let run = -1;
      for (let px = 0; px <= g.w; px++) {
        const on = px < g.w && (mask >> px) & 1;
        if (on && run < 0) run = px;
        else if (!on && run >= 0) { ctx.fillRect(x + run, y, px - run, 1); run = -1; }
      }
    }
  }
  sheet = c;
}

function tinted(rgb) {
  let c = tintCache.get(rgb);
  if (c) return c;
  if (!sheet) buildSheet();
  c = document.createElement('canvas');
  c.width = sheet.width;
  c.height = sheet.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, c.width, c.height);
  // Keep the cache bounded; the UI only ever uses a handful of colours.
  if (tintCache.size > 64) tintCache.clear();
  tintCache.set(rgb, c);
  return c;
}

// ---------------------------------------------------------------- measure & draw

/**
 * Splits a string into runs of identical style, honouring § formatting codes.
 * @returns {Array<{text:string, color:number, bold:boolean, italic:boolean,
 *                  underline:boolean, strike:boolean, obf:boolean}>}
 */
export function parseFormatted(str, baseColor = 0xffffff) {
  const runs = [];
  let color = baseColor, bold = false, italic = false, underline = false, strike = false, obf = false;
  let buf = '';
  const flush = () => {
    if (buf) { runs.push({ text: buf, color, bold, italic, underline, strike, obf }); buf = ''; }
  };
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ((ch === '§' || ch === '&') && i + 1 < str.length) {
      const code = str[i + 1];
      const isColor = code in CODE_TO_INDEX;
      const isStyle = 'klmnorKLMNOR'.includes(code);
      if (!isColor && !isStyle) { buf += ch; continue; }
      flush();
      i++;
      if (isColor) { color = COLORS[CODE_TO_INDEX[code]]; obf = bold = italic = underline = strike = false; }
      else switch (code.toLowerCase()) {
        case 'k': obf = true; break;
        case 'l': bold = true; break;
        case 'm': strike = true; break;
        case 'n': underline = true; break;
        case 'o': italic = true; break;
        case 'r': color = baseColor; obf = bold = italic = underline = strike = false; break;
      }
      continue;
    }
    buf += ch;
  }
  flush();
  return runs;
}

/** Width of a plain string in font pixels. */
export function measure(str) {
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ((ch === '§' || ch === '&') && i + 1 < str.length) {
      const code = str[i + 1];
      if (code in CODE_TO_INDEX || 'klmnorKLMNOR'.includes(code)) { i++; continue; }
    }
    w += glyphFor(ch).advance;
  }
  return w;
}

/** Width of a string with bold runs counted correctly (bold adds 1px per glyph). */
export function measureFormatted(str) {
  let w = 0;
  for (const run of parseFormatted(str)) {
    for (const ch of run.text) w += glyphFor(ch).advance + (run.bold ? 1 : 0);
  }
  return w;
}

/** Strips § codes, for measuring or logging. */
export const stripFormatting = (s) => s.replace(/[§&][0-9a-fk-orA-FK-OR]/g, '');

let obfSeed = 0;
export function tickObfuscation() { obfSeed = (obfSeed + 1) | 0; }

/**
 * Draws text. `x`,`y` are in GUI pixels with y at the TOP of the cap height.
 * Options: { color, shadow, scale, align: 'left'|'center'|'right', maxWidth }.
 */
export function drawText(ctx, str, x, y, opts = {}) {
  if (!sheet) buildSheet();
  const scale = opts.scale ?? 1;
  const shadow = opts.shadow !== false;
  const base = opts.color ?? 0xffffff;
  const runs = parseFormatted(String(str), base);

  let total = 0;
  for (const r of runs) for (const ch of r.text) total += glyphFor(ch).advance + (r.bold ? 1 : 0);
  total *= scale;

  let ox = x;
  if (opts.align === 'center') ox = x - total / 2;
  else if (opts.align === 'right') ox = x - total;
  ox = Math.round(ox);
  const oy = Math.round(y);

  if (shadow) drawRuns(ctx, runs, ox + scale, oy + scale, scale, true);
  drawRuns(ctx, runs, ox, oy, scale, false);
  return total;
}

function drawRuns(ctx, runs, x, y, scale, isShadow) {
  let cx = x;
  for (const run of runs) {
    const rgb = isShadow ? shadowOf(run.color) : run.color;
    const img = tinted(rgb);
    const startX = cx;
    for (let i = 0; i < run.text.length; i++) {
      let ch = run.text[i];
      if (run.obf && ch !== ' ') {
        const w = glyphFor(ch).w;
        // Pick a same-width replacement so the line doesn't jitter.
        for (let t = 0; t < 8; t++) {
          const cand = OBFUSCATE_POOL[(obfSeed * 31 + i * 17 + t * 7) % OBFUSCATE_POOL.length];
          if (glyphFor(cand).w === w) { ch = cand; break; }
        }
      }
      const g = glyphFor(ch);
      const entry = sheetIndex.get(ch);
      if (entry && g.w > 0) {
        const skew = run.italic ? scale : 0;
        if (skew) {
          // Italic: shift the top half right by 1px, vanilla-style.
          ctx.drawImage(img, entry.x, 0, g.w, 4, cx + skew, y, g.w * scale, 4 * scale);
          ctx.drawImage(img, entry.x, 4, g.w, 4, cx, y + 4 * scale, g.w * scale, 4 * scale);
        } else {
          ctx.drawImage(img, entry.x, 0, g.w, FONT_HEIGHT, cx, y, g.w * scale, FONT_HEIGHT * scale);
        }
        if (run.bold) {
          if (skew) {
            ctx.drawImage(img, entry.x, 0, g.w, 4, cx + skew + scale, y, g.w * scale, 4 * scale);
            ctx.drawImage(img, entry.x, 4, g.w, 4, cx + scale, y + 4 * scale, g.w * scale, 4 * scale);
          } else {
            ctx.drawImage(img, entry.x, 0, g.w, FONT_HEIGHT, cx + scale, y, g.w * scale, FONT_HEIGHT * scale);
          }
        }
      }
      cx += (g.advance + (run.bold ? 1 : 0)) * scale;
    }
    const runW = cx - startX;
    if (run.underline || run.strike) {
      ctx.fillStyle = '#' + ((isShadow ? shadowOf(run.color) : run.color) & 0xffffff).toString(16).padStart(6, '0');
      if (run.underline) ctx.fillRect(startX - scale, y + 7 * scale, runW, scale);
      if (run.strike) ctx.fillRect(startX - scale, y + 3 * scale, runW, scale);
    }
  }
}

/** Greedy word wrap. Returns an array of lines, preserving § state across breaks. */
export function wrapText(str, maxWidth) {
  const lines = [];
  for (const paragraph of String(str).split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    let carry = '';   // formatting codes active at the start of the line
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureFormatted(carry + candidate) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(carry + line);
        carry = trailingCodes(carry + line);
        line = word;
      }
    }
    lines.push(carry + line);
  }
  return lines;
}

function trailingCodes(s) {
  let color = '', styles = '';
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '§' || s[i] === '&') {
      const c = s[i + 1];
      if (c in CODE_TO_INDEX) { color = '§' + c; styles = ''; }
      else if ('lmnokLMNOK'.includes(c)) styles += '§' + c;
      else if (c === 'r' || c === 'R') { color = ''; styles = ''; }
    }
  }
  return color + styles;
}

/** Number of visible characters, ignoring formatting codes. */
export function visibleLength(str) {
  return stripFormatting(String(str)).length;
}

/**
 * Truncates a formatted string to `n` visible characters, keeping codes.
 * Used by the dialogue typewriter.
 */
export function truncateFormatted(str, n) {
  let out = '', count = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ((ch === '§' || ch === '&') && i + 1 < str.length) {
      const code = str[i + 1];
      if (code in CODE_TO_INDEX || 'klmnorKLMNOR'.includes(code)) { out += ch + code; i++; continue; }
    }
    if (count >= n) break;
    out += ch;
    count++;
  }
  return out;
}

export function ensureBuilt() { if (!sheet) buildSheet(); }
export const getSheet = () => { ensureBuilt(); return sheet; };
