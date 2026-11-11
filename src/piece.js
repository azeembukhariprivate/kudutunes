// A piece being worked on: its notes, what was changed by hand, and undo.
import { shown, USUAL } from './tidy.js';

let nextId = 1;
const withIds = notes => notes.map(n => ({ ...n, id: n.id ?? nextId++ }));

export const DEFAULTS = { least: USUAL, tuning: 'standard', capo: 0, highest: 15, voice: 'piano', speed: 1, mix: 0.5 };

export class Piece {
  constructor({ id = null, name = 'Untitled', notes = [], settings = {}, duration = 0, created = Date.now() } = {}) {
    this.id = id;
    this.name = name;
    this.notes = withIds(notes);
    for (const n of this.notes) nextId = Math.max(nextId, n.id + 1);
    this.settings = { ...DEFAULTS, ...settings };
    this.duration = duration;
    this.created = created;
    this.undone = [];
    this.redone = [];
    this.onChange = () => {};
  }

  /** The notes sure enough to show (the "faint notes" slider), in order of start. */
  get shown() {
    return shown(this.notes, this.settings.least).sort((a, b) => a.t - b.t || a.p - b.p);
  }

  /** How long the piece is: the recording, or the last note's end. */
  get length() {
    return Math.max(this.duration, ...this.notes.map(n => n.t + n.d), 1);
  }

  /** Changes the notes in one step that can be undone. `change` gets a copy of the notes and returns the new ones. */
  edit(change) {
    const before = this.notes.map(n => ({ ...n }));
    const after = change(this.notes.map(n => ({ ...n })));
    if (!after) return false;
    this.undone.push(before);
    if (this.undone.length > 200) this.undone.shift();
    this.redone = [];
    this.notes = withIds(after);
    this.onChange();
    return true;
  }

  undo() {
    if (this.undone.length === 0) return false;
    this.redone.push(this.notes);
    this.notes = this.undone.pop();
    this.onChange();
    return true;
  }

  redo() {
    if (this.redone.length === 0) return false;
    this.undone.push(this.notes);
    this.notes = this.redone.pop();
    this.onChange();
    return true;
  }

  /** A note put in by hand: always shown, whatever the slider says. */
  add(t, p, d = 0.4) {
    const note = { t: Math.max(0, round(t)), d: round(d), p: clampPitch(p), a: 0.8, s: 1, hand: true, id: nextId++ };
    this.edit(notes => [...notes, note]);
    return note;
  }

  remove(ids) {
    const gone = new Set(ids);
    return this.edit(notes => (notes.some(n => gone.has(n.id)) ? notes.filter(n => !gone.has(n.id)) : null));
  }

  /** Moves notes in time and pitch, and makes them longer or shorter. A changed note counts as checked by hand. */
  move(ids, { dt = 0, dp = 0, dd = 0 }) {
    const which = new Set(ids);
    return this.edit(notes => notes.map(n => {
      if (!which.has(n.id)) return n;
      const moved = { ...n, t: Math.max(0, round(n.t + dt)), p: clampPitch(n.p + dp), d: Math.max(0.05, round(n.d + dd)), s: 1, hand: true };
      if (dp !== 0) delete moved.g; // a new pitch: the string chosen by hand no longer applies
      return moved;
    }));
  }

  /** Puts a note on a guitar string chosen by hand (null: let the app choose again). */
  onString(id, string) {
    return this.edit(notes => notes.map(n => {
      if (n.id !== id) return n;
      const m = { ...n };
      if (string == null) delete m.g; else m.g = string;
      return m;
    }));
  }

  /** What is kept when the piece is saved. */
  plain() {
    return { id: this.id, name: this.name, notes: this.notes.map(({ id, ...n }) => n), settings: { ...this.settings }, duration: this.duration, created: this.created };
  }
}

const round = v => Math.round(v * 1000) / 1000;
const clampPitch = p => Math.min(108, Math.max(21, Math.round(p)));
