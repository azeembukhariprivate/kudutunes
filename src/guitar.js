// Guitar: where on the neck each note is played, and tabs as text.
// The same note can be played in several places, so the notes are arranged to keep the hand in one area and every
// chord within reach. Strings are numbered here from the lowest (0, the thick one) to the highest (5).

export const TUNINGS = {
  standard: { name: 'Standard (E A D G B E)', notes: [40, 45, 50, 55, 59, 64] },
  dropD: { name: 'Drop D (D A D G B E)', notes: [38, 45, 50, 55, 59, 64] },
  halfDown: { name: 'Half a step down (Eb Ab Db Gb Bb Eb)', notes: [39, 44, 49, 54, 58, 63] },
  openG: { name: 'Open G (D G D G B D)', notes: [38, 43, 50, 55, 59, 62] },
  dadgad: { name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] }
};

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = p => NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);

const REACH = 4;       // frets a hand covers without moving
const TOGETHER = 0.04; // notes starting this close together are played together (a chord)
const BEST = 24;       // ways of playing a chord that are kept for comparing

/** How the guitar is set up: { tuning: a key of TUNINGS, capo: fret, highest: the highest fret to use }. */
export const setup = (s = {}) => ({ tuning: TUNINGS[s.tuning] ? s.tuning : 'standard', capo: clamp(s.capo | 0, 0, 12), highest: clamp(s.highest ?? 15, 3, 24) });

/** Every place a pitch can be played: [{ string, fret }], the fret counted from the capo. */
export function places(p, s) {
  const { tuning, capo, highest } = setup(s), out = [];
  TUNINGS[tuning].notes.forEach((open, string) => {
    const onNeck = p - open;
    if (onNeck >= capo && onNeck <= Math.max(highest, capo)) out.push({ string, fret: onNeck - capo });
  });
  return out;
}

/** The lowest and highest pitch the guitar can play as set up. */
export function range(s) {
  const { tuning, capo, highest } = setup(s), n = TUNINGS[tuning].notes;
  return [n[0] + capo, n[5] + Math.max(highest, capo)];
}

/**
 * Chooses a string and fret for every note. Notes are [{ t, p, g? }]; `g` is a string chosen by hand, which is kept
 * when the note can be played there. Returns an array alongside `notes`: { string, fret } or null when the guitar as
 * set up can't play the note (too low, too high, or more notes at once than can be reached).
 */
export function arrange(notes, s) {
  const result = notes.map(() => null);
  const order = notes.map((n, i) => i).sort((a, b) => notes[a].t - notes[b].t || notes[a].p - notes[b].p);

  // Chords: notes that start together.
  const groups = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && notes[i].t - g.t <= TOGETHER) g.ids.push(i);
    else groups.push({ t: notes[i].t, ids: [i] });
  }

  // For each chord, the best few ways of playing it.
  for (const g of groups) g.ways = waysToPlay(g.ids.map(i => notes[i]), g.ids, s);

  // Through the piece: the way of playing each chord that moves the hand least overall.
  const playable = groups.filter(g => g.ways.length > 0);
  playable.forEach((g, k) => {
    const before = playable[k - 1];
    for (const w of g.ways) {
      w.total = w.cost;
      w.from = null;
      if (!before) continue;
      const quick = g.t - before.t < 1 ? 1 : 0.35; // time to move makes a jump easier
      let best = Infinity;
      for (const b of before.ways) {
        const here = w.hand ?? b.reach, there = b.reach ?? w.hand;
        const c = b.total + (here == null || there == null ? 0 : Math.abs(here - there) * quick);
        if (c < best) { best = c; w.from = b; }
      }
      w.total += best;
    }
    // Where the hand is after this chord: at its frets, or (all open strings) where it was before.
    for (const w of g.ways) w.reach = w.hand ?? (w.from ? w.from.reach : null);
  });
  let pick = playable.length ? playable[playable.length - 1].ways.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  for (; pick; pick = pick.from) for (const [i, place] of pick.at) result[i] = place;
  return result;
}

/** The best ways of playing notes together: [{ at: Map(note index -> place), cost, hand }]. */
function waysToPlay(group, ids, s) {
  let chord = group.map((n, k) => ({ n, id: ids[k], options: fixed(n, s) }));
  // Notes the guitar can't play at all are left out (they show as "can't be played").
  chord = chord.filter(c => c.options.length > 0);
  // More notes than strings, or out of reach: leave out the least sure note and try again.
  while (chord.length > 0) {
    const ways = [];
    assign(chord, 0, new Map(), new Set(), ways);
    if (ways.length > 0) return ways.sort((a, b) => a.cost - b.cost).slice(0, BEST);
    let weakest = 0;
    chord.forEach((c, k) => { if ((c.n.s ?? 1) < (chord[weakest].n.s ?? 1)) weakest = k; });
    chord = chord.filter((c, k) => k !== weakest);
  }
  return [];
}

function fixed(n, s) {
  const all = places(n.p, s);
  const byHand = n.g == null ? null : all.find(pl => pl.string === n.g);
  return byHand ? [byHand] : all;
}

function assign(chord, k, at, strings, ways) {
  if (k === chord.length) {
    const frets = [...at.values()].map(pl => pl.fret).filter(f => f > 0);
    const low = frets.length ? Math.min(...frets) : null, high = frets.length ? Math.max(...frets) : null;
    if (frets.length && high - low > REACH) return;
    const hand = frets.length ? low : null;
    // Lower on the neck is easier and sounds fuller; a wide stretch is harder.
    ways.push({ at: new Map(at), hand, cost: frets.length ? low * 0.35 + (high - low) * 0.5 : 0 });
    return;
  }
  for (const pl of chord[k].options) {
    if (strings.has(pl.string)) continue;
    strings.add(pl.string);
    at.set(chord[k].id, pl);
    assign(chord, k + 1, at, strings, ways);
    at.delete(chord[k].id);
    strings.delete(pl.string);
  }
}

/** The strings a note could move to by hand: the places it can be played. */
export const otherStrings = (n, s) => places(n.p, s).map(pl => pl.string);

/**
 * Tabs as plain text, the way guitar sites write them: a line per string (highest on top), a number where a fret is
 * played. `placed` comes from arrange(). Time runs left to right in equal steps, so the spacing shows the rhythm.
 */
export function tabText(notes, placed, s, title = '') {
  const { tuning, capo } = setup(s);
  const open = TUNINGS[tuning].notes;
  const items = notes.map((n, i) => ({ t: n.t, place: placed[i] })).filter(x => x.place).sort((a, b) => a.t - b.t);
  const head = [title, `Tuning: ${TUNINGS[tuning].name}${capo ? `   Capo on fret ${capo} (numbers count from the capo)` : ''}`].filter(Boolean);
  if (items.length === 0) return [...head, '', '(no notes the guitar can play)', ''].join('\n');

  // One column for each moment notes start; the gap before it is as many dashes as the wait is long.
  const moments = [];
  for (const it of items) {
    const m = moments[moments.length - 1];
    if (m && it.t - m.t <= TOGETHER) m.at.push(it.place);
    else moments.push({ t: it.t, at: [it.place] });
  }
  const gaps = moments.slice(1).map((m, i) => m.t - moments[i].t).sort((a, b) => a - b);
  const step = clamp(gaps.length ? gaps[Math.floor(gaps.length / 4)] : 0.25, 0.08, 0.6); // a short, common wait is one dash

  const WIDTH = 72, labels = open.map(p => NAMES[p % 12].padEnd(2, ' '));
  const blocks = [];
  let rows = null, used = 0;
  const start = () => { rows = open.map(() => ''); used = 0; };
  const flush = () => { if (rows && used > 0) blocks.push(rows.map((r, st) => `${labels[st]}|${r}|`).reverse().join('\n')); };
  start();
  moments.forEach((m, i) => {
    const wait = i === 0 ? 1 : clamp(Math.round((m.t - moments[i - 1].t) / step), 1, 8);
    const wide = Math.max(...m.at.map(pl => String(pl.fret).length));
    if (used + wait + wide > WIDTH) { flush(); start(); }
    for (let st = 0; st < 6; st++) {
      const pl = m.at.find(x => x.string === st);
      rows[st] += '-'.repeat(used === 0 ? 1 : wait) + (pl ? String(pl.fret).padEnd(wide, '-') : '-'.repeat(wide));
    }
    used += wait + wide;
  });
  flush();
  return [...head, '', blocks.join('\n\n'), ''].join('\n');
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
