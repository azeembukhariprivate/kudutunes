// The parts that don't need a browser: tidying, the guitar, MIDI, project files, editing and undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tidy, shown, USUAL } from '../src/tidy.js';
import { TUNINGS, places, arrange, tabText, range, noteName } from '../src/guitar.js';
import { midiFile, readMidi } from '../src/midi.js';
import { pack, unpack } from '../src/project.js';
import { Piece } from '../src/piece.js';
import { MELODY, CHORDS, PICKING } from './tunes.js';

test('tidying: an overtone of a louder note is doubted, a played note is not', () => {
  const notes = tidy([
    { t: 1, d: 1, p: 48, a: 0.8, o: 0.95 },
    { t: 1.01, d: 0.4, p: 60, a: 0.25, o: 0.8 },   // an octave above, much quieter: an overtone
    { t: 1, d: 1, p: 52, a: 0.7, o: 0.9 },
    { t: 3, d: 0.5, p: 60, a: 0.7, o: 0.9 }        // the same pitch later, on its own: played
  ]);
  const overtone = notes.find(n => n.p === 60 && n.t < 2), played = notes.find(n => n.p === 60 && n.t > 2);
  assert.ok(overtone.s < USUAL, 'the overtone falls below the usual slider setting');
  assert.ok(played.s >= USUAL && notes.find(n => n.p === 48).s >= USUAL && notes.find(n => n.p === 52).s >= USUAL);
  assert.equal(shown(notes, USUAL).length, 3);
});

test('tidying: a note heard twice while it sounds is one note; a note struck again stays two', () => {
  const twice = tidy([{ t: 1, d: 0.5, p: 64, a: 0.8, o: 0.9 }, { t: 1.4, d: 0.6, p: 64, a: 0.4, o: 0.35 }]);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].d, 1, 'the one note lasts as long as both');
  const again = tidy([{ t: 1, d: 0.5, p: 64, a: 0.8, o: 0.9 }, { t: 1.4, d: 0.6, p: 64, a: 0.5, o: 0.9 }]);
  assert.equal(again.length, 2);
});

test('guitar: every pitch in range has a place, and none outside it', () => {
  for (const key of Object.keys(TUNINGS)) for (const capo of [0, 2, 5]) {
    const s = { tuning: key, capo, highest: 15 }, [low, high] = range(s);
    for (let p = 21; p <= 108; p++) {
      const pl = places(p, s);
      assert.equal(pl.length > 0, p >= low && p <= high, `${key} capo ${capo}: ${noteName(p)}`);
      for (const x of pl) assert.equal(TUNINGS[key].notes[x.string] + capo + x.fret, p, 'the place sounds the pitch');
    }
  }
});

test('guitar: chords use one string per note and stay within reach; the hand moves little', () => {
  const s = { tuning: 'standard', capo: 0, highest: 15 };
  for (const tune of [MELODY, CHORDS, PICKING]) {
    const placed = arrange(tune, s);
    tune.forEach((n, i) => {
      assert.ok(placed[i], `${noteName(n.p)} at ${n.t} has a place`);
      assert.equal(TUNINGS.standard.notes[placed[i].string] + placed[i].fret, n.p);
    });
    // Notes that start together.
    const starts = new Map();
    tune.forEach((n, i) => starts.set(n.t, [...(starts.get(n.t) || []), placed[i]]));
    for (const chord of starts.values()) {
      assert.equal(new Set(chord.map(c => c.string)).size, chord.length, 'no string used twice in a chord');
      const pressed = chord.map(c => c.fret).filter(f => f > 0);
      if (pressed.length) assert.ok(Math.max(...pressed) - Math.min(...pressed) <= 4, 'within a hand');
    }
    // (CHORDS is piano writing with a tune that really is high up; the other two sit where a guitarist would play them.)
    if (tune !== CHORDS) assert.ok(Math.max(...placed.map(pl => pl.fret)) <= 5, 'played low on the neck, not up at the dusty end');
  }
});

test('guitar: an open E minor chord comes out as the shape everyone plays', () => {
  const chord = [40, 47, 52, 55, 59, 64].map(p => ({ t: 1, p }));
  assert.deepEqual(arrange(chord, {}).map(pl => pl.fret), [0, 2, 2, 0, 0, 0]);
});

test('guitar: a string chosen by hand is kept; notes out of range have no place', () => {
  const s = { tuning: 'standard', capo: 0, highest: 12 };
  const notes = [{ t: 1, p: 64, g: 3 }, { t: 2, p: 30 }, { t: 3, p: 100 }, { t: 4, p: 64 }];
  const placed = arrange(notes, s);
  assert.deepEqual(placed[0], { string: 3, fret: 9 });
  assert.equal(placed[1], null);
  assert.equal(placed[2], null);
  assert.ok(placed[3]);
});

test('guitar: seven notes at once leave one out instead of failing', () => {
  const notes = [40, 45, 50, 55, 59, 64, 67].map((p, i) => ({ t: 1, p, s: i === 6 ? 0.2 : 1 }));
  const placed = arrange(notes, {});
  assert.equal(placed.filter(Boolean).length, 6);
  assert.equal(placed[6], null, 'the least sure note is the one left out');
});

test('guitar: a capo moves the numbers, and Drop D reaches the low D', () => {
  assert.deepEqual(places(42, { capo: 2 }), [{ string: 0, fret: 0 }]);
  assert.equal(places(38, { tuning: 'standard' }).length, 0);
  assert.deepEqual(places(38, { tuning: 'dropD' }), [{ string: 0, fret: 0 }]);
});

test('tabs as text: six lines, highest string on top, the right numbers in order', () => {
  const s = { tuning: 'standard', capo: 0 };
  const text = tabText(MELODY, arrange(MELODY, s), s, 'Twinkle');
  const lines = text.split('\n').filter(l => /^[A-G]#? ?\|/.test(l));
  assert.equal(lines.length % 6, 0);
  assert.ok(lines[0].startsWith('E |') && lines[5].startsWith('E |') && lines[1].startsWith('B |'));
  const placed = arrange(MELODY, s);
  const numbers = [...lines.slice(0, 6).join('').matchAll(/\d+/g)].length;
  assert.equal(numbers, MELODY.length, 'one number for each note');
  assert.ok(text.includes('Twinkle') && text.includes('Standard'));
  for (const l of lines) assert.ok(l.length <= 80, 'lines fit a page');
  assert.ok(placed.every(Boolean));
  assert.ok(tabText([], [], s).includes('no notes'));
});

test('MIDI: the notes written are the notes read back', () => {
  const bytes = midiFile(CHORDS, 'Chords');
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const back = readMidi(bytes), want = [...CHORDS].sort((a, b) => a.t - b.t || a.p - b.p);
  assert.equal(back.length, want.length);
  back.forEach((n, i) => {
    assert.equal(n.p, want[i].p);
    assert.ok(Math.abs(n.t - want[i].t) < 0.002 && Math.abs(n.d - want[i].d) < 0.002);
  });
  assert.equal(readMidi(midiFile([])).length, 0);
  // The same pitch struck again while it still sounds: two notes, the first ending where the second starts.
  const again = readMidi(midiFile([{ t: 1, d: 2, p: 60 }, { t: 2, d: 1, p: 60 }]));
  assert.deepEqual(again.map(n => [n.t, n.d]), [[1, 1], [2, 1]]);
});

test('project files: everything comes back, with or without the recording; a wrong file is refused', () => {
  const piece = { name: 'My song', notes: [{ t: 1, d: 0.5, p: 60, a: 0.7, s: 0.9 }, { t: 2, d: 0.5, p: 64, g: 2, hand: true, s: 1 }], settings: { capo: 2, tuning: 'dropD' }, duration: 12.5 };
  const sound = { bytes: new Uint8Array(5000).map((v, i) => i % 251), type: 'audio/mpeg', name: 'song.mp3' };
  const a = unpack(pack(piece, sound));
  assert.deepEqual(a.notes, piece.notes);
  assert.deepEqual(a.settings, piece.settings);
  assert.equal(a.name, 'My song');
  assert.equal(a.duration, 12.5);
  assert.deepEqual([...a.sound.bytes], [...sound.bytes]);
  assert.equal(a.sound.type, 'audio/mpeg');
  assert.equal(unpack(pack(piece)).sound, null);
  assert.throws(() => unpack(new Uint8Array([1, 2, 3])), /isn't a KUDUNOTES/);
  assert.throws(() => unpack(pack(piece, sound).subarray(0, 300)), /cut short/);
  const odd = unpack(pack({ ...piece, notes: [{ t: 1, d: 1, p: 60 }, { t: -1, d: 1, p: 60 }, { t: 1, d: 1, p: 500 }, null, { t: 'x' }] }));
  assert.equal(odd.notes.length, 1, 'notes that make no sense are left out');
});

test('editing: add, move, delete, undo and redo; changed notes stay whatever the slider says', () => {
  const piece = new Piece({ notes: [{ t: 1, d: 0.5, p: 60, a: 0.5, s: 0.4 }, { t: 2, d: 0.5, p: 62, a: 0.5, s: 0.9 }] });
  piece.settings.least = 0.7;
  assert.equal(piece.shown.length, 1);
  const faint = piece.notes[0].id;
  piece.move([faint], { dp: 2, dt: 0.25 });
  assert.equal(piece.shown.length, 2, 'a note changed by hand is kept');
  assert.equal(piece.notes.find(n => n.id === faint).p, 62);
  const added = piece.add(3, 67);
  assert.equal(piece.shown.length, 3);
  piece.remove([added.id]);
  assert.equal(piece.notes.length, 2);
  assert.ok(piece.undo());
  assert.equal(piece.notes.length, 3);
  assert.ok(piece.undo() && piece.undo());
  assert.equal(piece.notes.find(n => n.id === faint).p, 60);
  assert.equal(piece.undo(), false, 'nothing more to undo');
  assert.ok(piece.redo() && piece.redo() && piece.redo());
  assert.equal(piece.notes.length, 2);
  assert.equal(piece.redo(), false);
  piece.move([faint], { dp: -200 });
  assert.equal(piece.notes.find(n => n.id === faint).p, 21, 'kept on the piano');
  piece.onString(faint, 2);
  assert.equal(piece.notes.find(n => n.id === faint).g, 2);
  piece.move([faint], { dp: 1 });
  assert.equal(piece.notes.find(n => n.id === faint).g, undefined, 'a new pitch forgets the string chosen by hand');
  assert.equal(piece.plain().notes[0].id, undefined);
});
