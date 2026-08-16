// A browser-shaped environment for Node, so the game's modules can be imported
// and exercised headlessly. This is the only reason a syntax error or a bad
// import is caught before the browser: `node tools/check.mjs` loads every
// module through this shim.
//
// The 2D canvas context records nothing and draws nothing — it exists so UI
// code can run its render path without throwing. Pixel data is real, because
// Painter.toCanvas round-trips through createImageData/putImageData/getImageData.

const NOOP = () => {};

class ImageDataShim {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}

class Ctx2DShim {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.font = '10px monospace';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true;
    this.filter = 'none';
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.miterLimit = 10;
    this._pixels = null;
  }

  _store() {
    if (!this._pixels) {
      this._pixels = new Uint8ClampedArray(Math.max(1, this.canvas.width * this.canvas.height * 4));
    }
    return this._pixels;
  }

  createImageData(w, h) { return new ImageDataShim(w, h ?? w); }

  putImageData(img, dx = 0, dy = 0) {
    const px = this._store();
    const cw = this.canvas.width;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const si = (y * img.width + x) * 4;
        const di = ((y + dy) * cw + (x + dx)) * 4;
        if (di < 0 || di + 3 >= px.length) continue;
        px[di] = img.data[si];
        px[di + 1] = img.data[si + 1];
        px[di + 2] = img.data[si + 2];
        px[di + 3] = img.data[si + 3];
      }
    }
  }

  getImageData(x = 0, y = 0, w = this.canvas.width, h = this.canvas.height) {
    const out = new ImageDataShim(Math.max(1, w), Math.max(1, h));
    const px = this._store();
    const cw = this.canvas.width;
    for (let yy = 0; yy < out.height; yy++) {
      for (let xx = 0; xx < out.width; xx++) {
        const si = ((yy + y) * cw + (xx + x)) * 4;
        const di = (yy * out.width + xx) * 4;
        if (si < 0 || si + 3 >= px.length) continue;
        out.data[di] = px[si];
        out.data[di + 1] = px[si + 1];
        out.data[di + 2] = px[si + 2];
        out.data[di + 3] = px[si + 3];
      }
    }
    return out;
  }

  measureText(s) { return { width: String(s).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 1 }; }
  createLinearGradient() { return { addColorStop: NOOP }; }
  createRadialGradient() { return { addColorStop: NOOP }; }
  createPattern() { return { setTransform: NOOP }; }
  getContextAttributes() { return {}; }
  isPointInPath() { return false; }
  setTransform() {}
  getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
}

// Every other 2D call is a no-op; listing them keeps the shim honest about
// which calls are real and which are ignored.
for (const m of [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'resetTransform',
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'fill', 'stroke', 'clip', 'fillText', 'strokeText', 'drawImage', 'setLineDash',
  'getLineDash', 'drawFocusIfNeeded',
]) {
  if (!Ctx2DShim.prototype[m]) Ctx2DShim.prototype[m] = NOOP;
}

class CanvasShim {
  constructor(w = 300, h = 150) {
    this.width = w;
    this.height = h;
    this.clientWidth = w;
    this.clientHeight = h;
    this.style = {};
    this.dataset = {};
    this.classList = { add: NOOP, remove: NOOP, toggle: NOOP, contains: () => false };
    this._ctx = null;
  }
  getContext(kind) {
    if (kind === '2d') {
      if (!this._ctx) this._ctx = new Ctx2DShim(this);
      return this._ctx;
    }
    // No WebGL in Node — callers must handle a null context.
    return null;
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { cb?.(null); }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }; }
  requestPointerLock() {}
  focus() {}
}

function makeElement(tag) {
  if (tag === 'canvas') return new CanvasShim();
  return {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [], textContent: '',
    classList: { add: NOOP, remove: NOOP, toggle: NOOP, contains: () => false },
    appendChild: NOOP, removeChild: NOOP, setAttribute: NOOP, getAttribute: () => null,
    addEventListener: NOOP, removeEventListener: NOOP, focus: NOOP, click: NOOP,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
}

const store = new Map();
const localStorageShim = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const elements = new Map();

const documentShim = {
  createElement: makeElement,
  createElementNS: (_ns, tag) => makeElement(tag),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id === 'gl' || id === 'ui' ? 'canvas' : 'div'));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: NOOP,
  removeEventListener: NOOP,
  body: makeElement('body'),
  documentElement: makeElement('html'),
  pointerLockElement: null,
  exitPointerLock: NOOP,
  hidden: false,
  visibilityState: 'visible',
  fonts: { ready: Promise.resolve() },
};

class AudioParamShim {
  constructor(v = 0) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

function audioNode(extra = {}) {
  return Object.assign({
    connect: (n) => n, disconnect: NOOP, start: NOOP, stop: NOOP,
    addEventListener: NOOP, removeEventListener: NOOP,
  }, extra);
}

class AudioContextShim {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = audioNode();
    this.listener = {
      positionX: new AudioParamShim(), positionY: new AudioParamShim(), positionZ: new AudioParamShim(),
      forwardX: new AudioParamShim(), forwardY: new AudioParamShim(), forwardZ: new AudioParamShim(),
      upX: new AudioParamShim(), upY: new AudioParamShim(), upZ: new AudioParamShim(),
      setPosition: NOOP, setOrientation: NOOP,
    };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return audioNode({ gain: new AudioParamShim(1) }); }
  createOscillator() { return audioNode({ frequency: new AudioParamShim(440), detune: new AudioParamShim(), type: 'sine', setPeriodicWave: NOOP }); }
  createBiquadFilter() { return audioNode({ frequency: new AudioParamShim(350), Q: new AudioParamShim(1), gain: new AudioParamShim(0), detune: new AudioParamShim(), type: 'lowpass' }); }
  createBufferSource() { return audioNode({ buffer: null, playbackRate: new AudioParamShim(1), detune: new AudioParamShim(), loop: false }); }
  createBuffer(ch, len, rate) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: (i) => data[i] };
  }
  createStereoPanner() { return audioNode({ pan: new AudioParamShim(0) }); }
  createPanner() { return audioNode({ positionX: new AudioParamShim(), positionY: new AudioParamShim(), positionZ: new AudioParamShim(), setPosition: NOOP, refDistance: 1, maxDistance: 16, rolloffFactor: 1, distanceModel: 'linear', panningModel: 'HRTF' }); }
  createDelay() { return audioNode({ delayTime: new AudioParamShim(0) }); }
  createConvolver() { return audioNode({ buffer: null, normalize: true }); }
  createDynamicsCompressor() {
    return audioNode({ threshold: new AudioParamShim(-24), knee: new AudioParamShim(30), ratio: new AudioParamShim(12), attack: new AudioParamShim(0.003), release: new AudioParamShim(0.25) });
  }
  createWaveShaper() { return audioNode({ curve: null, oversample: 'none' }); }
  createChannelMerger() { return audioNode(); }
  createChannelSplitter() { return audioNode(); }
  createPeriodicWave() { return {}; }
  createAnalyser() { return audioNode({ fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData: NOOP, getFloatTimeDomainData: NOOP }); }
}

const windowShim = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  localStorage: localStorageShim,
  addEventListener: NOOP,
  removeEventListener: NOOP,
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: () => ({ matches: false, addEventListener: NOOP, removeEventListener: NOOP }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  AudioContext: AudioContextShim,
  webkitAudioContext: AudioContextShim,
  document: documentShim,
  location: { href: 'http://localhost/', search: '', hash: '' },
  navigator: { userAgent: 'node', language: 'en-US', hardwareConcurrency: 8 },
  performance: globalThis.performance,
  __sowmiFatal: NOOP,
  alert: NOOP,
  console,
};
windowShim.window = windowShim;
windowShim.self = windowShim;

/** Installs the shim onto globalThis. Idempotent. */
export function installBrowserEnv() {
  if (globalThis.__sowmiEnvInstalled) return globalThis;
  const g = globalThis;
  g.window = windowShim;
  g.self = windowShim;
  g.document = documentShim;
  g.localStorage = localStorageShim;
  // Node defines navigator/location as getter-only globals; overwrite via
  // defineProperty so the shim wins without tripping the setter guard.
  for (const [key, value] of [['navigator', windowShim.navigator], ['location', windowShim.location]]) {
    try { g[key] = value; }
    catch { Object.defineProperty(g, key, { value, writable: true, configurable: true }); }
  }
  g.requestAnimationFrame = windowShim.requestAnimationFrame;
  g.cancelAnimationFrame = windowShim.cancelAnimationFrame;
  g.matchMedia = windowShim.matchMedia;
  g.getComputedStyle = windowShim.getComputedStyle;
  g.AudioContext = AudioContextShim;
  g.webkitAudioContext = AudioContextShim;
  g.HTMLCanvasElement = CanvasShim;
  g.HTMLElement = class HTMLElement {};
  g.Image = class Image { constructor() { this.width = 0; this.height = 0; } addEventListener() {} };
  g.ImageData = ImageDataShim;
  g.OffscreenCanvas = CanvasShim;
  g.Path2D = class Path2D { constructor() {} addPath() {} moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} };
  g.DOMMatrix = class DOMMatrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
  g.__sowmiFatal = NOOP;
  g.__sowmiEnvInstalled = true;
  return g;
}

export { CanvasShim, Ctx2DShim, AudioContextShim, localStorageShim };
