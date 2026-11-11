// The two pictures of a piece, drawn on the same time line so they scroll together: the piano roll (a bar for each
// note beside a keyboard, to click, drag and stretch) and the guitar tabs (six strings with fret numbers).
import { NAMES, TUNINGS, setup } from './guitar.js';

export const SIDE = 56;   // the keyboard / string names down the left
const RULER = 24;         // the time ruler along the top of the roll
const BLACK = [1, 3, 6, 8, 10];

/** What both pictures share: which moment is at the left edge, and how wide a second is. */
export class TimeLine {
  constructor() { this.t0 = 0; this.pps = 110; }
  x(t) { return SIDE + (t - this.t0) * this.pps; }
  t(x) { return this.t0 + (x - SIDE) / this.pps; }
  zoom(by, aroundX) {
    const at = this.t(aroundX);
    this.pps = Math.min(600, Math.max(20, this.pps * by));
    this.t0 = Math.max(0, at - (aroundX - SIDE) / this.pps);
  }
  scroll(seconds, length, width) {
    const most = Math.max(0, length - (width - SIDE) / this.pps * 0.5);
    this.t0 = Math.min(most, Math.max(0, this.t0 + seconds));
  }
}

function colours(el) {
  const c = getComputedStyle(el), v = n => c.getPropertyValue(n).trim();
  return { bg: v('--card'), alt: v('--row'), line: v('--line'), text: v('--text'), subtle: v('--subtle'), accent: v('--accent'), key: v('--key'), dark: v('--key-dark'), head: v('--head') };
}
const hue = p => `hsl(${(((p % 12) + 12) % 12) * 30 + 200}, 68%, 56%)`;
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function fit(canvas) {
  const r = canvas.getBoundingClientRect(), k = window.devicePixelRatio || 1;
  const w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
  if (canvas.width !== w * k || canvas.height !== h * k) { canvas.width = w * k; canvas.height = h * k; }
  const g = canvas.getContext('2d');
  g.setTransform(k, 0, 0, k, 0, 0);
  return { g, w, h };
}

export class Roll {
  /**
   * `app` gives: piece, player, line (TimeLine), selected (Set of note ids), and is told of what the person does:
   * select(ids, add), changed(), seek(t), loop({from, to} | null), redraw().
   */
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.drag = null;
    this.low = 48;
    this.high = 84;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', () => { this.drag = null; this.app.redraw(); });
    canvas.addEventListener('dblclick', e => this.double(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
  }

  /** The pitches shown: the notes' own range with a little room, at least two octaves. */
  range() {
    const notes = this.app.piece.shown;
    let low = 60, high = 72;
    if (notes.length) { low = Math.min(...notes.map(n => n.p)); high = Math.max(...notes.map(n => n.p)); }
    low -= 3; high += 3;
    while (high - low < 24) { low--; high++; }
    this.low = Math.max(21, low);
    this.high = Math.min(108, high);
  }

  y(p) { return RULER + (this.high - p) * this.row; }
  pitchAt(y) { return Math.round(this.high - (y - RULER) / this.row + 0.5); }

  /** A note as it's drawn now, with any drag in progress applied. */
  shownAs(n) {
    const d = this.drag;
    if (!d || !d.moved || !this.app.selected.has(n.id)) return n;
    if (d.kind === 'move') return { ...n, t: Math.max(0, n.t + d.dt), p: Math.min(108, Math.max(21, n.p + d.dp)) };
    if (d.kind === 'stretch') return { ...n, d: Math.max(0.05, n.d + d.dd) };
    return n;
  }

  draw() {
    const { g, w, h } = fit(this.canvas), c = colours(this.canvas), { piece, player, line, selected } = this.app;
    this.w = w; this.h = h;
    if (!this.drag) this.range();
    const rows = this.high - this.low + 1;
    this.row = (h - RULER) / rows;

    g.fillStyle = c.bg;
    g.fillRect(0, 0, w, h);
    // Rows: the black keys' rows a shade darker, a line under each C.
    for (let p = this.low; p <= this.high; p++) {
      const y = this.y(p);
      if (BLACK.includes(p % 12)) { g.fillStyle = c.alt; g.fillRect(SIDE, y, w - SIDE, this.row); }
      if (p % 12 === 0) { g.fillStyle = c.line; g.fillRect(SIDE, y + this.row - 0.5, w - SIDE, 1); }
    }
    // Time: a line each second (fewer when zoomed out), the ruler along the top.
    const every = line.pps > 80 ? 1 : line.pps > 35 ? 2 : 5;
    g.fillStyle = c.head;
    g.fillRect(SIDE, 0, w - SIDE, RULER);
    g.font = '11px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    for (let t = Math.floor(line.t0 / every) * every; line.x(t) < w; t += every) {
      const x = Math.round(line.x(t));
      if (x < SIDE) continue;
      g.fillStyle = c.line;
      g.fillRect(x, RULER, 1, h - RULER);
      g.fillStyle = c.subtle;
      g.fillText(clock(t), x + 4, RULER / 2);
    }
    // The part being repeated.
    const loop = this.drag && this.drag.kind === 'ruler' && this.drag.moved ? { from: Math.min(this.drag.from, this.drag.to), to: Math.max(this.drag.from, this.drag.to) } : player.loop;
    if (loop) {
      const a = Math.max(SIDE, line.x(loop.from)), b = Math.min(w, line.x(loop.to));
      if (b > a) {
        g.globalAlpha = 0.14; g.fillStyle = c.accent; g.fillRect(a, RULER, b - a, h - RULER);
        g.globalAlpha = 0.5; g.fillRect(a, 0, b - a, RULER);
        g.globalAlpha = 1;
      }
    }
    // Past the end of the piece.
    const end = line.x(piece.length);
    if (end < w) { g.globalAlpha = 0.35; g.fillStyle = c.alt; g.fillRect(Math.max(SIDE, end), RULER, w - end, h - RULER); g.globalAlpha = 1; }

    // The notes.
    this.boxes = [];
    g.save();
    g.beginPath(); g.rect(SIDE, RULER, w - SIDE, h - RULER); g.clip();
    const pad = this.row > 5 ? 1 : 0;
    for (const real of piece.shown) {
      const n = this.shownAs(real), x = line.x(n.t), wide = Math.max(3, n.d * line.pps);
      if (x + wide < SIDE || x > w || n.p < this.low || n.p > this.high) continue;
      const y = this.y(n.p) + pad, tall = Math.max(2, this.row - pad * 2), on = selected.has(real.id);
      g.fillStyle = hue(n.p);
      g.globalAlpha = on ? 1 : 0.88;
      round(g, x, y, wide, tall, Math.min(3, tall / 2)); g.fill();
      g.globalAlpha = 1;
      if (on) { g.lineWidth = 2; g.strokeStyle = c.text; round(g, x, y, wide, tall, Math.min(3, tall / 2)); g.stroke(); }
      if (this.row >= 11 && wide > 22) { g.fillStyle = '#10151c'; g.font = `${Math.min(11, this.row - 2)}px system-ui, "Segoe UI", sans-serif`; g.fillText(NAMES[n.p % 12], x + 4, y + tall / 2 + 0.5); }
      this.boxes.push({ id: real.id, x, y: this.y(n.p), w: wide, h: this.row });
    }
    // The box being dragged round notes to pick them.
    if (this.drag && this.drag.kind === 'box' && this.drag.moved) {
      const d = this.drag;
      g.strokeStyle = c.accent; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }
    g.restore();

    // The keyboard, with the keys of the notes sounding now lit.
    const sounding = new Set(piece.shown.filter(n => n.t <= player.time && player.time < n.t + n.d).map(n => n.p));
    g.fillStyle = c.head; g.fillRect(0, 0, SIDE, RULER);
    for (let p = this.low; p <= this.high; p++) {
      const y = this.y(p), black = BLACK.includes(p % 12);
      g.fillStyle = sounding.has(p) ? hue(p) : black ? c.dark : c.key;
      g.fillRect(0, y, black ? SIDE * 0.62 : SIDE - 1, Math.max(1, this.row - (this.row > 4 ? 0.5 : 0)));
      if (p % 12 === 0 && this.row >= 7) {
        g.fillStyle = sounding.has(p) ? '#10151c' : c.subtle;
        g.font = '10px system-ui, "Segoe UI", sans-serif';
        g.fillText('C' + (p / 12 - 1), SIDE - 22, y + this.row / 2 + 0.5);
      }
    }
    g.fillStyle = c.line; g.fillRect(SIDE - 1, 0, 1, h);
    g.fillRect(0, RULER - 1, w, 1);

    // Where the music is now.
    const px = line.x(player.time);
    if (px >= SIDE && px <= w) { g.fillStyle = c.accent; g.fillRect(Math.round(px) - 1, 0, 2, h); }
  }

  at(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  noteAt(x, y) {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      if (x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  down(e) {
    if (e.button !== 0) return;
    const { x, y } = this.at(e), { line, selected, player, piece } = this.app;
    this.canvas.setPointerCapture(e.pointerId);
    if (x < SIDE) {
      if (y > RULER) player.sample(Math.min(this.high, Math.max(this.low, this.pitchAt(y))));
      return;
    }
    if (y < RULER) { this.drag = { kind: 'ruler', x0: x, from: Math.max(0, line.t(x)), to: Math.max(0, line.t(x)), moved: false }; return; }
    const box = this.noteAt(x, y);
    if (box) {
      const more = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!selected.has(box.id)) this.app.select([box.id], more);
      else if (more) { this.app.select([...selected].filter(id => id !== box.id), false); this.app.redraw(); return; }
      const edge = box.w > 12 && x > box.x + box.w - 7;
      this.drag = { kind: edge ? 'stretch' : 'move', x0: x, y0: y, dt: 0, dp: 0, dd: 0, moved: false, pitch: piece.notes.find(n => n.id === box.id)?.p };
    } else {
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, moved: false, add: e.shiftKey };
    }
    this.app.redraw();
  }

  move(e) {
    const { x, y } = this.at(e), d = this.drag, { line } = this.app;
    if (!d) {
      const box = x > SIDE && y > RULER ? this.noteAt(x, y) : null;
      this.canvas.style.cursor = box ? (box.w > 12 && x > box.x + box.w - 7 ? 'ew-resize' : 'grab') : y < RULER && x > SIDE ? 'pointer' : x < SIDE ? 'pointer' : 'default';
      return;
    }
    if (Math.abs(x - d.x0) > 3 || (d.y0 != null && Math.abs(y - d.y0) > 3)) d.moved = true;
    if (d.kind === 'ruler') d.to = Math.max(0, line.t(Math.max(SIDE, x)));
    else if (d.kind === 'move') {
      d.dt = (x - d.x0) / line.pps;
      const dp = -Math.round((y - d.y0) / this.row);
      if (dp !== d.dp && d.pitch != null) this.app.player.sample(Math.min(108, Math.max(21, d.pitch + dp)), 0.25);
      d.dp = dp;
    } else if (d.kind === 'stretch') d.dd = (x - d.x0) / line.pps;
    else if (d.kind === 'box') { d.x1 = x; d.y1 = y; }
    this.app.redraw();
  }

  up(e) {
    const d = this.drag, { piece, selected, line } = this.app;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'ruler') {
      if (d.moved) this.app.loop({ from: Math.min(d.from, d.to), to: Math.max(d.from, d.to) });
      else this.app.seek(d.from);
    } else if (d.kind === 'move' && d.moved && (Math.abs(d.dt) > 0.004 || d.dp !== 0)) {
      piece.move([...selected], { dt: d.dt, dp: d.dp });
    } else if (d.kind === 'stretch' && d.moved && Math.abs(d.dd) > 0.004) {
      piece.move([...selected], { dd: d.dd });
    } else if (d.kind === 'box') {
      if (d.moved) {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        this.app.select(this.boxes.filter(b => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0).map(b => b.id), d.add);
      } else if (!d.add) this.app.select([], false);
    }
    void line; void e;
    this.app.redraw();
  }

  /** A double click on an empty place puts a note there. */
  double(e) {
    const { x, y } = this.at(e), { line, piece, player } = this.app;
    if (x < SIDE || y < RULER || this.noteAt(x, y)) return;
    const p = Math.min(this.high, Math.max(this.low, this.pitchAt(y)));
    const note = piece.add(Math.max(0, line.t(x)), p);
    this.app.select([note.id], false);
    player.sample(p);
  }

  wheel(e) {
    e.preventDefault();
    const { line, piece } = this.app, { x } = this.at(e);
    if (e.ctrlKey || e.metaKey) line.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, Math.max(SIDE, x));
    else line.scroll((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / line.pps, piece.length, this.w);
    this.app.redraw();
  }
}

export class Tabs {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.boxes = [];
    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = this.boxes.find(b => Math.abs(x - b.x) <= b.w / 2 + 2 && Math.abs(y - b.y) <= 10);
      if (hit) this.app.select([hit.id], e.shiftKey || e.ctrlKey || e.metaKey);
      else if (x > SIDE) this.app.seek(Math.max(0, this.app.line.t(x)));
      this.app.redraw();
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const { line, piece } = this.app, r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) line.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, Math.max(SIDE, e.clientX - r.left));
      else line.scroll((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / line.pps, piece.length, r.width);
      this.app.redraw();
    }, { passive: false });
  }

  /** `placed` is a Map from note id to { string, fret }, from the app (it changes only when the notes do). */
  draw(placed) {
    const { g, w, h } = fit(this.canvas), c = colours(this.canvas), { piece, player, line, selected } = this.app;
    const open = TUNINGS[setup(piece.settings).tuning].notes;
    g.fillStyle = c.bg; g.fillRect(0, 0, w, h);
    const top = 18, gap = (h - top * 2) / 5, yOf = s => top + (5 - s) * gap; // the highest string on top
    g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    for (let s = 0; s < 6; s++) {
      g.fillStyle = c.line; g.fillRect(SIDE, Math.round(yOf(s)), w - SIDE, 1);
      g.fillStyle = c.subtle; g.fillText(NAMES[open[s] % 12], SIDE - 24, yOf(s));
    }
    g.fillStyle = c.head; g.fillRect(0, 0, 8, h);
    g.fillStyle = c.line; g.fillRect(SIDE - 1, 0, 1, h);

    this.boxes = [];
    g.save();
    g.beginPath(); g.rect(SIDE, 0, w - SIDE, h); g.clip();
    g.font = '600 13px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    for (const n of piece.shown) {
      const place = placed.get(n.id);
      if (!place) continue;
      const x = line.x(n.t) + 7;
      if (x < SIDE - 20 || x > w + 20) continue;
      const y = yOf(place.string), text = String(place.fret), wide = text.length > 1 ? 22 : 16, on = selected.has(n.id);
      const sounding = n.t <= player.time && player.time < n.t + n.d;
      g.fillStyle = on ? c.text : sounding ? hue(n.p) : c.bg;
      round(g, x - wide / 2, y - 9, wide, 18, 4); g.fill();
      g.fillStyle = on ? c.bg : sounding ? '#10151c' : c.text;
      g.fillText(text, x, y + 0.5);
      this.boxes.push({ id: n.id, x, y, w: wide });
    }
    g.textAlign = 'left';
    g.restore();
    const px = line.x(player.time);
    if (px >= SIDE && px <= w) { g.fillStyle = c.accent; g.fillRect(Math.round(px) - 1, 0, 2, h); }
  }
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
