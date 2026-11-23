// The sheet music as plain data: the notes put into bars on two staves, each note a written length (a quarter, an
// eighth...) with ties over bar lines, rests in the gaps, and sharps or flats spelled for the key. The drawing
// (sheet.js) and the MusicXML file (musicxml.js) are both made from this, so they always agree.
//
// The notes themselves are never changed: only how they're written. Times are rounded to the nearest sixteenth of a
// beat's grid (4 steps a beat), counted from the beats found in beat.js.
import { trackBeats, evenBeats, findBars, findKey, beatPosition, timeAt, tempoOf } from './beat.js';

export const STEPS = 4; // steps in a beat (a beat is written as a quarter note, so a step is a sixteenth)

/** The written lengths, longest first, in steps: whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth. */
const LENGTHS = [16, 12, 8, 6, 4, 3, 2, 1];
export const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };

/**
 * Which part a note is in: 1 (the upper staff, or the first instrument) or 2 (the lower one). A note moved across by
 * hand keeps its part (`n.part`); the others are above or below the dividing line (`s.split`, middle C to begin with).
 */
export function partOf(n, s) {
  if (n.part === 1 || n.part === 2) return n.part;
  const split = Number(s.split) >= 21 && Number(s.split) <= 109 ? Number(s.split) : 60;
  return n.p >= split ? 1 : 2;
}

// Note names: their step in the scale (C D E F G A B = 0..6) and how much they're raised (1) or lowered (-1).
const SHARP_SPELLING = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELLING = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];  // B E A D G C F

/** How the key signature raises (1) or lowers (-1) each step of the scale. */
export function keyAlters(fifths) {
  const alters = new Array(7).fill(0);
  if (fifths > 0) for (let i = 0; i < Math.min(7, fifths); i++) alters[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < Math.min(7, -fifths); i++) alters[FLAT_ORDER[i]] = -1;
  return alters;
}

/** A pitch spelled for the key: step, alter, octave, and its place on the staff (`line`: 7 a step per octave). */
export function spell(p, fifths) {
  const [step, alter] = (fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING)[((p % 12) + 12) % 12];
  const octave = Math.floor(p / 12) - 1;
  return { step, alter, octave, line: octave * 7 + step };
}

/** A length in steps as written lengths that add up to it, longest first (tied together). */
export function pieces(len) {
  const out = [];
  while (len > 0) {
    const l = LENGTHS.find(x => x <= len);
    out.push(l);
    len -= l;
  }
  return out;
}

/**
 * The beats, bars and key used for the piece: found from the notes, or as set by hand (`s.bpm`, `s.meter`, `s.key`).
 * Returns { beats, meter, first (the beat a bar starts on), fifths, bpm, keyName, found: what was found by itself }.
 */
export function timing(notes, s, length) {
  const found = {};
  // Settings can come from a project file: only sensible values are used.
  const bpm = Number(s.bpm) >= 30 && Number(s.bpm) <= 300 ? Number(s.bpm) : null;
  const meterSet = [2, 3, 4].includes(Number(s.meter)) ? Number(s.meter) : null;
  const keySet = s.key != null && s.key !== '' && Number.isInteger(Number(s.key)) && Math.abs(Number(s.key)) <= 7 ? Number(s.key) : null;
  s = { ...s, bpm, meter: meterSet, key: keySet };
  let beats;
  if (s.bpm) beats = evenBeats(notes, 60 / s.bpm, length);
  else beats = trackBeats(notes, length);
  found.bpm = tempoOf(beats);
  const bars = findBars(notes, beats);
  found.meter = bars.meter;
  const meter = s.meter || bars.meter;
  const first = s.meter && s.meter !== bars.meter ? 0 : bars.first;
  const key = findKey(notes);
  found.fifths = key.fifths;
  found.keyName = key.name;
  const fifths = s.key == null || s.key === '' ? key.fifths : Number(s.key);
  return { beats, meter, first, fifths, bpm: s.bpm || found.bpm, found };
}

/**
 * The whole score. `notes` are the notes shown; `s` the piece's settings; `length` the piece's length in seconds.
 * Returns { meter, fifths, bpm, beats, barSteps, origin (the step the first bar starts on), bars: [{ time, end }],
 * staves: [{ part, clef, events }] }. Each event: { bar, at (steps into the bar), len, rest, tieStart, tieStop,
 * notes: [{ id, p, step, alter, octave, line, accidental }], time, end, whole (a rest filling the bar) }.
 */
export function buildScore(notes, s, length) {
  const t = timing(notes, s, length);
  const { beats, meter, first, fifths } = t;
  const barSteps = meter * STEPS;
  const pos = time => Math.round(beatPosition(beats, time) * STEPS);
  const placed = notes.map(n => {
    const start = pos(n.t);
    return { n, start, end: Math.max(start + 1, pos(n.t + n.d)) };
  });
  // The first bar starts on a bar's first beat at or before the first note (a short start is a whole bar here).
  const zero = first * STEPS;
  const minStart = placed.length ? Math.min(...placed.map(x => x.start)) : zero;
  const origin = zero - Math.ceil(Math.max(0, zero - minStart) / barSteps) * barSteps;
  const maxEnd = placed.length ? Math.max(...placed.map(x => x.end)) : origin + barSteps;
  const barCount = Math.max(1, Math.ceil((maxEnd - origin) / barSteps));
  const stepTime = step => timeAt(beats, step / STEPS);
  const bars = Array.from({ length: barCount }, (_, i) => ({ time: stepTime(origin + i * barSteps), end: stepTime(origin + (i + 1) * barSteps) }));

  const alters = keyAlters(fifths);
  const staves = [1, 2].map(part => {
    const mine = placed.filter(x => partOf(x.n, s) === part).sort((a, b) => a.start - b.start || a.n.p - b.n.p);
    // Notes starting together are one chord; a chord lasts until its longest note ends, or the next chord starts.
    const chords = [];
    for (const x of mine) {
      const last = chords[chords.length - 1];
      if (last && last.start === x.start) { last.members.push(x); last.end = Math.max(last.end, x.end); }
      else chords.push({ start: x.start, end: x.end, members: [x] });
    }
    for (let i = 0; i + 1 < chords.length; i++) chords[i].end = Math.min(chords[i].end, chords[i + 1].start);
    // A player lets go a little early: a gap of one step after a longer note is part of the note, not a rest.
    for (let i = 0; i < chords.length; i++) {
      const c = chords[i], len = c.end - c.start;
      const next = i + 1 < chords.length ? chords[i + 1].start : origin + Math.ceil((c.end - origin) / barSteps) * barSteps;
      if (len >= 2 && next - c.end <= 1 && next > c.end) c.end = next;
      // The same up to the next beat, when nothing follows straight away.
      const beatEnd = origin + Math.ceil((c.end - origin) / STEPS) * STEPS;
      if (len >= 2 && beatEnd - c.end === 1 && beatEnd <= next) c.end = beatEnd;
    }

    const events = [];
    /** Adds a note or rest to the staff at a place in a bar, with the times it starts and ends. */
    const add = (bar, at, len, extra) => {
      const abs = origin + bar * barSteps + at;
      events.push({ bar, at, len, time: stepTime(abs), end: stepTime(abs + len), ...extra });
    };
    let cursor = origin; // where the last chord ended: rests fill the gaps
    /** Fills the time from `from` to `to` with rests (a whole bar's rest for a bar with nothing in it). */
    const rests = (from, to) => {
      let at = from;
      while (at < to) {
        const bar = Math.floor((at - origin) / barSteps), barStart = origin + bar * barSteps, barEnd = barStart + barSteps;
        const upto = Math.min(to, barEnd);
        if (at === barStart && upto === barEnd) add(bar, 0, barSteps, { rest: true, whole: true, notes: [] });
        else {
          let a = at;
          for (const l of pieces(upto - at)) { add(bar, a - barStart, l, { rest: true, notes: [] }); a += l; }
        }
        at = upto;
      }
    };
    for (const c of chords) {
      if (c.start > cursor) rests(cursor, c.start);
      // Across bar lines and into written lengths, tied together.
      const parts = [];
      for (let at = c.start; at < c.end;) {
        const bar = Math.floor((at - origin) / barSteps), barStart = origin + bar * barSteps;
        const upto = Math.min(c.end, barStart + barSteps);
        for (const l of pieces(upto - at)) { parts.push({ bar, at: at - barStart, len: l }); at += l; }
      }
      parts.forEach((p, i) => add(p.bar, p.at, p.len, {
        rest: false, tieStop: i > 0, tieStart: i < parts.length - 1,
        notes: c.members.map(x => ({ id: x.n.id, p: x.n.p, ...spell(x.n.p, fifths) }))
      }));
      cursor = Math.max(cursor, c.end);
    }
    rests(cursor, origin + barCount * barSteps);
    events.sort((a, b) => a.bar - b.bar || a.at - b.at);

    // Sharps, flats and naturals: written when a note differs from the key, or from the same line earlier in the bar.
    let bar = -1, seen = new Map();
    for (const e of events) {
      if (e.bar !== bar) { bar = e.bar; seen = new Map(); }
      for (const n of e.notes) {
        const now = seen.has(n.line) ? seen.get(n.line) : alters[n.step];
        n.accidental = !e.tieStop && n.alter !== now ? (n.alter === 1 ? 'sharp' : n.alter === -1 ? 'flat' : 'natural') : null;
        seen.set(n.line, n.alter);
      }
    }
    // The treble clef unless the part's notes are mostly low.
    const pitches = mine.map(x => x.n.p).sort((a, b) => a - b);
    const middle = pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : part === 1 ? 72 : 48; // the average pitch
    const clef = s.parts ? (middle >= 57 ? 'treble' : 'bass') : part === 1 ? 'treble' : 'bass';
    return { part, clef, events };
  });
  return { meter, fifths, bpm: t.bpm, beats, barSteps, origin, bars, staves, found: t.found, keyAlters: alters };
}
