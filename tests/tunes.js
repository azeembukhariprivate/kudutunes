// Made-up test tunes and sounds for the tests: a plucked-string sound and a struck-string sound made in code, so the
// tests know exactly which notes were played.
export const RATE = 22050;
const hz = p => 440 * 2 ** ((p - 69) / 12);

/** A plucked string (guitar-like): a burst of noise going round a short delay that dulls it (Karplus-Strong). */
export function pluck(p, seconds, rate = RATE, seed = 1) {
  const n = Math.floor(seconds * rate), out = new Float32Array(n);
  const period = rate / hz(p), size = Math.max(2, Math.floor(period)), line = new Float32Array(size);
  let s = seed * 9301 + p * 49297;
  for (let i = 0; i < size; i++) { s = (s * 16807) % 2147483647; line[i] = (s / 2147483647) * 2 - 1; }
  let k = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const v = line[k];
    out[i] = v;
    line[k] = (v + prev) * 0.5 * 0.996;
    prev = v;
    k = (k + 1) % size;
  }
  const fade = Math.min(n, Math.floor(0.03 * rate));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** A struck string (piano-like): a few overtones, the higher ones dying away sooner. */
export function strike(p, seconds, rate = RATE) {
  const n = Math.floor(seconds * rate), out = new Float32Array(n), f = hz(p);
  const parts = [1, 0.55, 0.3, 0.18, 0.1, 0.06];
  for (let h = 0; h < parts.length; h++) {
    const fh = f * (h + 1) * (1 + 0.0004 * (h + 1) * (h + 1)); // strings are a touch sharp higher up
    if (fh > rate / 2 - 200) break;
    const decay = 2.2 / (1 + h * 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      out[i] += parts[h] * Math.sin(2 * Math.PI * fh * t) * Math.exp(-t / decay * 3) * Math.min(1, t / 0.004);
    }
  }
  const fade = Math.min(n, Math.floor(0.04 * rate));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** Mixes notes [{t, d, p}] into one sound with the given instrument. */
export function render(notes, sound, rate = RATE) {
  const end = Math.max(...notes.map(n => n.t + n.d)) + 0.5;
  const out = new Float32Array(Math.ceil(end * rate));
  notes.forEach((n, i) => {
    const s = sound(n.p, n.d, rate, i + 1), at = Math.floor(n.t * rate);
    for (let k = 0; k < s.length && at + k < out.length; k++) out[at + k] += s[k] * 0.35;
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return out;
}

const seq = (pitches, step, len, start = 0.3) => pitches.map((p, i) => ({ t: start + i * step, d: len, p }));

/** A tune one note at a time: "Twinkle, twinkle" in C. */
export const MELODY = seq([60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60], 0.5, 0.42);

/** Chords with a bass note and a tune on top (piano-like playing). */
export const CHORDS = [
  ...[[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67], [48, 60, 64, 67]].flatMap((c, i) => c.map(p => ({ t: 0.3 + i * 1.6, d: 1.4, p }))),
  ...seq([72, 74, 76, 77, 79, 77, 76, 74], 0.8, 0.6, 0.3 + 0.4)
];

/** Guitar-style picking across the strings (an E minor and a C shape). */
export const PICKING = [
  ...seq([40, 47, 52, 55, 59, 64, 59, 55], 0.3, 0.9),
  ...seq([48, 52, 55, 60, 64, 60, 55, 52], 0.3, 0.9, 0.3 + 8 * 0.3)
];

/**
 * How well found notes match the real ones: a found note counts when its pitch is right and it starts within
 * `within` seconds of a real note not matched yet. Returns { found: share of real notes found, right: share of found
 * notes that were real }.
 */
export function compare(real, got, within = 0.08) {
  const used = new Set();
  let hit = 0;
  for (const g of got) {
    const i = real.findIndex((r, k) => !used.has(k) && r.p === g.p && Math.abs(r.t - g.t) <= within);
    if (i >= 0) { used.add(i); hit++; }
  }
  return { found: real.length ? hit / real.length : 1, right: got.length ? hit / got.length : 1 };
}
