// Listening: turns sound into notes, on this device. The engine is Spotify's Basic Pitch (vendor/listen), which hears
// several notes at once and isn't tied to one instrument. Nothing is sent anywhere.
import { BasicPitch, outputToNotesPoly, noteFramesToTime, tf } from '../vendor/listen/listen.js';

export const RATE = 22050; // the engine wants mono sound at this rate

let engine = null;
let backend = null;

/** Gets the engine ready (once). Returns how it runs: 'webgl' (the graphics card, fast) or 'cpu' (slow but always works). */
export async function ready() {
  if (engine) return backend;
  try {
    await tf.setBackend('webgl');
    await tf.ready();
  } catch {
    await tf.setBackend('cpu');
    await tf.ready();
  }
  backend = tf.getBackend();
  engine = new BasicPitch(new URL('../vendor/listen/model/model.json', import.meta.url).href);
  await engine.model;
  return backend;
}

/** Any decoded sound as one channel at the engine's rate. */
export async function toMono(audioBuffer) {
  const length = Math.max(1, Math.ceil(audioBuffer.duration * RATE));
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = new Offline(1, length, RATE);
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

// Notes are found generously (quiet and doubtful ones included), each with how sure the engine was. The app's
// "faint notes" slider then hides the doubtful ones without listening again.
const ONSET = 0.3, FRAME = 0.2, SHORTEST = 6;
const FRAMES_A_SECOND = RATE / 256, LOWEST = 21; // the engine's time steps, and the lowest note it knows (the piano's low A)

/**
 * Finds the notes in mono sound at RATE. `progress` gets 0..1.
 * Returns [{ t: start in seconds, d: length in seconds, p: MIDI pitch, a: how strong (0..1) }], in order of start.
 */
export async function findNotes(samples, progress = () => {}) {
  await ready();
  const frames = [], onsets = [];
  await engine.evaluateModel(samples, (f, o) => {
    for (const row of f) frames.push(row);
    for (const row of o) onsets.push(row);
  }, p => progress(Math.min(1, p)));
  if (frames.length === 0) return [];
  const found = noteFramesToTime(outputToNotesPoly(frames, onsets, ONSET, FRAME, SHORTEST, true, null, null, true));
  return found
    .map(n => {
      // How clearly the engine heard this note begin: the strongest "a note starts here" signal around its start.
      const at = Math.round(n.startTimeSeconds * FRAMES_A_SECOND), key = n.pitchMidi - LOWEST;
      let o = 0;
      for (let f = Math.max(0, at - 3); f <= Math.min(onsets.length - 1, at + 3); f++) o = Math.max(o, onsets[f][key] || 0);
      return { t: round(n.startTimeSeconds), d: round(Math.max(0.05, n.durationSeconds)), p: n.pitchMidi, a: round(Math.min(1, n.amplitude)), o: round(Math.min(1, o)) };
    })
    .sort((x, y) => x.t - y.t || x.p - y.p);
}

const round = v => Math.round(v * 1000) / 1000;
