// Every sound effect in the game, synthesised. A small Web Audio toolkit
// (seeded noise tables, envelopes, filtered noise bursts, oscillator stacks and
// a delay-tap reverb) with each sound defined as a short function over it.

import { fx, Random } from '../core/rng.js';
import { clamp } from '../core/math.js';

const MIN_HZ = 20;
const MAX_HZ = 17000;
const clampFreq = (f) => clamp(f, MIN_HZ, MAX_HZ);

// ------------------------------------------------------------------ noise tables

const NOISE_SECONDS = 2;
const NOISE_SEED = 0x5074d13;
const noiseTables = new WeakMap();

function fillNoise(data, kind, rng) {
  const n = data.length;
  if (kind === 'pink') {
    // Paul Kellet's economy pink filter — three one-poles summed.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng.float(-1, 1);
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 0.1050186;
      data[i] = clamp((b0 + b1 + b2 + w * 0.1848) * 0.4, -1, 1);
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.022 * rng.float(-1, 1)) / 1.022;
      data[i] = clamp(last * 3.6, -1, 1);
    }
  } else {
    for (let i = 0; i < n; i++) data[i] = rng.float(-1, 1);
  }
}

/**
 * A looping noise table for this context. Seeded, so a given kind always has
 * the same timbre — only the playback offset and pitch vary per play.
 */
export function noiseBuffer(ctx, kind = 'white') {
  let byKind = noiseTables.get(ctx);
  if (!byKind) noiseTables.set(ctx, (byKind = new Map()));
  const cached = byKind.get(kind);
  if (cached) return cached;
  const length = Math.max(256, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  fillNoise(buffer.getChannelData(0), kind, new Random(NOISE_SEED ^ kind.length * 977));
  byKind.set(kind, buffer);
  return buffer;
}

// ------------------------------------------------------------------ toolkit

/**
 * The little context every sound function is handed: where to write, when to
 * start, how loud, and the per-play pitch multiplier. Frequencies scale with
 * `pitch` and durations scale with `1 / pitch`, exactly as resampling a sample
 * would, so a pitched-up sound is also shorter.
 */
export function makeVoice(ctx, out, opts = {}) {
  const t0 = Number.isFinite(opts.t0) ? opts.t0 : ctx.currentTime;
  return {
    ctx,
    out,
    t0,
    gain: opts.gain ?? 1,
    pitch: clamp(opts.pitch ?? 1, 0.25, 4),
    rng: opts.rng ?? fx,
    end: t0,
  };
}

function mark(v, t) { if (t > v.end) v.end = t; }

/** Attack/decay gain node scheduled at an absolute time. Never rings to zero abruptly. */
export function envelope(v, t, attack, decay, peak) {
  const g = v.ctx.createGain();
  const a = Math.max(0.0005, attack);
  const d = Math.max(0.005, decay);
  const top = Math.max(0.0002, peak * v.gain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(top, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.gain.setValueAtTime(0, t + a + d + 0.002);
  mark(v, t + a + d + 0.03);
  return g;
}

/** Drives an AudioParam with a sine LFO of the given rate and depth. */
function modulate(v, param, t, tEnd, rate, depth) {
  const lfo = v.ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = Math.max(0.01, rate);
  const amp = v.ctx.createGain();
  amp.gain.value = depth;
  lfo.connect(amp);
  amp.connect(param);
  lfo.start(t);
  lfo.stop(tEnd);
}

function biquad(ctx, spec, t, dur, pitch) {
  const f = ctx.createBiquadFilter();
  f.type = spec.type ?? 'lowpass';
  f.Q.value = spec.q ?? 0.7;
  f.frequency.setValueAtTime(clampFreq((spec.freq ?? 1000) * pitch), t);
  if (spec.freqEnd) f.frequency.exponentialRampToValueAtTime(clampFreq(spec.freqEnd * pitch), t + dur);
  return f;
}

/** A filtered burst of noise: the backbone of every impact sound. */
export function noise(v, o = {}) {
  const ctx = v.ctx, p = v.pitch;
  const t = v.t0 + (o.at ?? 0) / p;
  const dur = Math.max(0.005, (o.dur ?? 0.2) / p);
  const attack = (o.attack ?? 0.003) / p;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, o.kind ?? 'white');
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;

  let node = src;
  const type = o.type ?? 'bandpass';
  if (type !== 'none') {
    const f = biquad(ctx, { type, freq: o.freq ?? 1000, freqEnd: o.freqEnd, q: o.q ?? 1 }, t, dur, p);
    if (o.wobble) modulate(v, f.frequency, t, t + attack + dur + 0.05, o.wobble.rate, o.wobble.depth * p);
    node = node.connect(f);
  }
  if (o.second) node = node.connect(biquad(ctx, o.second, t, dur, p));

  const env = envelope(v, t, attack, dur, o.gain ?? 0.4);
  node.connect(env).connect(v.out);
  // A random offset into the table means two plays never phase-align.
  src.start(t, v.rng.float(0, NOISE_SECONDS - 0.8));
  src.stop(t + attack + dur + 0.06);
  return env;
}

/** A single pitched partial with an optional glide, vibrato and filter. */
export function tone(v, o = {}) {
  const ctx = v.ctx, p = v.pitch;
  const t = v.t0 + (o.at ?? 0) / p;
  const dur = Math.max(0.005, (o.dur ?? 0.3) / p);
  const attack = (o.attack ?? 0.004) / p;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(clampFreq((o.freq ?? 440) * p), t);
  if (o.freqMid) osc.frequency.exponentialRampToValueAtTime(clampFreq(o.freqMid * p), t + dur * (o.midAt ?? 0.35));
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(clampFreq(o.freqEnd * p), t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const tEnd = t + attack + dur + 0.06;
  if (o.vibrato) modulate(v, osc.frequency, t, tEnd, o.vibrato.rate, o.vibrato.depth * p);

  let node = osc;
  if (o.filter) node = node.connect(biquad(ctx, o.filter, t, dur, p));
  const env = envelope(v, t, attack, dur, o.gain ?? 0.3);
  node.connect(env).connect(v.out);
  osc.start(t);
  osc.stop(tEnd);
  return env;
}

/** A stack of partials with independent decays — bells, knocks, ringing metal. */
export function stack(v, o = {}) {
  const freqs = o.freqs ?? [];
  const gains = o.gains ?? null;
  const decays = o.decays ?? null;
  for (let i = 0; i < freqs.length; i++) {
    tone(v, {
      at: o.at ?? 0,
      freq: freqs[i],
      dur: (decays ? decays[i] : (o.dur ?? 0.3)) ?? 0.3,
      gain: (o.gain ?? 1) * (gains ? gains[i] : 1 / (i + 1)),
      type: o.type ?? 'sine',
      attack: o.attack ?? 0.002,
      filter: o.filter,
    });
  }
}

/** Bell partials: an inharmonic ratio set with a long, thinning tail. */
export function bell(v, o = {}) {
  const f = o.freq ?? 880;
  const dur = o.dur ?? 0.8;
  stack(v, {
    at: o.at ?? 0,
    freqs: [f, f * 2.0, f * 2.76, f * 5.42],
    gains: [1, 0.42, 0.24, 0.09],
    decays: [dur, dur * 0.7, dur * 0.5, dur * 0.28],
    gain: o.gain ?? 0.25,
    attack: o.attack ?? 0.003,
    type: 'sine',
  });
}

/**
 * A buzzing source pushed through parallel bandpass formants — every mouth in
 * the game (mobs, hurt, death, the boss) is this function with different vowels.
 */
export function formantVoice(v, o = {}) {
  const ctx = v.ctx, p = v.pitch;
  const t = v.t0 + (o.at ?? 0) / p;
  const dur = Math.max(0.02, (o.dur ?? 0.5) / p);
  const attack = (o.attack ?? 0.012) / p;
  const tEnd = t + attack + dur + 0.06;

  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  osc.frequency.setValueAtTime(clampFreq((o.f0 ?? 120) * p), t);
  if (o.f0Mid) osc.frequency.exponentialRampToValueAtTime(clampFreq(o.f0Mid * p), t + dur * (o.midAt ?? 0.4));
  if (o.f0End) osc.frequency.exponentialRampToValueAtTime(clampFreq(o.f0End * p), t + dur);
  if (o.vibrato) modulate(v, osc.frequency, t, tEnd, o.vibrato.rate, o.vibrato.depth * p);

  const body = ctx.createGain();
  body.gain.value = 1;
  const dry = ctx.createGain();
  dry.gain.value = o.dry ?? 0.2;
  osc.connect(dry).connect(body);
  for (const [ff, q, g] of (o.formants ?? [[600, 8, 1], [1100, 10, 0.6]])) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(clampFreq(ff * p), t);
    const lvl = ctx.createGain();
    lvl.gain.value = g;
    osc.connect(bp).connect(lvl).connect(body);
  }

  let node = body;
  if (o.lowpass) node = node.connect(biquad(ctx, { type: 'lowpass', freq: o.lowpass, q: 0.8 }, t, dur, p));
  const env = envelope(v, t, attack, dur, o.gain ?? 0.5);
  node = node.connect(env);
  if (o.tremolo) {
    const trem = ctx.createGain();
    trem.gain.value = 1 - o.tremolo.depth;
    modulate(v, trem.gain, t, tEnd, o.tremolo.rate, o.tremolo.depth);
    node = node.connect(trem);
  }
  node.connect(v.out);
  osc.start(t);
  osc.stop(tEnd);

  if (o.breath) {
    noise(v, {
      at: o.at ?? 0,
      dur: o.breath.dur ?? (o.dur ?? 0.5) * 0.8,
      attack: attack * p * 2,
      gain: o.breath.gain ?? 0.08,
      type: o.breath.type ?? 'highpass',
      freq: o.breath.freq ?? 1600,
      q: o.breath.q ?? 0.8,
      kind: 'pink',
    });
  }
}

/**
 * A Schroeder-ish delay-tap reverb. Four damped, recirculating taps is enough
 * space for a cave without an impulse response file.
 */
export function createReverb(ctx, o = {}) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.gain.value = o.wet ?? 1;
  const taps = o.taps ?? [0.029, 0.047, 0.071, 0.101];
  const feedback = clamp(o.feedback ?? 0.44, 0, 0.8);
  for (let i = 0; i < taps.length; i++) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = taps[i];
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = o.damp ?? 3200;
    const fb = ctx.createGain();
    fb.gain.value = feedback * (1 - i * 0.07);
    const level = ctx.createGain();
    level.gain.value = 1 / taps.length;
    input.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);           // the tail
    damp.connect(level);
    level.connect(output);
  }
  return { input, output };
}

// ------------------------------------------------------------------ registry

/** name -> { synth, category, volume, reverb, spatial, pitchSpread } */
export const SOUNDS = Object.create(null);

/** Alternate names the rest of the game might reasonably ask for. */
export const SOUND_ALIASES = Object.create(null);

function def(name, synth, o = {}) {
  SOUNDS[name] = {
    name,
    synth,
    category: o.category ?? 'block',
    volume: o.volume ?? 1,
    reverb: o.reverb ?? 0,
    spatial: o.spatial !== false,
    pitchSpread: o.pitchSpread ?? 0.1,
  };
}

function alias(from, to) { SOUND_ALIASES[from] = to; }

/** The definition for a sound name, following aliases. `undefined` when unknown. */
export function resolveSound(name) {
  if (typeof name !== 'string') return undefined;
  return SOUNDS[name] ?? SOUNDS[SOUND_ALIASES[name]] ?? undefined;
}

/** Every registered sound name, for tooling and the debug screen. */
export function soundNames() { return Object.keys(SOUNDS).sort(); }

// ------------------------------------------------------------------ block families
//
// One function per `SoundGroup` in world/blocks.js. `m` scales the family for
// the four events: breaking, placing, the mining loop, and footsteps.

const MODES = {
  break: { g: 1.00, l: 1.00 },
  place: { g: 0.80, l: 0.80 },
  dig:   { g: 0.30, l: 0.55 },
  step:  { g: 0.24, l: 0.42 },
};

const FAMILIES = {
  // Hard attack, low-mid thump under a mid-band crack.
  stone(v, m) {
    noise(v, {
      dur: 0.26 * m.l, attack: 0.0012, gain: 0.5 * m.g, kind: 'white',
      type: 'bandpass', freq: 1250, q: 1.2, second: { type: 'lowpass', freq: 6000, q: 0.6 },
    });
    tone(v, { dur: 0.075 * m.l, freq: 94, freqEnd: 62, gain: 0.42 * m.g, attack: 0.001 });
  },

  // Barely a sound at all: a high, dry rustle.
  grass(v, m) {
    noise(v, {
      dur: 0.24 * m.l, attack: 0.009, gain: 0.32 * m.g, kind: 'pink',
      type: 'highpass', freq: 340, q: 0.7, second: { type: 'lowpass', freq: 2600, freqEnd: 1500, q: 0.8 },
    });
  },

  // Leaves and flowers: shorter and brighter than turf.
  plant(v, m) {
    noise(v, {
      dur: 0.15 * m.l, attack: 0.006, gain: 0.26 * m.g, kind: 'pink',
      type: 'highpass', freq: 780, q: 0.6, second: { type: 'lowpass', freq: 4200, q: 0.7 },
    });
  },

  dirt(v, m) {
    noise(v, {
      dur: 0.24 * m.l, attack: 0.006, gain: 0.34 * m.g, kind: 'brown',
      type: 'lowpass', freq: 1400, q: 0.7, second: { type: 'highpass', freq: 180, q: 0.5 },
    });
    tone(v, { dur: 0.06 * m.l, freq: 112, freqEnd: 78, gain: 0.24 * m.g, attack: 0.002 });
  },

  // A resonant knock: a click, two inharmonic partials, a hollow mid band.
  wood(v, m) {
    noise(v, { dur: 0.014 * m.l, attack: 0.0008, gain: 0.26 * m.g, type: 'bandpass', freq: 2100, q: 0.9 });
    stack(v, {
      freqs: [196, 470], gains: [0.5, 0.28], decays: [0.088 * m.l, 0.062 * m.l],
      type: 'triangle', gain: m.g, attack: 0.0015,
    });
    noise(v, {
      dur: 0.1 * m.l, attack: 0.002, gain: 0.16 * m.g, kind: 'pink',
      type: 'bandpass', freq: 620, freqEnd: 430, q: 3.5,
    });
  },

  // Dry and dull — nothing above the low mids, no transient.
  sand(v, m) {
    noise(v, {
      dur: 0.3 * m.l, attack: 0.016, gain: 0.36 * m.g, kind: 'pink',
      type: 'lowpass', freq: 2100, freqEnd: 900, q: 0.6, second: { type: 'highpass', freq: 420, q: 0.5 },
    });
  },

  // Grittier and longer, with a handful of scattered grains on top.
  gravel(v, m) {
    noise(v, {
      dur: 0.24 * m.l, attack: 0.004, gain: 0.3 * m.g, kind: 'pink',
      type: 'bandpass', freq: 1750, q: 0.8,
    });
    tone(v, { dur: 0.065 * m.l, freq: 124, freqEnd: 86, gain: 0.28 * m.g, attack: 0.002 });
    const grains = 3 + v.rng.below(3);
    for (let i = 0; i < grains; i++) {
      noise(v, {
        at: 0.015 + v.rng.float(0, 0.19) * m.l, dur: v.rng.float(0.006, 0.017),
        attack: 0.0007, gain: v.rng.float(0.1, 0.24) * m.g,
        type: 'bandpass', freq: v.rng.float(1500, 2700), q: 2.6,
      });
    }
  },

  // Bright and shattering: a highpassed burst under a spray of shard partials.
  glass(v, m) {
    noise(v, { dur: 0.13 * m.l, attack: 0.0008, gain: 0.3 * m.g, type: 'highpass', freq: 3300, q: 0.8 });
    const shards = 5 + v.rng.below(5);
    for (let i = 0; i < shards; i++) {
      tone(v, {
        at: v.rng.float(0, 0.26) * m.l, dur: v.rng.float(0.05, 0.26) * m.l,
        freq: v.rng.float(2100, 6800), gain: v.rng.float(0.04, 0.12) * m.g, attack: 0.001,
      });
    }
    noise(v, {
      at: 0.04 * m.l, dur: 0.3 * m.l, attack: 0.01, gain: 0.12 * m.g,
      type: 'bandpass', freq: 5200, q: 1.6,
    });
  },

  // Almost no high end at all.
  wool(v, m) {
    noise(v, {
      dur: 0.14 * m.l, attack: 0.012, gain: 0.3 * m.g, kind: 'brown',
      type: 'lowpass', freq: 880, q: 0.7,
    });
  },

  // A ringing bandpass with inharmonic partials, pitched high like vanilla's 1.5x.
  metal(v, m) {
    noise(v, { dur: 0.012 * m.l, attack: 0.0006, gain: 0.2 * m.g, type: 'bandpass', freq: 3000, q: 1 });
    stack(v, {
      freqs: [905, 1447, 2610, 3980], gains: [0.42, 0.3, 0.17, 0.08],
      decays: [0.14 * m.l, 0.115 * m.l, 0.08 * m.l, 0.05 * m.l],
      gain: m.g, attack: 0.0012,
    });
  },

  // Squeaky granular crunch, all of it above 1.5 kHz.
  snow(v, m) {
    noise(v, {
      dur: 0.15 * m.l, attack: 0.008, gain: 0.26 * m.g,
      type: 'highpass', freq: 1600, q: 0.7, second: { type: 'lowpass', freq: 7000, q: 0.6 },
    });
    for (let i = 0; i < 2 + v.rng.below(2); i++) {
      noise(v, {
        at: v.rng.float(0, 0.1) * m.l, dur: v.rng.float(0.005, 0.012), attack: 0.0006,
        gain: 0.12 * m.g, type: 'bandpass', freq: v.rng.float(2600, 5200), q: 3,
      });
    }
  },

  // Thin, hollow wood.
  ladder(v, m) {
    stack(v, {
      freqs: [318, 790], gains: [0.4, 0.22], decays: [0.06 * m.l, 0.045 * m.l],
      type: 'triangle', gain: m.g, attack: 0.001,
    });
    noise(v, { dur: 0.07 * m.l, attack: 0.002, gain: 0.14 * m.g, type: 'bandpass', freq: 1200, q: 2.4 });
  },

  liquid(v, m) {
    noise(v, {
      dur: 0.3 * m.l, attack: 0.006, gain: 0.34 * m.g, kind: 'white',
      type: 'lowpass', freq: 1400, freqEnd: 420, q: 0.9, second: { type: 'highpass', freq: 220, q: 0.5 },
    });
    tone(v, { at: 0.02, dur: 0.07 * m.l, freq: 430, freqEnd: 880, gain: 0.14 * m.g, attack: 0.004 });
  },
};

for (const [group, fn] of Object.entries(FAMILIES)) {
  for (const [mode, m] of Object.entries(MODES)) {
    // Mining ticks four times a second and footsteps every third of a second,
    // so both stay well under the break sound in level.
    def(`${mode}.${group}`, (v) => fn(v, m), {
      category: 'block',
      volume: mode === 'step' ? 0.7 : mode === 'dig' ? 0.8 : 1,
    });
  }
}

// Vanilla quirk worth keeping: glass steps and mining hits sound like stone.
def('step.glass', (v) => FAMILIES.stone(v, MODES.step), { volume: 0.7 });
def('dig.glass', (v) => FAMILIES.stone(v, MODES.dig), { volume: 0.8 });

// ------------------------------------------------------------------ interface + pickups

def('click', (v) => {
  noise(v, { dur: 0.028, attack: 0.0008, gain: 0.3, type: 'bandpass', freq: 1500, q: 3 });
  tone(v, { dur: 0.024, freq: 1250, freqEnd: 900, gain: 0.16, attack: 0.001, type: 'square' });
}, { category: 'ui', volume: 0.45, spatial: false, pitchSpread: 0 });

// The pickup pop: a short rising blip through a narrow band.
def('pop', (v) => {
  tone(v, { dur: 0.05, freq: 720, freqEnd: 1560, gain: 0.34, attack: 0.001 });
  noise(v, { dur: 0.045, attack: 0.001, gain: 0.16, type: 'bandpass', freq: 1100, q: 3 });
}, { category: 'player', volume: 0.5, spatial: false, pitchSpread: 0.35 });

// Experience: a bright little bell with a glide into it.
def('xp', (v) => {
  tone(v, { dur: 0.035, freq: 800, freqEnd: 1400, gain: 0.14, attack: 0.002 });
  bell(v, { freq: 880, dur: 0.3, gain: 0.2 });
  bell(v, { at: 0.02, freq: 1320, dur: 0.22, gain: 0.1 });
}, { category: 'player', volume: 0.55, spatial: false, reverb: 0.2, pitchSpread: 0.14 });

def('level_up', (v) => {
  const notes = [440, 523.25, 659.25, 880];        // A minor, rising
  notes.forEach((f, i) => bell(v, { at: i * 0.085, freq: f, dur: 1 - i * 0.09, gain: 0.2 }));
}, { category: 'player', volume: 0.8, spatial: false, reverb: 0.45, pitchSpread: 0.02 });

def('quest_complete', (v) => {
  const notes = [349.23, 523.25, 698.46];          // F major over a soft swell
  notes.forEach((f, i) => bell(v, { at: i * 0.13, freq: f, dur: 1.5 - i * 0.2, gain: 0.18 }));
  tone(v, { dur: 1.4, freq: 174.61, gain: 0.1, attack: 0.35, type: 'triangle' });
}, { category: 'player', volume: 0.85, spatial: false, reverb: 0.5, pitchSpread: 0.02 });

// ------------------------------------------------------------------ the player

def('hurt', (v) => {
  formantVoice(v, {
    dur: 0.42, f0: 132, f0Mid: 116, f0End: 94, midAt: 0.3, type: 'sawtooth',
    formants: [[600, 8, 1], [1100, 10, 0.6], [2500, 12, 0.22]],
    lowpass: 3400, gain: 0.5, attack: 0.008, dry: 0.18,
    breath: { freq: 1700, q: 0.8, gain: 0.13, dur: 0.3 },
  });
}, { category: 'player', volume: 0.9, pitchSpread: 0.1 });

def('death', (v) => {
  formantVoice(v, {
    dur: 1.1, f0: 150, f0Mid: 118, f0End: 80, midAt: 0.35, type: 'sawtooth',
    formants: [[560, 8, 1], [1050, 10, 0.55], [2400, 12, 0.18]],
    lowpass: 2800, gain: 0.5, attack: 0.012, dry: 0.2,
    tremolo: { rate: 6, depth: 0.25 },
    breath: { freq: 1400, q: 0.7, gain: 0.16, dur: 1 },
  });
}, { category: 'player', volume: 1, reverb: 0.2, pitchSpread: 0.08 });

def('eat', (v) => {
  // Three chomps at roughly 12 Hz, filter sweeping open then shut again.
  for (let i = 0; i < 3; i++) {
    noise(v, {
      at: i * 0.085, dur: 0.06, attack: 0.008, gain: 0.26 - i * 0.03, kind: 'brown',
      type: 'lowpass', freq: 500 + i * 480, freqEnd: 460, q: 1.2,
    });
  }
}, { category: 'player', volume: 0.7 });

def('bow', (v) => {
  noise(v, { dur: 0.13, attack: 0.002, gain: 0.4, type: 'bandpass', freq: 2500, freqEnd: 600, q: 4 });
  tone(v, { dur: 0.06, freq: 124, freqEnd: 88, gain: 0.24, attack: 0.002 });
}, { category: 'player', volume: 0.9 });

def('arrow_hit', (v) => {
  noise(v, { dur: 0.006, attack: 0.0005, gain: 0.34, type: 'highpass', freq: 3000, q: 0.8 });
  tone(v, { dur: 0.08, freq: 500, freqEnd: 380, gain: 0.24, attack: 0.001 });
  tone(v, { dur: 0.06, freq: 152, freqEnd: 110, gain: 0.2, attack: 0.001 });
}, { category: 'player', volume: 0.85 });

def('splash', (v) => {
  noise(v, {
    dur: 0.34, attack: 0.004, gain: 0.44, kind: 'white',
    type: 'lowpass', freq: 1500, freqEnd: 380, q: 0.9, second: { type: 'highpass', freq: 210, q: 0.5 },
  });
  for (let i = 0; i < 3; i++) {
    tone(v, { at: 0.02 + i * 0.04, dur: 0.06, freq: 400 + i * 90, freqEnd: 900 + i * 120, gain: 0.09, attack: 0.004 });
  }
}, { category: 'ambient', volume: 0.8, pitchSpread: 0.2 });

def('swim', (v) => {
  noise(v, {
    dur: 0.28, attack: 0.03, gain: 0.24, kind: 'pink',
    type: 'lowpass', freq: 900, freqEnd: 350, q: 0.8,
  });
}, { category: 'ambient', volume: 0.6, pitchSpread: 0.2 });

// ------------------------------------------------------------------ world + blocks with moving parts

def('door_open', (v) => {
  tone(v, {
    dur: 0.45, freq: 300, freqMid: 470, freqEnd: 560, midAt: 0.5, type: 'sawtooth',
    gain: 0.16, attack: 0.02, vibrato: { rate: 14, depth: 34 },
    filter: { type: 'bandpass', freq: 800, q: 6 },
  });
  tone(v, { at: 0.44, dur: 0.09, freq: 92, freqEnd: 66, gain: 0.28, attack: 0.002 });
}, { category: 'block', volume: 0.9, pitchSpread: 0.06 });

def('door_close', (v) => {
  tone(v, {
    dur: 0.32, freq: 540, freqEnd: 300, type: 'sawtooth',
    gain: 0.14, attack: 0.02, vibrato: { rate: 16, depth: 30 },
    filter: { type: 'bandpass', freq: 760, q: 6 },
  });
  tone(v, { at: 0.31, dur: 0.11, freq: 105, freqEnd: 62, gain: 0.34, attack: 0.001 });
  noise(v, { at: 0.31, dur: 0.05, attack: 0.001, gain: 0.16, type: 'bandpass', freq: 1400, q: 1.5 });
}, { category: 'block', volume: 0.9, pitchSpread: 0.06 });

def('chest_open', (v) => {
  tone(v, {
    dur: 0.3, freq: 420, freqEnd: 690, type: 'sawtooth', gain: 0.11, attack: 0.03,
    vibrato: { rate: 18, depth: 26 }, filter: { type: 'bandpass', freq: 1100, q: 7 },
  });
  noise(v, { dur: 0.08, attack: 0.004, gain: 0.1, kind: 'pink', type: 'bandpass', freq: 900, q: 2 });
}, { category: 'block', volume: 0.55, pitchSpread: 0.06 });

def('chest_close', (v) => {
  tone(v, {
    dur: 0.22, freq: 660, freqEnd: 400, type: 'sawtooth', gain: 0.1, attack: 0.03,
    vibrato: { rate: 18, depth: 24 }, filter: { type: 'bandpass', freq: 1050, q: 7 },
  });
  FAMILIES.wood(v, { g: 0.7, l: 0.9 });
}, { category: 'block', volume: 0.55, pitchSpread: 0.06 });

def('explode', (v) => {
  noise(v, {
    dur: 0.8, attack: 0.004, gain: 0.85, kind: 'white',
    type: 'lowpass', freq: 3000, freqEnd: 90, q: 0.9,
  });
  tone(v, { dur: 0.9, freq: 92, freqEnd: 34, gain: 0.6, attack: 0.006 });
  noise(v, { at: 0.05, dur: 1.5, attack: 0.25, gain: 0.3, kind: 'brown', type: 'lowpass', freq: 220, freqEnd: 90, q: 0.6 });
  noise(v, { dur: 0.05, attack: 0.001, gain: 0.3, type: 'highpass', freq: 2400, q: 0.7 });
}, { category: 'block', volume: 1, reverb: 0.55, pitchSpread: 0.12 });

// The creeper fuse and primed TNT: a hiss that rises and swells.
def('fuse', (v) => {
  noise(v, {
    dur: 1.3, attack: 0.35, gain: 0.26, type: 'highpass', freq: 3600, freqEnd: 6200, q: 0.8,
    second: { type: 'bandpass', freq: 4800, freqEnd: 7000, q: 1 },
  });
  for (let i = 0; i < 8; i++) {
    noise(v, {
      at: v.rng.float(0.1, 1.2), dur: v.rng.float(0.004, 0.012), attack: 0.0006,
      gain: v.rng.float(0.04, 0.11), type: 'bandpass', freq: v.rng.float(4000, 9000), q: 3,
    });
  }
}, { category: 'block', volume: 0.8, pitchSpread: 0.06 });

def('fire', (v) => {
  noise(v, {
    dur: 1.4, attack: 0.2, gain: 0.2, kind: 'brown', type: 'lowpass', freq: 800, q: 0.8,
    wobble: { rate: 0.7, depth: 260 },
  });
  for (let i = 0; i < 6; i++) {
    noise(v, {
      at: v.rng.float(0, 1.3), dur: v.rng.float(0.005, 0.015), attack: 0.0008,
      gain: v.rng.float(0.05, 0.14), type: 'bandpass', freq: v.rng.float(1500, 5000), q: 2.5,
    });
  }
}, { category: 'ambient', volume: 0.6, pitchSpread: 0.25 });

def('lava_pop', (v) => {
  tone(v, { dur: 0.09, freq: 220, freqEnd: 80, gain: 0.34, attack: 0.002 });
  noise(v, { at: 0.01, dur: 0.06, attack: 0.003, gain: 0.2, kind: 'brown', type: 'lowpass', freq: 700, q: 0.8 });
}, { category: 'ambient', volume: 0.35, pitchSpread: 0.08 });

// ------------------------------------------------------------------ mob voices

function zombieVoice(v, o) {
  formantVoice(v, {
    dur: o.dur, f0: o.f0, f0Mid: o.mid, f0End: o.end, midAt: 0.4, type: 'sawtooth',
    formants: [[500, 6, 1], [900, 8, 0.6], [2400, 10, 0.2]],
    lowpass: 3000, gain: o.gain ?? 0.55, attack: o.attack ?? 0.02, dry: 0.25,
    vibrato: { rate: 4, depth: o.f0 * 0.03 },
    breath: { freq: 1200, q: 0.7, gain: 0.08, dur: o.dur * 0.9 },
  });
}
def('zombie_idle', (v) => zombieVoice(v, { dur: 1.4, f0: 100, mid: 86, end: 70 }), { category: 'hostile', volume: 0.9, reverb: 0.15 });
def('zombie_hurt', (v) => zombieVoice(v, { dur: 0.55, f0: 112, mid: 96, end: 80, gain: 0.6, attack: 0.01 }), { category: 'hostile' });
def('zombie_death', (v) => zombieVoice(v, { dur: 1.2, f0: 100, mid: 74, end: 55, gain: 0.6 }), { category: 'hostile', reverb: 0.2 });

function boneRattle(v, { grains, spread, gain, bright }) {
  for (let i = 0; i < grains; i++) {
    const f = v.rng.float(900, bright ? 2200 : 1900);
    stack(v, {
      at: v.rng.float(0, spread),
      freqs: [f, f * 1.58], gains: [0.6, 0.3],
      decays: [v.rng.float(0.015, 0.03), 0.015],
      gain, attack: 0.0006,
    });
  }
  tone(v, { dur: 0.35, freq: 300, gain: gain * 0.14, attack: 0.02, type: 'triangle' });
}
def('skeleton_idle', (v) => boneRattle(v, { grains: 6 + v.rng.below(5), spread: 0.42, gain: 0.4, bright: false }),
  { category: 'hostile', volume: 0.85, reverb: 0.2 });
def('skeleton_hurt', (v) => {
  boneRattle(v, { grains: 8 + v.rng.below(4), spread: 0.25, gain: 0.45, bright: true });
  noise(v, { dur: 0.006, attack: 0.0005, gain: 0.3, type: 'highpass', freq: 2400, q: 0.8 });
}, { category: 'hostile' });
def('skeleton_death', (v) => {
  boneRattle(v, { grains: 12 + v.rng.below(6), spread: 0.6, gain: 0.4, bright: true });
  noise(v, { at: 0.5, dur: 0.25, attack: 0.01, gain: 0.12, kind: 'pink', type: 'bandpass', freq: 1400, q: 1.2 });
}, { category: 'hostile', reverb: 0.2 });

def('creeper_hiss', (v) => {
  noise(v, {
    dur: 1.5, attack: 0.22, gain: 0.42, type: 'bandpass', freq: 760, freqEnd: 1800, q: 1.5,
    second: { type: 'highpass', freq: 500, q: 0.6 },
  });
}, { category: 'hostile', volume: 0.9, pitchSpread: 0.05 });

def('spider_hiss', (v) => {
  noise(v, {
    dur: 0.7, attack: 0.02, gain: 0.34, type: 'bandpass', freq: 3000, q: 2,
    wobble: { rate: 12, depth: 400 },
  });
  for (let i = 0; i < 4 + v.rng.below(5); i++) {
    noise(v, {
      at: v.rng.float(0, 0.2), dur: 0.004, attack: 0.0005, gain: v.rng.float(0.06, 0.14),
      type: 'bandpass', freq: v.rng.float(6000, 10000), q: 4,
    });
  }
}, { category: 'hostile', volume: 0.8 });

function pigVoice(v, o) {
  formantVoice(v, {
    dur: o.dur, f0: o.f0, f0Mid: o.mid, f0End: o.end, midAt: 0.35, type: 'sawtooth',
    formants: [[700, 8, 1], [1300, 8, 0.5], [2400, 6, 0.15]],
    lowpass: 3200, gain: o.gain ?? 0.5, attack: 0.018, dry: 0.14,
    breath: { freq: 2000, q: 1.2, gain: 0.07, dur: o.dur * 0.8 },
  });
}
function cowVoice(v, o) {
  formantVoice(v, {
    dur: o.dur, f0: o.f0, f0Mid: o.mid, f0End: o.end, midAt: 0.45, type: 'sawtooth',
    formants: [[450, 7, 1], [1000, 8, 0.5], [2300, 9, 0.15]],
    lowpass: 4000, gain: o.gain ?? 0.5, attack: 0.05, dry: 0.18,
    vibrato: { rate: 5, depth: o.f0 * 0.02 },
  });
}
function sheepVoice(v, o) {
  formantVoice(v, {
    dur: o.dur, f0: o.f0, f0End: o.end, type: 'sawtooth',
    formants: [[700, 8, 1], [1250, 9, 0.55], [2600, 8, 0.2]],
    lowpass: 4200, gain: o.gain ?? 0.42, attack: 0.03, dry: 0.16,
    vibrato: { rate: 20, depth: o.f0 * 0.06 },
    tremolo: { rate: 20, depth: 0.5 },
  });
}
function chickenVoice(v, o) {
  for (let i = 0; i < o.clucks; i++) {
    formantVoice(v, {
      at: i * 0.16, dur: 0.11, f0: o.f0 * (1 + i * 0.05), f0End: 400, type: 'square',
      formants: [[1200, 10, 1], [2600, 8, 0.35]],
      lowpass: 5200, gain: o.gain ?? 0.32, attack: 0.005, dry: 0.08,
    });
  }
}
def('pig', (v) => pigVoice(v, { dur: 0.5, f0: 200, mid: 285, end: 175 }), { category: 'neutral', volume: 0.85 });
def('pig_hurt', (v) => pigVoice(v, { dur: 0.3, f0: 265, mid: 335, end: 205, gain: 0.6 }), { category: 'neutral' });
def('pig_death', (v) => pigVoice(v, { dur: 0.8, f0: 235, mid: 190, end: 120, gain: 0.6 }), { category: 'neutral' });
def('cow', (v) => cowVoice(v, { dur: 1.5, f0: 150, mid: 130, end: 110 }), { category: 'neutral', volume: 0.9, reverb: 0.15 });
def('cow_hurt', (v) => cowVoice(v, { dur: 0.6, f0: 175, mid: 150, end: 120, gain: 0.55 }), { category: 'neutral' });
def('cow_death', (v) => cowVoice(v, { dur: 1.6, f0: 150, mid: 120, end: 88, gain: 0.55 }), { category: 'neutral' });
def('sheep', (v) => sheepVoice(v, { dur: 0.85, f0: 260, end: 220 }), { category: 'neutral', volume: 0.85 });
def('sheep_hurt', (v) => sheepVoice(v, { dur: 0.45, f0: 300, end: 250, gain: 0.5 }), { category: 'neutral' });
def('sheep_death', (v) => sheepVoice(v, { dur: 1, f0: 250, end: 180, gain: 0.5 }), { category: 'neutral' });
def('chicken', (v) => chickenVoice(v, { clucks: 2 + v.rng.below(2), f0: 700 }), { category: 'neutral', volume: 0.8 });
def('chicken_hurt', (v) => chickenVoice(v, { clucks: 1, f0: 900, gain: 0.4 }), { category: 'neutral' });
def('chicken_death', (v) => chickenVoice(v, { clucks: 3, f0: 820, gain: 0.4 }), { category: 'neutral' });

// The villager: mouth closed, two tones, nasal.
function villagerVoice(v, o) {
  formantVoice(v, {
    dur: o.dur, f0: o.a, f0Mid: o.b, f0End: o.c, midAt: 0.45, type: 'sawtooth',
    formants: [[280, 10, 1], [1100, 12, 0.4]],
    lowpass: 900, gain: o.gain ?? 0.55, attack: 0.04, dry: 0.1,
    vibrato: { rate: 6, depth: o.a * 0.02 },
  });
}
def('villager_hmm', (v) => villagerVoice(v, { dur: 0.8, a: 130, b: 175, c: 122 }), { category: 'neutral', volume: 0.9 });
def('villager_yes', (v) => villagerVoice(v, { dur: 0.5, a: 128, b: 168, c: 205 }), { category: 'neutral', volume: 0.9 });
def('villager_no', (v) => villagerVoice(v, { dur: 0.6, a: 158, b: 130, c: 96 }), { category: 'neutral', volume: 0.9 });

// The Hollow Warden.
def('boss_roar', (v) => {
  formantVoice(v, {
    dur: 1.8, f0: 62, f0Mid: 78, f0End: 44, midAt: 0.3, type: 'sawtooth',
    formants: [[180, 6, 1], [420, 8, 0.7], [900, 9, 0.28]],
    lowpass: 1800, gain: 0.7, attack: 0.06, dry: 0.3,
    vibrato: { rate: 5.5, depth: 2.4 },
  });
  noise(v, { dur: 1.9, attack: 0.15, gain: 0.28, kind: 'brown', type: 'lowpass', freq: 700, freqEnd: 170, q: 0.8 });
  tone(v, { dur: 2, freq: 41, freqEnd: 28, gain: 0.34, attack: 0.08 });
}, { category: 'hostile', volume: 1, reverb: 0.6, pitchSpread: 0.06 });

def('boss_hurt', (v) => {
  formantVoice(v, {
    dur: 0.7, f0: 74, f0Mid: 66, f0End: 48, type: 'sawtooth',
    formants: [[200, 6, 1], [460, 8, 0.6]],
    lowpass: 2000, gain: 0.65, attack: 0.01, dry: 0.28,
  });
  noise(v, { dur: 0.5, attack: 0.01, gain: 0.2, kind: 'brown', type: 'lowpass', freq: 900, freqEnd: 260, q: 0.8 });
}, { category: 'hostile', volume: 1, reverb: 0.35 });

// ------------------------------------------------------------------ aliases

alias('ui.click', 'click');
alias('ui_click', 'click');
alias('button', 'click');
alias('item_pickup', 'pop');
alias('pickup', 'pop');
alias('orb', 'xp');
alias('xp_orb', 'xp');
alias('experience', 'xp');
alias('creeper_fuse', 'fuse');
alias('creeper_primed', 'fuse');
alias('tnt_fuse', 'fuse');
alias('player_hurt', 'hurt');
alias('player_death', 'death');
alias('drink', 'eat');
alias('bow_shoot', 'bow');
alias('fizz', 'splash');
alias('withered_husk_idle', 'zombie_idle');
alias('withered_husk_hurt', 'zombie_hurt');
alias('withered_husk_death', 'zombie_death');
alias('hollow_warden_idle', 'boss_roar');
alias('hollow_warden_hurt', 'boss_hurt');
alias('hollow_warden_death', 'boss_roar');
alias('creeper_hurt', 'spider_hiss');
alias('creeper_death', 'explode');
alias('spider_hurt', 'spider_hiss');
alias('spider_death', 'spider_hiss');
alias('villager_idle', 'villager_hmm');
alias('villager_hurt', 'villager_no');
alias('villager_death', 'villager_no');
alias('npc_talk', 'villager_hmm');
