// Writes the notes as a standard MIDI file, which other music programs can open.
// Time is kept as played: 960 steps a second (480 steps a beat at 120 beats a minute).

const STEPS_A_SECOND = 960;

/**
 * Notes [{ t, d, p, a? }] as the bytes of a MIDI file. With `partOf` (a note's part, 1 or 2), each part is its own
 * track and channel (two instruments); otherwise all notes are one piano track.
 */
export function midiFile(notes, title = 'KUDUTUNES', partOf = null) {
  const groups = partOf ? [1, 2].map(k => notes.filter(n => partOf(n) === k)) : [notes];
  const tracks = groups.map((group, i) => track(group, i === 0 ? title : `${title} (2)`, i));
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0, 0, tracks.length, 0x01, 0xe0]; // 480 steps a beat
  const out = [...head];
  for (const t of tracks) out.push(0x4d, 0x54, 0x72, 0x6b, (t.length >>> 24) & 255, (t.length >>> 16) & 255, (t.length >>> 8) & 255, t.length & 255, ...t);
  return new Uint8Array(out);
}

/** One track: its name, the tempo, a piano sound on `channel`, and the notes' starts and ends. */
function track(notes, title, channel) {
  const events = [];
  // A key can't be pressed again while it's down: a note still sounding when the same pitch starts again ends there.
  const sorted = [...notes].sort((x, y) => x.t - y.t || x.p - y.p), nextOn = new Map(), ends = new Map();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = sorted[i], on = Math.max(0, Math.round(n.t * STEPS_A_SECOND));
    const next = nextOn.get(n.p);
    ends.set(n, Math.max(on + 1, Math.min(Math.round((n.t + n.d) * STEPS_A_SECOND), next ?? Infinity)));
    nextOn.set(n.p, on);
  }
  for (const n of sorted) {
    const on = Math.max(0, Math.round(n.t * STEPS_A_SECOND));
    const off = ends.get(n);
    const loud = Math.max(1, Math.min(127, Math.round(45 + (n.a ?? 0.7) * 75)));
    events.push({ at: on, order: 1, bytes: [0x90 | channel, n.p & 127, loud] });
    events.push({ at: off, order: 0, bytes: [0x80 | channel, n.p & 127, 0] }); // ends come before starts at the same moment
  }
  events.sort((a, b) => a.at - b.at || a.order - b.order);

  const t = [];
  const name = [...new TextEncoder().encode(title.slice(0, 100))];
  t.push(0, 0xff, 0x03, ...length(name.length), ...name);          // the track's name
  t.push(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20);                      // 120 beats a minute
  t.push(0, 0xc0 | channel, 0);                                    // a piano sound
  let now = 0;
  for (const e of events) {
    t.push(...length(e.at - now), ...e.bytes);
    now = e.at;
  }
  t.push(0, 0xff, 0x2f, 0);                                        // the end
  return t;
}

/** A number the way MIDI files write lengths: 7 bits a byte, the last byte marked by a clear top bit. */
function length(v) {
  const out = [v & 127];
  while ((v >>>= 7) > 0) out.unshift((v & 127) | 128);
  return out;
}

/** Reads the notes back out of a MIDI file written by midiFile (used by the tests). Each note says its track (0, 1). */
export function readMidi(bytes) {
  const notes = [];
  let i = 14, trackNo = 0;
  while (i + 8 <= bytes.length) {
    /** The length of this track, from its header. */
    const size = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
    let at = i + 8, now = 0, status = 0;
    const end = at + size, sounding = new Map();
    /** Reads a number the way MIDI files write lengths: 7 bits a byte, the last byte marked by a clear top bit. */
    const num = () => { let v = 0, b; do { b = bytes[at++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
    while (at < end) {
      now += num();
      const b = bytes[at];
      if (b & 128) { status = b; at++; }
      if (status === 0xff) { const type = bytes[at++], len = num(); at += len; if (type === 0x2f) break; continue; }
      const kind = status & 0xf0;
      if (kind === 0xc0) { at++; continue; }
      const p = bytes[at++], v = bytes[at++];
      if (kind === 0x90 && v > 0) sounding.set(p, now);
      else if (sounding.has(p)) { const on = sounding.get(p); sounding.delete(p); notes.push({ t: on / STEPS_A_SECOND, d: (now - on) / STEPS_A_SECOND, p, track: trackNo }); }
    }
    i = end;
    trackNo++;
  }
  return notes.sort((a, b) => a.t - b.t || a.p - b.p);
}
