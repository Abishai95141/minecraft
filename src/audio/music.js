// Original ambient music, composed at runtime from scheduled oscillator voices.
// Three pieces — a menu theme, a calm overworld theme and a tense boss theme —
// all slow, modal and sparse. Nothing here transcribes anything that exists.

import { fx } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { makeVoice, tone, stack, bell, createReverb } from './sfx.js';

/** Equal temperament, MIDI note number to Hz. */
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const LOOKAHEAD = 4;          // seconds of music scheduled ahead of the clock
const TICK_MS = 250;

// ------------------------------------------------------------------ the pieces
//
// Phrases are written as beat offsets into a bar plus an index into the track's
// `lead` set, so a piece is a small table rather than a wall of note events.
// `leadEvery` and `leadChance` are what keep the air in it: most bars are pad,
// bass and silence, and a melodic phrase only sometimes answers.

export const TRACKS = {
  menu: {
    id: 'menu',
    title: 'Emberlight',
    bpm: 62,
    beatsPerBar: 4,
    gain: 0.5,
    padGain: 0.055,
    bassGain: 0.13,
    leadGain: 0.16,
    wet: 0.4,
    leadEvery: 2,
    leadChance: 0.55,
    chimeChance: 0.12,
    // A minor, moving vi - IV - I - v with a suspended, open voicing.
    chords: [
      { bars: 2, bass: 45, pad: [57, 60, 64, 71] },   // Am add9
      { bars: 2, bass: 41, pad: [53, 60, 64, 69] },   // Fmaj7
      { bars: 2, bass: 48, pad: [55, 59, 64, 67] },   // Cmaj7
      { bars: 2, bass: 40, pad: [55, 59, 62, 67] },   // Em7
    ],
    lead: [69, 72, 74, 76, 79, 81, 84],               // A4 C5 D5 E5 G5 A5 C6
    phrases: [
      [{ b: 0, n: 5, l: 1.5 }, { b: 1.5, n: 3, l: 1 }, { b: 2.5, n: 4, l: 1.5 }],
      [{ b: 0.5, n: 3, l: 1 }, { b: 1.5, n: 1, l: 1 }, { b: 3, n: 0, l: 2 }],
      [{ b: 0, n: 6, l: 2, v: 0.8 }, { b: 2, n: 5, l: 2 }],
      [{ b: 1, n: 2, l: 0.5 }, { b: 1.5, n: 3, l: 0.5 }, { b: 2, n: 5, l: 2.5 }],
      [{ b: 0, n: 4, l: 1 }, { b: 1, n: 3, l: 1 }, { b: 2, n: 1, l: 2 }],
    ],
  },

  overworld: {
    id: 'overworld',
    title: 'Long Meadow',
    bpm: 66,
    beatsPerBar: 4,
    gain: 0.42,
    padGain: 0.05,
    bassGain: 0.11,
    leadGain: 0.14,
    wet: 0.45,
    leadEvery: 2,
    leadChance: 0.45,
    chimeChance: 0.14,
    // F Lydian: the raised fourth lives in the second chord, over an F pedal.
    chords: [
      { bars: 2, bass: 41, pad: [60, 64, 67, 69] },   // Fmaj9
      { bars: 2, bass: 41, pad: [59, 62, 67, 71] },   // G/F  (the B natural)
      { bars: 2, bass: 45, pad: [57, 60, 64, 67] },   // Am7
      { bars: 2, bass: 48, pad: [62, 67, 72, 76] },   // Csus2
    ],
    lead: [72, 74, 76, 77, 79, 81, 83, 84],           // C5 D5 E5 F5 G5 A5 B5 C6
    phrases: [
      [{ b: 0, n: 3, l: 1 }, { b: 1, n: 4, l: 1 }, { b: 2, n: 5, l: 2 }],
      [{ b: 0.5, n: 5, l: 1.5 }, { b: 2, n: 6, l: 0.5 }, { b: 2.5, n: 7, l: 1.5 }],
      [{ b: 0, n: 7, l: 1.5, v: 0.85 }, { b: 1.5, n: 5, l: 1 }, { b: 3, n: 4, l: 1 }],
      [{ b: 1, n: 0, l: 1 }, { b: 2, n: 2, l: 1 }, { b: 3, n: 4, l: 1.5 }],
      [{ b: 0, n: 4, l: 2 }, { b: 2.5, n: 3, l: 1.5 }],
      [{ b: 0, n: 2, l: 0.75 }, { b: 0.75, n: 3, l: 0.75 }, { b: 1.5, n: 5, l: 2.5 }],
    ],
  },

  boss: {
    id: 'boss',
    title: 'The Deep Hollow',
    bpm: 70,
    beatsPerBar: 4,
    gain: 0.5,
    padGain: 0.06,
    bassGain: 0.17,
    leadGain: 0.13,
    wet: 0.55,
    leadEvery: 2,
    leadChance: 0.7,
    chimeChance: 0,
    bassPulse: true,
    drone: 33,
    detune: 16,
    // A Phrygian. The flat second (Bb) is the whole mood.
    chords: [
      { bars: 2, bass: 33, pad: [57, 60, 64] },       // Am
      { bars: 2, bass: 34, pad: [58, 62, 65] },       // Bbmaj  (bII)
      { bars: 2, bass: 33, pad: [57, 60, 64] },       // Am
      { bars: 2, bass: 29, pad: [57, 60, 65] },       // F/A
    ],
    lead: [57, 58, 60, 62, 64, 65, 69],               // A3 Bb3 C4 D4 E4 F4 A4
    phrases: [
      [{ b: 0, n: 6, l: 1 }, { b: 1, n: 5, l: 1 }, { b: 2, n: 4, l: 2 }],
      [{ b: 0, n: 1, l: 0.5 }, { b: 0.5, n: 0, l: 3 }],
      [{ b: 0, n: 4, l: 1 }, { b: 1.5, n: 3, l: 1 }, { b: 3, n: 1, l: 1 }],
      [{ b: 2, n: 5, l: 1 }, { b: 3, n: 4, l: 1.5 }],
    ],
  },
};

const TRACK_ALIASES = {
  title: 'menu', main: 'menu', mainmenu: 'menu', credits: 'menu',
  game: 'overworld', world: 'overworld', story: 'overworld', calm: 'overworld',
  combat: 'boss', battle: 'boss', warden: 'boss',
};

/** Every playable track id. */
export function trackNames() { return Object.keys(TRACKS); }

/** The track for a name, following aliases. `null` when there is no such track. */
export function resolveTrack(name) {
  if (typeof name !== 'string') return null;
  return TRACKS[name] ?? TRACKS[TRACK_ALIASES[name]] ?? null;
}

// ------------------------------------------------------------------ one playing piece

/**
 * A single piece playing on its own chain, with its own reverb and its own
 * lookahead scheduler. Fading two of these at once is the crossfade.
 */
class Piece {
  constructor(ctx, out, track, rng) {
    this.ctx = ctx;
    this.track = track;
    this.rng = rng;
    this.beatSeconds = 60 / track.bpm;
    this.barSeconds = this.beatSeconds * track.beatsPerBar;
    this.cycleBars = track.chords.reduce((n, c) => n + c.bars, 0);

    this.fade = ctx.createGain();
    this.fade.gain.value = 0.0001;
    this.fade.connect(out);

    this.input = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1 - (track.wet ?? 0.4) * 0.5;
    this.input.connect(dry).connect(this.fade);

    // A long, dark tail — the "generous space" only reads as space with one.
    this.reverb = createReverb(ctx, {
      taps: [0.043, 0.071, 0.101, 0.137], feedback: 0.72, damp: 3600, wet: track.wet ?? 0.4,
    });
    this.input.connect(this.reverb.input);
    this.reverb.output.connect(this.fade);

    this.bar = 0;
    this.nextBar = 0;
    this.lastPhraseBar = -99;
    this.timer = null;
    this.stopTimer = null;
    this.stopping = false;
  }

  start(fadeIn = 3) {
    const now = this.ctx.currentTime;
    this.nextBar = now + 0.15;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(0.0001, now);
    this.fade.gain.linearRampToValueAtTime(this.track.gain, now + Math.max(0.05, fadeIn));
    this._tick();
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop(fade = 2) {
    if (this.stopping) return;
    this.stopping = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    const now = this.ctx.currentTime;
    const f = Math.max(0.05, fade);
    // Ramp from wherever it actually is, so stopping mid-fade-in never clicks.
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(Math.max(0.0001, this.fade.gain.value), now);
    this.fade.gain.exponentialRampToValueAtTime(0.0001, now + f);
    this.fade.gain.setValueAtTime(0, now + f + 0.01);
    // Notes already scheduled keep ringing under the fade; tear down after it.
    this.stopTimer = setTimeout(() => this.dispose(), (f + 0.3) * 1000);
  }

  dispose() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.stopTimer !== null) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    this.fade.disconnect();
    this.input.disconnect();
    this.reverb.output.disconnect();
  }

  // ---------------------------------------------------------------- voices

  _voice(t) {
    return makeVoice(this.ctx, this.input, { t0: t, gain: 1, pitch: 1, rng: this.rng });
  }

  /** Soft-attack, piano-ish: a few slightly stretched partials with a long tail. */
  _piano(t, freq, gain, dur) {
    const v = this._voice(t);
    stack(v, {
      freqs: [freq, freq * 2.003, freq * 3.011, freq * 4.02, freq * 5.04],
      gains: [1, 0.32, 0.15, 0.07, 0.03],
      decays: [dur, dur * 0.62, dur * 0.42, dur * 0.28, dur * 0.18],
      gain, attack: 0.022, type: 'sine',
    });
  }

  /** The bed: detuned triangles under a soft lowpass, swelling across the chord. */
  _pad(t, notes, gain, dur) {
    const v = this._voice(t);
    const detune = this.track.detune ?? 7;
    for (let i = 0; i < notes.length; i++) {
      const f = hz(notes[i]);
      for (const d of [-detune, detune]) {
        tone(v, {
          freq: f, detune: d, dur, gain: gain * (1 - i * 0.12),
          attack: dur * 0.35, type: 'triangle',
          filter: { type: 'lowpass', freq: 1200 - i * 90, q: 0.7 },
        });
      }
    }
  }

  _bass(t, note, gain, dur) {
    const v = this._voice(t);
    const f = hz(note);
    tone(v, { freq: f, dur, gain, attack: 0.06, type: 'sine' });
    tone(v, { freq: f * 2, dur: dur * 0.45, gain: gain * 0.22, attack: 0.05, type: 'triangle' });
  }

  _chime(t, note, gain) {
    bell(this._voice(t), { freq: hz(note), dur: 2.6, gain });
  }

  // ---------------------------------------------------------------- scheduling

  _chordAt(bar) {
    let b = ((bar % this.cycleBars) + this.cycleBars) % this.cycleBars;
    for (const c of this.track.chords) {
      if (b < c.bars) return { chord: c, offset: b };
      b -= c.bars;
    }
    return { chord: this.track.chords[0], offset: 0 };
  }

  _tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextBar < horizon && guard++ < 8) {
      this._emitBar(this.bar, this.nextBar);
      this.nextBar += this.barSeconds;
      this.bar++;
    }
  }

  _emitBar(bar, t) {
    const tr = this.track;
    const { chord, offset } = this._chordAt(bar);

    if (offset === 0) {
      this._pad(t, chord.pad, tr.padGain, this.barSeconds * chord.bars * 0.75);
      this._bass(t, chord.bass, tr.bassGain, this.barSeconds * 0.9);
      if (tr.drone) this._bass(t, tr.drone, tr.bassGain * 0.5, this.barSeconds * chord.bars);
    } else if (tr.bassPulse) {
      this._bass(t, chord.bass, tr.bassGain * 0.7, this.barSeconds * 0.5);
    }
    if (tr.bassPulse) {
      this._bass(t + this.beatSeconds * 2, chord.bass, tr.bassGain * 0.45, this.beatSeconds * 1.2);
    }

    // Melody: only on phrase bars, never on top of the previous phrase.
    if (bar % tr.leadEvery === 0 && bar - this.lastPhraseBar >= tr.leadEvery * 2 && this.rng.bool(tr.leadChance)) {
      this.lastPhraseBar = bar;
      const phrase = this.rng.pick(tr.phrases);
      for (const n of phrase) {
        this._piano(
          t + n.b * this.beatSeconds,
          hz(tr.lead[n.n]),
          tr.leadGain * (n.v ?? 1),
          n.l * this.beatSeconds * 1.9,
        );
      }
    } else if (tr.chimeChance && this.rng.bool(tr.chimeChance)) {
      // Answering the silence with one distant note two octaves up.
      this._chime(t + this.beatSeconds * this.rng.int(0, 3), tr.lead[tr.lead.length - 1] + 12, tr.leadGain * 0.4);
    }
  }
}

// ------------------------------------------------------------------ director

/** Owns whichever piece is playing and crossfades between them. */
export class MusicDirector {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = destination;
    this.piece = null;
    this.retiring = [];
    this._warned = false;
  }

  get current() { return this.piece && !this.piece.stopping ? this.piece.track.id : null; }
  get playing() { return this.current !== null; }

  /** Starts a track, crossfading out whatever is playing. Same track = no-op. */
  start(name, fadeIn = 3) {
    let track = resolveTrack(name);
    if (!track) {
      if (!this._warned) {
        this._warned = true;
        console.warn(`music: unknown track "${name}" — falling back to the overworld theme`);
      }
      track = TRACKS.overworld;
    }
    if (this.current === track.id) return this.piece;

    this.stop(Math.max(1.5, fadeIn * 0.6));
    const piece = new Piece(this.ctx, this.out, track, fx.fork(track.id));
    piece.start(fadeIn);
    this.piece = piece;
    return piece;
  }

  /** Fades the current piece out. `fade` is in seconds. */
  stop(fade = 2) {
    const piece = this.piece;
    if (!piece) return;
    this.piece = null;
    piece.stop(fade);
    this.retiring.push(piece);
    // Drop finished pieces so the list cannot grow across a long session.
    this.retiring = this.retiring.filter((p) => p.timer !== null || p.stopTimer !== null);
  }

  /** Hard teardown, used when the audio context is being thrown away. */
  dispose() {
    if (this.piece) { this.piece.dispose(); this.piece = null; }
    for (const p of this.retiring) p.dispose();
    this.retiring.length = 0;
  }

  /** Scales the whole music chain, 0..1, without touching the category bus. */
  setIntensity(v) {
    const piece = this.piece;
    if (!piece) return;
    const g = clamp(v, 0, 1) * piece.track.gain;
    const now = this.ctx.currentTime;
    piece.fade.gain.cancelScheduledValues(now);
    piece.fade.gain.setValueAtTime(Math.max(0.0001, piece.fade.gain.value), now);
    piece.fade.gain.linearRampToValueAtTime(Math.max(0.0001, g), now + 1.5);
  }
}
