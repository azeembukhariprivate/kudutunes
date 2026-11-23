// Finding the beat, the bars and the key of a piece, for the sheet music. Plain sums, no browser needed.
//
// The beat: how strongly notes start at each moment (louder and lower notes count more) is turned into a line of
// "onset strength", one value every 10 ms. The usual time between beats is the spacing that best fits those starts,
// with a gentle preference for walking pace (about 110 beats a minute), because a tune fits twice as fast just as
// well. Then each beat is placed where notes start, while keeping the steps between beats nearly even, so a player who
// speeds up or slows down is followed (the way Dan Ellis's beat tracker works, by dynamic programming).

const STEP = 0.01; // seconds between onset-strength values

/** The onset strength: at each note's start its loudness (low notes a little more), spread over a few steps. */
function strength(notes, length) {
  const n = Math.max(1, Math.ceil(length / STEP) + 8), out = new Float64Array(n);
  for (const note of notes) {
    const i = Math.round(note.t / STEP);
    if (i < 0 || i >= n) continue;
    const w = (note.a ?? 0.7) * (note.p < 55 ? 1.3 : 1);
    for (let k = -2; k <= 2; k++) if (i + k >= 0 && i + k < n) out[i + k] += w * Math.exp(-(k * k) / 2);
  }
  return out;
}

/** How well notes starting at `times` (weighted) fit a beat every `period` seconds: 0 (not at all) to 1 (exactly). */
function fit(times, weights, period) {
  let re = 0, im = 0, total = 0;
  for (let i = 0; i < times.length; i++) {
    const a = (2 * Math.PI * times[i]) / period;
    re += weights[i] * Math.cos(a);
    im += weights[i] * Math.sin(a);
    total += weights[i];
  }
  return { score: total ? Math.hypot(re, im) / total : 0, phase: Math.atan2(im, re) };
}

/** The starts of the notes, those within 30 ms of each other counted as one (a chord), with their weights. */
function starts(notes) {
  const sorted = [...notes].sort((a, b) => a.t - b.t), times = [], weights = [];
  for (const n of sorted) {
    const w = (n.a ?? 0.7) * (n.p < 55 ? 1.3 : 1);
    if (times.length && n.t - times[times.length - 1] < 0.03) weights[weights.length - 1] += w;
    else { times.push(n.t); weights.push(w); }
  }
  return { times, weights };
}

/**
 * The usual seconds between beats. A beat fits when notes start on it, on half of it or a quarter of it (eighth and
 * sixteenth notes), and the one nearest to walking pace wins among those that fit about equally well.
 */
export function findPeriod(notes) {
  const { times, weights } = starts(notes);
  if (times.length < 4) return 0.5;
  let best = 0.5, bestScore = -1;
  for (let bpm = 40; bpm <= 220; bpm += 0.25) {
    const p = 60 / bpm;
    const score = fit(times, weights, p).score + 0.5 * fit(times, weights, p / 2).score + 0.25 * fit(times, weights, p / 4).score;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.55) ** 2); // walking pace is the likeliest
    const s = score * (0.55 + 0.45 * prior);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  // Twice too fast? Then every other "beat" often has no note starting on it at all (those are the half beats, which
  // a tune only sometimes fills), while the ones between nearly always have one. The grid is lined up on the notes
  // with this beat; which of the two kinds of beat is the "real" one doesn't matter here, so both ways are compared.
  if (60 / (best * 2) >= 40) {
    const { phase } = fit(times, weights, best);
    const zero = (phase / (2 * Math.PI)) * best;
    const filled = new Set();
    for (const t of times) {
      const pos = (t - zero) / best;
      if (Math.abs(pos - Math.round(pos)) <= 0.15) filled.add(Math.round(pos));
    }
    const first = Math.round((times[0] - zero) / best), last = Math.round((times[times.length - 1] - zero) / best);
    const count = [0, 0], all = [0, 0];
    for (let k = first; k <= last; k++) {
      const kind = ((k % 2) + 2) % 2;
      all[kind]++;
      if (filled.has(k)) count[kind]++;
    }
    const rate = [count[0] / Math.max(1, all[0]), count[1] / Math.max(1, all[1])];
    if (all[0] > 2 && all[1] > 2 && Math.max(...rate) > 0.8 && Math.min(...rate) < 0.6 * Math.max(...rate)) best *= 2;
  }
  return best;
}

/** Beats every `period` seconds from where the notes fit them best, from before the first note to after the last. */
export function evenBeats(notes, period, length) {
  const { times, weights } = starts(notes);
  // Lined up on the steadiest of the beat, its half or its quarter (notes on every half beat fit the beat itself in
  // two ways at once), then the one of those places that puts the most notes on the beat.
  const steady = [period, period / 2, period / 4].map(q => ({ q, ...fit(times, weights, q) })).sort((a, b) => b.score - a.score)[0];
  const base = (steady.phase / (2 * Math.PI)) * steady.q;
  let bestOffset = base, bestOn = -Infinity;
  for (let k = 0; k < Math.round(period / steady.q); k++) {
    const offset = base + k * steady.q;
    let on = 0;
    for (let i = 0; i < times.length; i++) on += weights[i] * Math.cos((2 * Math.PI * (times[i] - offset)) / period);
    if (on > bestOn) { bestOn = on; bestOffset = offset; }
  }
  let first = bestOffset % period;
  if (first < 0) first += period;
  const start = times.length ? times[0] : 0;
  while (first > start + period * 0.25) first -= period;
  while (first + period < start - period * 0.25) first += period;
  const beats = [];
  for (let b = first; b <= length + period; b += period) beats.push(Math.round(b * 1000) / 1000);
  return beats;
}

/**
 * The beats themselves: placed where notes start, with the steps between them kept close to `period` (they may
 * change slowly, as a player speeds up or slows down). Returns the time of every beat, in order.
 */
export function trackBeats(notes, length, period = findPeriod(notes)) {
  if (notes.length < 4) return evenBeats(notes, period, length);
  const o = strength(notes, length), n = o.length, p = Math.round(period / STEP);
  // Each step's best score as a beat, and the beat before it on that best path.
  const score = new Float64Array(n), from = new Int32Array(n).fill(-1);
  const tight = 6; // how much an uneven step costs
  for (let i = 0; i < n; i++) {
    let best = 0, at = -1;
    for (let j = i - 2 * p; j <= i - Math.round(p / 2); j++) {
      if (j < 0) continue;
      const v = score[j] - tight * Math.log((i - j) / p) ** 2;
      if (v > best || at < 0) { best = v; at = j; }
    }
    score[i] = o[i] + (at >= 0 ? Math.max(0, best) : 0);
    from[i] = at >= 0 && best > 0 ? at : -1;
  }
  // The best last beat near the end, then back along the path.
  const lastNote = Math.max(...notes.map(x => x.t));
  let end = -1, top = -Infinity;
  for (let i = Math.max(0, Math.round(lastNote / STEP) - p); i < Math.min(n, Math.round(lastNote / STEP) + p); i++) if (score[i] > top) { top = score[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = from[i]) beats.unshift(i * STEP);
  if (beats.length < 2) return evenBeats(notes, period, length);
  // Before the first and after the last tracked beat: even steps, so the whole piece has beats.
  const firstStep = beats[1] - beats[0], lastStep = beats[beats.length - 1] - beats[beats.length - 2];
  const firstNote = Math.min(...notes.map(x => x.t));
  while (beats[0] - firstNote > firstStep * 0.25) beats.unshift(beats[0] - firstStep);
  while (beats[beats.length - 1] < length + lastStep) beats.push(beats[beats.length - 1] + lastStep);
  return beats.map(b => Math.round(b * 1000) / 1000);
}

/** Beats per minute, from the beats found (the middle of the steps between them). */
export function tempoOf(beats) {
  if (beats.length < 2) return 120;
  const steps = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  return Math.round(60 / steps[Math.floor(steps.length / 2)]);
}

/**
 * Beats in a bar (2, 3 or 4) and which beat is the first of a bar: the first beat of a bar is usually the strongest
 * (more and lower notes start on it). Four unless three fits clearly better.
 */
export function findBars(notes, beats) {
  if (beats.length < 6) return { meter: 4, first: 0 };
  const near = new Float64Array(beats.length);
  for (const n of notes) {
    const i = nearestBeat(beats, n.t);
    if (i >= 0 && Math.abs(beats[i] - n.t) < 0.25 * stepAt(beats, i)) near[i] += (n.a ?? 0.7) * (n.p < 55 ? 1.6 : 1) * Math.min(1.5, n.d / stepAt(beats, i) + 0.3);
  }
  let best = { meter: 4, first: 0, score: -1 };
  for (const meter of [4, 3]) {
    for (let first = 0; first < meter; first++) {
      let down = 0, other = 0, nd = 0, no = 0;
      for (let i = 0; i < beats.length; i++) {
        if ((i - first) % meter === 0) { down += near[i]; nd++; } else { other += near[i]; no++; }
      }
      const ratio = (down / Math.max(1, nd)) / Math.max(1e-6, other / Math.max(1, no));
      // Three must win clearly; and a piece usually starts on a bar's first beat, which decides when nothing else does.
      const firstNoteBeat = nearestBeat(beats, Math.min(...notes.map(n => n.t)));
      const startsBar = ((firstNoteBeat - first) % meter + meter) % meter === 0;
      const score = ratio * (meter === 3 ? 0.87 : 1) * (startsBar ? 1.04 : 1);
      if (score > best.score) best = { meter, first, score };
    }
  }
  return { meter: best.meter, first: best.first };
}

function stepAt(beats, i) {
  return i + 1 < beats.length ? beats[i + 1] - beats[i] : beats[i] - beats[i - 1];
}

/** The index of the beat nearest to `t` (beats in order). */
export function nearestBeat(beats, t) {
  let lo = 0, hi = beats.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && Math.abs(beats[lo - 1] - t) <= Math.abs(beats[lo] - t) ? lo - 1 : lo;
}

/** Where `t` falls, counted in beats (2.5: half way from the third beat to the fourth), from the beats found. */
export function beatPosition(beats, t) {
  if (beats.length < 2) return t / 0.5;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  const last = beats.length - 1;
  if (t >= beats[last]) return last + (t - beats[last]) / (beats[last] - beats[last - 1]);
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

/** The time of a position counted in beats (the other way round from beatPosition). */
export function timeAt(beats, pos) {
  if (beats.length < 2) return pos * 0.5;
  const last = beats.length - 1;
  if (pos <= 0) return beats[0] + pos * (beats[1] - beats[0]);
  if (pos >= last) return beats[last] + (pos - last) * (beats[last] - beats[last - 1]);
  const i = Math.floor(pos);
  return beats[i] + (pos - i) * (beats[i + 1] - beats[i]);
}

// ------------------------------------------------------------------ the key

// How well each note of the scale fits a major and a minor key (Krumhansl and Kessler's listening tests).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Sharps (above 0) or flats (below 0) in the key signature of each major key's tonic (C = 0, ... B = 11). */
const FIFTHS_OF_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/**
 * The key: the major or minor key whose notes fit the time spent on each note of the scale best. Returns the number
 * of sharps (positive) or flats (negative) to write, and the key's name.
 */
export function findKey(notes) {
  const time = new Array(12).fill(0);
  for (const n of notes) time[((n.p % 12) + 12) % 12] += Math.min(n.d, 2) * (n.a ?? 0.7);
  if (time.every(v => v === 0)) return { fifths: 0, name: 'C major' };
  let best = { r: -2, tonic: 0, minor: false };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [profile, minor] of [[MAJOR, false], [MINOR, true]]) {
      const r = correlation(time, profile.map((_, i) => profile[(i - tonic + 12) % 12]));
      if (r > best.r) best = { r, tonic, minor };
    }
  }
  const relativeMajor = best.minor ? (best.tonic + 3) % 12 : best.tonic;
  return { fifths: FIFTHS_OF_MAJOR[relativeMajor], name: keyName(best.tonic, best.minor, FIFTHS_OF_MAJOR[relativeMajor]) };
}

export function keyName(tonic, minor, fifths) {
  const names = fifths < 0 ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[tonic]} ${minor ? 'minor' : 'major'}`;
}

/** Every key signature that can be chosen by hand: from 7 flats to 7 sharps, named by their major key. */
export const KEYS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map(fifths => {
  const tonic = FIFTHS_OF_MAJOR.indexOf(fifths) >= 0 ? FIFTHS_OF_MAJOR.indexOf(fifths) : ((fifths * 7) % 12 + 12) % 12;
  const flatNames = { '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F' };
  const sharpNames = { 6: 'F♯', 7: 'C♯' };
  const name = flatNames[fifths] || sharpNames[fifths] || keyName(tonic, false, fifths).split(' ')[0];
  return { fifths, name: `${name} major` };
});

function correlation(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
