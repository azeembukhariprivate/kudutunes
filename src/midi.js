// Writes the notes as a standard MIDI file, which other music programs can open.
// Time is kept as played: 960 steps a second (480 steps a beat at 120 beats a minute).

const STEPS_A_SECOND = 960;

/** Notes [{ t, d, p, a? }] as the bytes of a MIDI file. */
export function midiFile(notes, title = 'KUDUNOTES') {
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
    events.push({ at: on, order: 1, bytes: [0x90, n.p & 127, loud] });
    events.push({ at: off, order: 0, bytes: [0x80, n.p & 127, 0] }); // ends come before starts at the same moment
  }
  events.sort((a, b) => a.at - b.at || a.order - b.order);

  const track = [];
  const name = [...new TextEncoder().encode(title.slice(0, 100))];
  track.push(0, 0xff, 0x03, ...length(name.length), ...name);       // the piece's name
  track.push(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20);                    // 120 beats a minute
  track.push(0, 0xc0, 0);                                            // a piano sound
  let now = 0;
  for (const e of events) {
    track.push(...length(e.at - now), ...e.bytes);
    now = e.at;
  }
  track.push(0, 0xff, 0x2f, 0);                                      // the end

  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]; // one track, 480 steps a beat
  const size = track.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...track]);
}

/** A number the way MIDI files write lengths: 7 bits a byte, the last byte marked by a clear top bit. */
function length(v) {
  const out = [v & 127];
  while ((v >>>= 7) > 0) out.unshift((v & 127) | 128);
  return out;
}

/** Reads the notes back out of a MIDI file written by midiFile (used by the tests). */
export function readMidi(bytes) {
  let i = 22, now = 0, status = 0;
  const end = bytes.length, sounding = new Map(), notes = [];
  const num = () => { let v = 0, b; do { b = bytes[i++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
  while (i < end) {
    now += num();
    let b = bytes[i];
    if (b & 128) { status = b; i++; }
    if (status === 0xff) { const type = bytes[i++], len = num(); i += len; if (type === 0x2f) break; continue; }
    const kind = status & 0xf0;
    if (kind === 0xc0) { i++; continue; }
    const p = bytes[i++], v = bytes[i++];
    if (kind === 0x90 && v > 0) sounding.set(p, now);
    else if (sounding.has(p)) { const on = sounding.get(p); sounding.delete(p); notes.push({ t: on / STEPS_A_SECOND, d: (now - on) / STEPS_A_SECOND, p }); }
  }
  return notes.sort((a, b) => a.t - b.t || a.p - b.p);
}
