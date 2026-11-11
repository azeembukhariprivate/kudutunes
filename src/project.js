// A piece as one file (".kudutunes") to keep or carry to another device: the notes and settings, and the recording
// too when it's included. The file is: the words "KUDUTUNES 1" and a new line, the length of the description (4
// bytes), the description (JSON text), then the recording's bytes as they were.

const MARK = 'KUDUTUNES 1\n';
// Files saved before the app was renamed (".kudunotes") start with these words instead, and open the same way.
const OLD_MARK = 'KUDUNOTES 1\n';

/** Packs { name, notes, settings, duration } and an optional recording { bytes: Uint8Array, type } into bytes. */
export function pack(piece, sound = null) {
  const about = {
    name: piece.name, notes: piece.notes, settings: piece.settings, duration: piece.duration,
    sound: sound ? { type: sound.type || 'application/octet-stream', size: sound.bytes.length, name: sound.name || '' } : null
  };
  const mark = new TextEncoder().encode(MARK), json = new TextEncoder().encode(JSON.stringify(about));
  const out = new Uint8Array(mark.length + 4 + json.length + (sound ? sound.bytes.length : 0));
  out.set(mark, 0);
  new DataView(out.buffer).setUint32(mark.length, json.length, true);
  out.set(json, mark.length + 4);
  if (sound) out.set(sound.bytes, mark.length + 4 + json.length);
  return out;
}

/** Unpacks a project file. Throws an Error in plain words when the file isn't one. */
export function unpack(bytes) {
  const starts = m => { const k = new TextEncoder().encode(m); return bytes.length >= k.length + 4 && k.every((b, i) => bytes[i] === b); };
  if (!starts(MARK) && !starts(OLD_MARK)) throw new Error("This isn't a KUDUTUNES project file.");
  const mark = new TextEncoder().encode(MARK); // both marks are the same length
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(mark.length, true);
  const from = mark.length + 4;
  if (size > bytes.length - from) throw new Error('This project file is cut short.');
  let about;
  try { about = JSON.parse(new TextDecoder().decode(bytes.subarray(from, from + size))); }
  catch { throw new Error('This project file is damaged.'); }
  if (!about || !Array.isArray(about.notes)) throw new Error('This project file is damaged.');
  const notes = about.notes.filter(n => n && isFinite(n.t) && isFinite(n.d) && Number.isInteger(n.p) && n.p >= 0 && n.p <= 127 && n.t >= 0 && n.d > 0);
  let sound = null;
  if (about.sound && about.sound.size > 0) {
    const data = bytes.subarray(from + size);
    if (data.length !== about.sound.size) throw new Error('This project file is cut short: its recording is incomplete.');
    sound = { bytes: data, type: String(about.sound.type || ''), name: String(about.sound.name || '') };
  }
  return { name: String(about.name || 'Untitled'), notes, settings: about.settings && typeof about.settings === 'object' ? about.settings : {}, duration: Number(about.duration) || 0, sound };
}
