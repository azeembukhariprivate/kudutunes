// Sheet music and two instruments (1.2): finding the beat, bars and key; the written score; MusicXML; the parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPeriod, trackBeats, tempoOf, findBars, findKey } from '../src/beat.js';
import { buildScore, partOf, pieces, spell, keyAlters } from '../src/score.js';
import { musicXml } from '../src/musicxml.js';
import { midiFile, readMidi } from '../src/midi.js';
import { Piece } from '../src/piece.js';
import { unpack, pack } from '../src/project.js';

/** A made-up tune of known tempo and bars: a low note on each bar's first beat, a melody note on every beat, and
 * sometimes one on the half beat; each note a little early or late, as a person plays. */
function tune(bpm, meter, bars, { eighths = true, drift = 0, jitter = 0.012, seed = 1 } = {}) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const notes = [], scale = [60, 62, 64, 65, 67, 69, 71, 72];
  let t = 0.3, beat = 60 / bpm, id = 1;
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k < meter; k++) {
      const j = () => (rnd() - 0.5) * 2 * jitter;
      if (k === 0) notes.push({ id: id++, t: t + j(), d: beat * meter * 0.9, p: 48, a: 0.8 });
      notes.push({ id: id++, t: t + j(), d: beat * 0.45, p: scale[Math.floor(rnd() * 8)], a: k === 0 ? 0.8 : 0.6 });
      if (eighths && rnd() < 0.5) notes.push({ id: id++, t: t + beat / 2 + j(), d: beat * 0.4, p: scale[Math.floor(rnd() * 8)], a: 0.5 });
      t += beat;
      beat *= 1 + drift;
    }
  }
  return notes;
}
const lengthOf = notes => Math.max(...notes.map(n => n.t + n.d));

test('the beat: tempos from slow to fast are found, not twice or half as fast', () => {
  for (const bpm of [70, 80, 100, 120, 140, 160]) {
    const notes = tune(bpm, 4, 12, { seed: bpm });
    const found = Math.round(60 / findPeriod(notes));
    assert.ok(Math.abs(found - bpm) <= 2, `${bpm} beats a minute, found ${found}`);
    assert.ok(Math.abs(tempoOf(trackBeats(notes, lengthOf(notes))) - bpm) <= 3, `${bpm}: the beats follow`);
  }
  const plain = tune(100, 4, 12, { eighths: false });
  assert.ok(Math.abs(Math.round(60 / findPeriod(plain)) - 100) <= 2, 'quarter notes only');
});

test('the beat follows a player who speeds up', () => {
  const notes = tune(100, 4, 12, { drift: -0.004 }), beats = trackBeats(notes, lengthOf(notes));
  const early = beats[3] - beats[2], late = beats[beats.length - 6] - beats[beats.length - 7];
  assert.ok(late < early * 0.9, `the steps between beats get shorter: ${early.toFixed(3)} then ${late.toFixed(3)}`);
  // Every melody note on a beat is near a beat found.
  const near = notes.filter(n => n.p !== 48).every(n => beats.some(b => Math.abs(b - n.t) < 0.06) || beats.some((b, i) => i && Math.abs((b + beats[i - 1]) / 2 - n.t) < 0.06));
  assert.ok(near, 'the notes sit on the beats found');
});

test('bars: four and three beats in a bar, and where a bar starts', () => {
  for (const meter of [4, 3]) for (const bpm of [90, 120]) {
    const notes = tune(bpm, meter, 12, { seed: bpm + meter }), beats = trackBeats(notes, lengthOf(notes));
    const bars = findBars(notes, beats);
    assert.equal(bars.meter, meter, `${meter} beats a bar at ${bpm}`);
    const firstLow = notes.find(n => n.p === 48).t;
    assert.ok(Math.abs(beats[bars.first] - firstLow) < 0.06, 'a bar starts with the low note');
  }
});

test('the key: major and minor, with the right sharps or flats', () => {
  const scale = (steps, tonic) => steps.map((x, i) => ({ t: i, d: 1, p: tonic + x, a: 0.7 }));
  const major = [0, 2, 4, 5, 7, 9, 11, 12, 7, 4, 0], minor = [0, 2, 3, 5, 7, 8, 10, 12, 7, 3, 0];
  assert.equal(findKey(scale(major, 60)).fifths, 0);
  assert.equal(findKey(scale(major, 67)).fifths, 1, 'G major: one sharp');
  assert.equal(findKey(scale(major, 62)).fifths, 2, 'D major: two sharps');
  assert.equal(findKey(scale(major, 65)).fifths, -1, 'F major: one flat');
  assert.equal(findKey(scale(major, 63)).fifths, -3, 'E flat major: three flats');
  const a = findKey(scale(minor, 57));
  assert.equal(a.fifths, 0);
  assert.equal(a.name, 'A minor');
  assert.equal(findKey(scale(minor, 64)).fifths, 1, 'E minor: one sharp');
});

test('spelling: sharps in sharp keys, flats in flat keys; the key signature', () => {
  assert.deepEqual(spell(61, 2), { step: 0, alter: 1, octave: 4, line: 28 }, 'C sharp in D major');
  assert.deepEqual(spell(61, -3), { step: 1, alter: -1, octave: 4, line: 29 }, 'D flat in E flat major');
  assert.deepEqual(keyAlters(2), [1, 0, 0, 1, 0, 0, 0], 'D major: F and C sharp');
  assert.deepEqual(keyAlters(-2), [0, 0, -1, 0, 0, 0, -1], 'B flat major: B and E flat');
  assert.deepEqual(pieces(7), [6, 1], 'seven sixteenths: a dotted quarter tied to a sixteenth');
  assert.deepEqual(pieces(16), [16]);
});

/** Bars of the tune as text: "bar:at+len" for notes (with their pitches) and "r" for rests. */
function written(staff) {
  return staff.events.map(e => `${e.bar}:${e.at}+${e.len}${e.rest ? 'r' : ''}${e.tieStart ? '~' : ''}${e.notes.map(n => n.p + (n.accidental ? n.accidental[0] : '')).join(',')}`).join(' ');
}

test('the score: notes in bars, chords, rests, ties over a bar line, sharps and naturals', () => {
  const b = 0.5, notes = [];
  let id = 1;
  [60, 62, 64, 65, 67, 69, 71, 72].forEach((p, i) => notes.push({ id: id++, t: 1 + i * b, d: b * 0.9, p, a: 0.7 }));
  notes.push({ id: id++, t: 1 + 2 * b, d: b * 0.9, p: 66, a: 0.7 }); // F sharp with the E: a chord
  notes.push({ id: id++, t: 1 + 8 * b + b * 2, d: b * 4, p: 74, a: 0.7 }); // starts on beat 3, held over the bar line
  for (let k = 0; k < 4; k++) notes.push({ id: id++, t: 1 + k * 4 * b, d: 4 * b * 0.95, p: 48, a: 0.8 });
  const score = buildScore(notes, { split: 60 }, 10);
  assert.equal(score.meter, 4);
  assert.equal(score.bpm, 120);
  const [upper, lower] = score.staves;
  assert.equal(upper.clef, 'treble');
  assert.equal(lower.clef, 'bass');
  assert.equal(written(upper), '0:0+460 0:4+462 0:8+464,66s 0:12+465n 1:0+467 1:4+469 1:8+471 1:12+472 2:0+8r 2:8+8~74 3:0+874 3:8+8r',
    'the scale, the chord, F natural after F sharp, a half rest, the tie over the bar line');
  assert.equal(written(lower), '0:0+1648 1:0+1648 2:0+1648 3:0+1648', 'a whole note each bar (let go a little early is still whole)');
  for (const st of score.staves) for (let bar = 0; bar < score.bars.length; bar++) {
    const total = st.events.filter(e => e.bar === bar).reduce((sum, e) => sum + e.len, 0);
    assert.equal(total, score.barSteps, `staff ${st.part}, bar ${bar + 1} adds up to a whole bar`);
  }
});

test('the score as set by hand: tempo, beats in a bar and key; nonsense from a file is ignored', () => {
  const notes = tune(100, 4, 6);
  const set = buildScore(notes, { split: 60, bpm: 100, meter: 3, key: -2 }, lengthOf(notes));
  assert.equal(set.bpm, 100);
  assert.equal(set.meter, 3);
  assert.equal(set.fifths, -2);
  const odd = buildScore(notes, { split: 'x', bpm: 9999, meter: 7, key: 'hello' }, lengthOf(notes));
  assert.equal(odd.meter, 4, 'found again');
  assert.ok(odd.bpm > 90 && odd.bpm < 110);
});

test('two parts: by the dividing line, and single notes moved across', () => {
  const s = { split: 60 };
  assert.equal(partOf({ p: 60 }, s), 1);
  assert.equal(partOf({ p: 59 }, s), 2);
  assert.equal(partOf({ p: 70, part: 2 }, s), 2, 'moved across by hand');
  const piece = new Piece({ notes: [{ t: 0, d: 1, p: 72, a: 0.8, s: 1 }, { t: 1, d: 1, p: 48, a: 0.8, s: 1 }, { t: 2, d: 1, p: 64, a: 0.8, s: 1 }] });
  piece.settings.parts = true;
  const high = piece.notes.find(n => n.p === 64);
  assert.deepEqual(piece.inPart(1).map(n => n.p), [72, 64]);
  piece.toOtherPart([high.id]);
  assert.deepEqual(piece.inPart(1).map(n => n.p), [72]);
  assert.deepEqual(piece.inPart(2).map(n => n.p), [48, 64]);
  piece.undo();
  assert.deepEqual(piece.inPart(2).map(n => n.p), [48], 'undone');
  piece.redo();
  // Kept in the project file.
  const back = unpack(pack(piece.plain()));
  assert.equal(back.notes.find(n => n.p === 64).part, 2);
  assert.equal(back.settings.parts, true);
  // In the score: each part on its own staff, with a clef that suits it.
  const score = buildScore(piece.shown, piece.settings, 4);
  assert.deepEqual(score.staves[0].events.filter(e => !e.rest).map(e => e.notes[0].p), [72]);
  assert.equal(score.staves[1].clef, 'bass');
});

test('MIDI: two instruments are two tracks', () => {
  const notes = [{ t: 0, d: 1, p: 72 }, { t: 0, d: 1, p: 48 }, { t: 1, d: 0.5, p: 50 }];
  const back = readMidi(midiFile(notes, 'Two', n => partOf(n, { split: 60 })));
  assert.deepEqual(back.map(n => [n.p, n.track]), [[48, 1], [72, 0], [50, 1]]);
  assert.ok(readMidi(midiFile(notes, 'One')).every(n => n.track === 0), 'one track for one piano');
});

test('MusicXML: a whole, well-formed score that adds up', () => {
  const notes = tune(110, 4, 4);
  const score = buildScore(notes.map((n, i) => ({ ...n, id: i + 1 })), { split: 60 }, lengthOf(notes));
  const xml = musicXml(score, 'Tea & <snacks>');
  assert.ok(xml.startsWith('<?xml') && xml.includes('<score-partwise version="4.0">') && xml.trim().endsWith('</score-partwise>'));
  assert.ok(xml.includes('<work-title>Tea &amp; &lt;snacks&gt;</work-title>'), 'the title escaped');
  assert.ok(xml.includes('<staves>2</staves>') && xml.includes('<sign>G</sign>') && xml.includes('<sign>F</sign>'), 'piano: two staves, treble and bass');
  // Every element that opens is closed (a simple check of well-formedness, without a library).
  const stack = [];
  for (const m of xml.replace(/<\?[^>]*\?>|<!DOCTYPE[^>]*>/g, '').matchAll(/<(\/?)([a-z-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2]); else stack.push(m[2]);
  }
  assert.equal(stack.length, 0);
  // Each measure's notes on each staff add up to the bar (chords count once).
  for (const measure of xml.split('<measure ').slice(1)) {
    const [one, two] = measure.split('<backup>');
    for (const half of [one, two]) {
      const total = [...half.matchAll(/<note>(<chord\/>)?.*?<duration>(\d+)<\/duration>/g)].filter(m => !m[1]).reduce((s, m) => s + Number(m[2]), 0);
      assert.equal(total, score.barSteps);
    }
  }
  const twoParts = musicXml(score, 'x', true);
  assert.ok(twoParts.includes('<score-part id="P2">') && !twoParts.includes('<backup>'), 'two instruments: two parts');
});
