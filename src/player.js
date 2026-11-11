// Playback: the notes in the app's own sound, the recording, or both, in step. Slower or faster without changing the
// pitch, looping a part, and jumping anywhere.
import { Synth } from './synth.js';

const AHEAD = 0.12; // notes are handed to the sound system this many seconds before they sound

export class Player {
  /** `notes` is a function returning the notes to play now (those shown), in order of start. */
  constructor(notes) {
    this.notes = notes;
    this.ctx = null;
    this.sound = null;      // the recording, as an <audio> element (the browser keeps its pitch when slowed)
    this.playing = false;
    this.time = 0;
    this.speed = 1;
    this.mix = 0.5;         // 0 = only the recording, 1 = only the notes, 0.5 = both in full
    this.voice = 'piano';
    this.loop = null;       // { from, to }
    this.length = 1;
    this.onTick = () => {};
    this.onEnd = () => {};
    this.queuedTo = 0;
    this.last = 0;
  }

  /** Sound can only start after a click or a key: called then. */
  wake() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.notesOut = this.ctx.createGain();
      this.notesOut.connect(this.ctx.destination);
      this.synth = new Synth(this.ctx, this.notesOut);
      this.applyMix();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** Sets (or clears) the recording to play along. */
  setSound(blob) {
    this.pause();
    if (this.sound) { URL.revokeObjectURL(this.sound.src); this.sound = null; }
    if (!blob) return;
    const el = new Audio();
    el.preload = 'auto';
    el.src = URL.createObjectURL(blob);
    el.preservesPitch = true;
    el.onerror = () => { if (this.sound === el) this.sound = null; }; // a kind the browser can't play: notes only
    this.sound = el;
    this.applyMix();
    this.applySpeed();
  }

  get hasSound() { return !!this.sound; }

  setMix(v) { this.mix = v; this.applyMix(); }
  applyMix() {
    const rec = Math.min(1, 2 * (1 - this.mix)), notes = Math.min(1, 2 * this.mix);
    if (this.sound) this.sound.volume = rec;
    if (this.notesOut) this.notesOut.gain.value = (this.sound ? notes : 1) * 0.8;
  }

  setSpeed(v) { this.speed = v; this.applySpeed(); this.requeue(); }
  applySpeed() { if (this.sound) this.sound.playbackRate = this.speed; }

  setLoop(loop) { this.loop = loop && loop.to - loop.from > 0.05 ? loop : null; }

  play() {
    if (this.playing) return;
    this.wake();
    if (this.time >= this.length - 0.02) this.time = this.loop ? this.loop.from : 0;
    this.playing = true;
    this.last = performance.now();
    this.queuedTo = this.time;
    if (this.sound) {
      this.sound.currentTime = Math.min(this.time, this.sound.duration || this.time);
      this.sound.play().catch(() => {});
    }
    const step = () => {
      if (!this.playing) return;
      this.tick();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
    // Keeps the notes coming while the tab is in the background, where drawing stops.
    this.timer = setInterval(() => this.playing && this.tick(), 50);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    clearInterval(this.timer);
    if (this.sound) this.sound.pause();
    if (this.synth) this.synth.hush();
    this.onTick(this.time);
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  /** Jumps to a time. */
  seek(t) {
    this.time = Math.min(Math.max(0, t), this.length);
    if (this.sound) { try { this.sound.currentTime = Math.min(this.time, this.sound.duration || this.time); } catch { /* not ready */ } }
    this.requeue();
    this.onTick(this.time);
  }

  requeue() {
    if (this.synth) this.synth.hush();
    this.queuedTo = this.time;
    this.last = performance.now();
  }

  tick() {
    const now = performance.now();
    // The recording is the clock when it's playing; otherwise the app keeps time itself.
    const soundRuns = this.sound && !this.sound.paused && !this.sound.ended && this.sound.readyState >= 2;
    if (soundRuns) this.time = this.sound.currentTime;
    else this.time += ((now - this.last) / 1000) * this.speed;
    this.last = now;

    const stop = this.loop ? this.loop.to : this.length;
    if (this.time >= stop) {
      if (this.loop) { this.seek(this.loop.from); if (this.sound) this.sound.play().catch(() => {}); }
      else { this.time = this.length; this.pause(); this.onEnd(); return; }
    }

    // Hand over the notes about to sound.
    const until = Math.min(stop, this.time + AHEAD * this.speed);
    const audible = !this.sound || this.mix > 0.001;
    if (audible) for (const n of this.notes()) {
      if (n.t < this.queuedTo) continue;
      if (n.t >= until) break;
      const wait = (n.t - this.time) / this.speed;
      this.synth.play(this.voice, n.p, this.ctx.currentTime + Math.max(0, wait), Math.min(n.d, stop - n.t) / this.speed, n.a ?? 0.7);
    }
    this.queuedTo = Math.max(this.queuedTo, until);
    this.onTick(this.time);
  }

  /** One note by itself (a click on the keyboard, or a note just added or moved). */
  sample(p, seconds = 0.5) {
    this.wake();
    this.synth.play(this.voice, p, this.ctx.currentTime, seconds, 0.7);
  }
}
