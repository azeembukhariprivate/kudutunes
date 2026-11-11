// The app's own piano and guitar sounds, made in code: each note is worked out once as a short sound and kept.

const hz = p => 440 * 2 ** ((p - 69) / 12);
const made = new Map();

/** A struck string (piano-like): a few overtones, the higher ones dying away sooner. */
function piano(ctx, p) {
  const rate = ctx.sampleRate, seconds = p < 48 ? 4 : p < 72 ? 3 : 2, n = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(1, n, rate), out = buf.getChannelData(0), f = hz(p);
  const parts = [1, 0.5, 0.28, 0.16, 0.09, 0.05, 0.03];
  for (let h = 0; h < parts.length; h++) {
    const fh = f * (h + 1) * (1 + 0.0004 * (h + 1) * (h + 1));
    if (fh > rate / 2 - 500) break;
    const decay = (seconds * 0.32) / (1 + h * 0.6), w = (2 * Math.PI * fh) / rate;
    for (let i = 0; i < n; i++) out[i] += parts[h] * Math.sin(w * i) * Math.exp(-i / rate / decay);
  }
  const rise = Math.floor(0.004 * rate);
  for (let i = 0; i < rise; i++) out[i] *= i / rise;
  level(out);
  return buf;
}

/** A plucked string (guitar-like): a burst of noise going round a short delay that dulls it. */
function guitar(ctx, p) {
  const rate = ctx.sampleRate, seconds = p < 52 ? 4 : 3, n = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(1, n, rate), out = buf.getChannelData(0);
  const size = Math.max(2, Math.round(rate / hz(p))), line = new Float32Array(size);
  let seed = 12345 + p * 7919;
  for (let i = 0; i < size; i++) { seed = (seed * 16807) % 2147483647; line[i] = (seed / 2147483647) * 2 - 1; }
  // Soften the pluck a little, as a finger would.
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < size; i++) line[i] = (line[i] + line[i - 1]) * 0.5;
  const keep = p < 52 ? 0.9975 : p < 64 ? 0.996 : 0.994;
  let k = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const v = line[k];
    out[i] = v;
    line[k] = (v + prev) * 0.5 * keep;
    prev = v;
    k = (k + 1) % size;
  }
  level(out);
  return buf;
}

function level(out) {
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  const fade = Math.min(out.length, 2000);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
}

const MAKERS = { piano, guitar };

export class Synth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.playing = new Set();
  }

  /** Plays a note: `voice` is 'piano' or 'guitar', `when` is the audio clock's time, `seconds` how long it's held. */
  play(voice, p, when, seconds, loud = 0.7) {
    const key = voice + p;
    if (!made.has(key)) made.set(key, (MAKERS[voice] || piano)(this.ctx, p));
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = made.get(key);
    const start = Math.max(when, this.ctx.currentTime), end = start + Math.max(0.08, seconds);
    gain.gain.setValueAtTime(0.25 + loud * 0.6, start);
    gain.gain.setTargetAtTime(0, end, 0.06); // let go of the note: it fades quickly, as a damped string does
    src.connect(gain).connect(this.out);
    src.start(start);
    src.stop(end + 0.5);
    const voiceNow = { src, gain };
    this.playing.add(voiceNow);
    src.onended = () => this.playing.delete(voiceNow);
  }

  /** Stops everything at once (pause, or a jump to another place). */
  hush() {
    const now = this.ctx.currentTime;
    for (const v of this.playing) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.015);
        v.src.stop(now + 0.1);
      } catch { /* already stopped */ }
    }
    this.playing.clear();
  }
}
