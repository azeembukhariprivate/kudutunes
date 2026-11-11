// Tidying what the engine heard. A plucked or struck string also sounds higher notes above the one played (its
// overtones), and a long note can be heard as starting twice. Both come out of the engine as extra, quieter notes.
// Here each note gets a "sureness" (s, 0..1): how clearly the engine heard it begin, lowered when it looks like an
// overtone or an echo of a stronger note. The app's "faint notes" slider hides notes below a chosen sureness, so nothing is thrown away for good.

// How far above a played note its overtones sit, in semitones (octave, octave + fifth, two octaves, ...).
const OVERTONES = [12, 19, 24, 28, 31, 34, 36];

/**
 * Takes notes [{ t, d, p, a: how loud, o: how clearly it began }] and returns them with a sureness `s`, in order of start. Notes that are plainly the
 * same note heard twice are joined into one.
 */
export function tidy(notes) {
  const sorted = notes.map(n => ({ ...n })).sort((x, y) => x.t - y.t || x.p - y.p);

  // The same pitch starting again while it is still sounding, and clearly quieter: the same note, heard twice.
  const kept = [];
  const last = new Map(); // pitch -> the note of that pitch that started last
  for (const n of sorted) {
    const before = last.get(n.p);
    // (A note that clearly begins again was struck again, and stays.)
    if (before && n.t < before.t + before.d + 0.03 && n.a < before.a * 0.8 && (n.o ?? 0) < 0.6) {
      before.d = round(Math.max(before.d, n.t + n.d - before.t));
      continue;
    }
    kept.push(n);
    last.set(n.p, n);
  }

  for (const n of kept) {
    let s = n.o ?? n.a;
    // An overtone of a stronger note sounding at the same time.
    // Much quieter than that note: almost surely its overtone. A little quieter: it may well have been played too
    // (an octave in a chord), so it only loses a little.
    const parent = kept.find(r => r !== n && r.a > n.a * 1.2 && r.t - 0.06 <= n.t && n.t <= r.t + r.d && OVERTONES.includes(n.p - r.p));
    if (parent) s *= parent.a > n.a * 1.7 ? 0.5 : 0.85;
    // An octave below a stronger note, and short: the engine's ear slipping down an octave.
    else if (n.d < 0.3 && kept.some(r => r !== n && r.a > n.a * 1.2 && r.p - n.p === 12 && r.t - 0.06 <= n.t && n.t <= r.t + r.d)) s *= 0.6;
    // A very short, quiet blip.
    if (n.d < 0.09 && n.a < 0.4) s *= 0.7;
    // Higher than a guitar or most piano music goes, and quiet.
    if (n.p > 96 && n.a < 0.45) s *= 0.6;
    n.s = round(Math.min(1, s));
  }
  return kept;
}

/** The notes at least as sure as the slider says. Notes put in by hand (s = 1) always show. */
export const shown = (notes, least) => notes.filter(n => (n.s ?? 1) >= least);

/** Where the "faint notes" slider starts. */
export const USUAL = 0.7;

const round = v => Math.round(v * 1000) / 1000;
