// The audio engine: one Web Audio graph, category buses wired to the volume
// sliders, 3D placement by listener basis, and the music director. Every sound
// is synthesised in `sfx.js` / `music.js` — the game ships no audio files.

import { settings } from '../core/settings.js';
import { clamp } from '../core/math.js';
import { fx } from '../core/rng.js';
import { resolveSound, makeVoice, createReverb } from './sfx.js';
import { MusicDirector } from './music.js';

/** Vanilla's linear rolloff: silent at exactly 16 blocks. */
const ATTENUATION_BLOCKS = 16;
const MAX_VOICES = 48;

/** Category -> the settings slider that drives its bus. `null` = master only. */
const CATEGORY_SETTING = {
  master: 'masterVolume',
  music: 'musicVolume',
  block: 'soundVolume',
  player: 'soundVolume',
  hostile: 'hostileVolume',
  neutral: 'ambientVolume',
  ambient: 'ambientVolume',
  ui: null,
};

const CATEGORY_ALIASES = {
  masterVolume: 'master', musicVolume: 'music', soundVolume: 'block',
  hostileVolume: 'hostile', ambientVolume: 'ambient',
  sound: 'block', blocks: 'block', mob: 'hostile', hostiles: 'hostile',
  friendly: 'neutral', passive: 'neutral', environment: 'ambient', weather: 'ambient',
};

const normCategory = (c) => (typeof c === 'string' ? (CATEGORY_ALIASES[c] ?? c) : 'block');

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.reverb = null;
    this.music = null;
    this.buses = Object.create(null);
    this.volumes = Object.create(null);

    this.listener = { pos: [0, 0, 0], forward: [0, 0, 1], right: [-1, 0, 0] };

    this._ready = false;
    this._voices = [];            // scheduled end times, for the voice cap
    this._pendingMusic = null;
    this._warnedUnknown = false;
    this._warnedSynth = false;
    this._unsubscribe = null;
  }

  get ready() { return this._ready; }

  /** Live voice count, for the debug overlay. */
  get voiceCount() { this._prune(); return this._voices.length; }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Builds the graph. Must be called from a user gesture the first time, and is
   * safe to call on every gesture after that — a suspended context is resumed.
   */
  init() {
    if (this.ctx && this.ctx.state !== 'closed') {
      this._resume();
      return this._ready;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) {
      if (!this._warnedSynth) {
        this._warnedSynth = true;
        console.warn('audio: no Web Audio support — the game will run silently');
      }
      return false;
    }

    let ctx;
    try {
      ctx = new AC();
    } catch (e) {
      console.warn(`audio: could not create an AudioContext (${e.message}) — running silently`);
      return false;
    }
    this.ctx = ctx;

    // A gentle limiter on the sum, so a cave full of mobs cannot clip.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.compressor);

    for (const cat of Object.keys(CATEGORY_SETTING)) {
      if (cat === 'master') continue;
      const bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(this.master);
      this.buses[cat] = bus;
    }

    // One shared short room for the sounds that ask for it.
    this.reverb = createReverb(ctx, { taps: [0.031, 0.049, 0.073, 0.107], feedback: 0.5, damp: 3000, wet: 0.5 });
    this.reverb.output.connect(this.master);

    this.music = new MusicDirector(ctx, this.buses.music);

    this._unsubscribe?.();
    this._unsubscribe = settings.onChange((key) => {
      if (key === '*' || (typeof key === 'string' && key.endsWith('Volume'))) this._applyVolumes();
    });

    this._ready = true;
    this._applyVolumes();
    this._resume();

    if (this._pendingMusic) {
      const pending = this._pendingMusic;
      this._pendingMusic = null;
      this.startMusic(pending);
    }
    return true;
  }

  _resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'suspended') return;
    const p = ctx.resume?.();
    // A rejected resume just means the gesture was not trusted; try again later.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /** Releases the whole graph. The engine can be `init()`ed again afterwards. */
  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.music?.dispose();
    this.music = null;
    this._voices.length = 0;
    this._ready = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = this.compressor = this.reverb = null;
    this.buses = Object.create(null);
    ctx?.close?.();
  }

  // ---------------------------------------------------------------- mixing

  _applyVolumes() {
    if (!this._ready) return;
    const now = this.ctx.currentTime;
    const read = (key) => clamp(Number(settings.get(key) ?? 1) || 0, 0, 1);
    this.volumes.master = read('masterVolume');
    this.master.gain.setTargetAtTime(this.volumes.master, now, 0.02);
    for (const [cat, bus] of Object.entries(this.buses)) {
      const key = CATEGORY_SETTING[cat];
      const v = key ? read(key) : 1;
      this.volumes[cat] = v;
      bus.gain.setTargetAtTime(v, now, 0.02);
    }
  }

  /**
   * Sets one category's level, 0..1. Categories backed by an option write
   * through to `settings` so the audio screen and the engine never disagree.
   */
  setCategoryVolume(cat, v) {
    const category = normCategory(cat);
    const value = clamp(Number(v) || 0, 0, 1);
    const key = CATEGORY_SETTING[category];
    if (key) {
      settings.set(key, value);
      this._applyVolumes();
    } else if (this._ready && this.buses[category]) {
      this.volumes[category] = value;
      this.buses[category].gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    }
    return value;
  }

  // ---------------------------------------------------------------- listener

  /** Places the ears. `forward` is the camera's look vector; +Y is up. */
  setListener(pos, forward) {
    const l = this.listener;
    if (pos && pos.length >= 3) {
      l.pos[0] = pos[0] || 0;
      l.pos[1] = pos[1] || 0;
      l.pos[2] = pos[2] || 0;
    }
    if (forward && forward.length >= 3) {
      const len = Math.hypot(forward[0], forward[1], forward[2]) || 1;
      const f0 = forward[0] / len, f1 = forward[1] / len, f2 = forward[2] / len;
      l.forward[0] = f0; l.forward[1] = f1; l.forward[2] = f2;
      // right = forward x up, with up = (0,1,0), then renormalised for pitch.
      const rx = -f2, rz = f0;
      const rl = Math.hypot(rx, rz) || 1;
      l.right[0] = rx / rl; l.right[1] = 0; l.right[2] = rz / rl;
    }
  }

  // ---------------------------------------------------------------- playback

  _prune() {
    if (!this.ctx) { this._voices.length = 0; return; }
    const now = this.ctx.currentTime;
    let n = 0;
    for (let i = 0; i < this._voices.length; i++) {
      if (this._voices[i] > now) this._voices[n++] = this._voices[i];
    }
    this._voices.length = n;
  }

  /**
   * Plays a sound. `x/y/z` place it in the world; leave them out for a 2D one.
   * Returns its length in seconds, or 0 when nothing was played — this is called
   * from everywhere, so it never throws and never needs guarding at the call site.
   */
  play(name, opts = {}) {
    if (!this._ready || !this.ctx) return 0;
    const def = resolveSound(name);
    if (!def) {
      if (!this._warnedUnknown) {
        this._warnedUnknown = true;
        console.warn(`audio: unknown sound "${name}" — further unknown sounds are ignored silently`);
      }
      return 0;
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') this._resume();

    const category = normCategory(opts.category ?? def.category);
    let gain = (opts.volume ?? 1) * def.volume;
    let pan = 0;

    if (def.spatial && Number.isFinite(opts.x)) {
      const l = this.listener;
      const dx = opts.x - l.pos[0];
      const dy = (Number.isFinite(opts.y) ? opts.y : l.pos[1]) - l.pos[1];
      const dz = (Number.isFinite(opts.z) ? opts.z : l.pos[2]) - l.pos[2];
      const dist = Math.hypot(dx, dy, dz);
      const rolloff = 1 - dist / ATTENUATION_BLOCKS;
      if (rolloff <= 0) return 0;
      gain *= rolloff;
      if (dist > 0.001) {
        // Hard panning right next to your head sounds wrong, so ease it in.
        const side = (dx * l.right[0] + dy * l.right[1] + dz * l.right[2]) / dist;
        pan = clamp(side, -1, 1) * Math.min(1, dist / 2.5) * 0.9;
      }
    }
    if (gain < 0.0008) return 0;

    this._prune();
    if (this._voices.length >= MAX_VOICES) return 0;

    const pitch = clamp(
      (opts.pitch ?? 1) * (1 + (fx.next() - fx.next()) * def.pitchSpread),
      0.5, 2,
    );

    const head = ctx.createGain();
    head.gain.value = gain;
    let node = head;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      node = node.connect(panner);
    }
    node.connect(this.buses[category] ?? this.buses.block);

    if (def.reverb > 0 && this.reverb) {
      const send = ctx.createGain();
      // The tail leaves the category bus behind, so fold its level in here.
      send.gain.value = def.reverb * (this.volumes[category] ?? 1);
      head.connect(send).connect(this.reverb.input);
    }

    const t0 = ctx.currentTime + Math.max(0, opts.delay ?? 0);
    const voice = makeVoice(ctx, head, { t0, gain: 1, pitch, rng: fx });
    try {
      def.synth(voice);
    } catch (e) {
      if (!this._warnedSynth) {
        this._warnedSynth = true;
        console.warn(`audio: "${def.name}" failed to synthesise (${e.message})`);
      }
      return 0;
    }
    this._voices.push(voice.end);
    return Math.max(0, voice.end - t0);
  }

  /** A 2D interface sound: no attenuation, no panning. */
  playUI(name, opts = {}) {
    return this.play(name, { ...opts, category: 'ui', x: undefined, y: undefined, z: undefined });
  }

  // ---------------------------------------------------------------- music

  /** Starts (or crossfades to) a track: 'menu', 'overworld' or 'boss'. */
  startMusic(track, fadeIn = 3) {
    if (!this._ready || !this.music) {
      this._pendingMusic = track;
      return false;
    }
    this.music.start(track, fadeIn);
    return true;
  }

  stopMusic(fade = 2) {
    this._pendingMusic = null;
    this.music?.stop(fade);
  }

  /** The id of the track playing, or null. */
  get currentMusic() { return this.music?.current ?? this._pendingMusic ?? null; }
}

export const audio = new AudioEngine();
