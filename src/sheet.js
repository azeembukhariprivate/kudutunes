// The sheet music on screen: a treble and a bass staff (or one per instrument), drawn on the same time line as the
// piano roll so they scroll and zoom together and the place being played moves along both. Made from the score of
// score.js: note heads, stems, flags, dots, ties, ledger lines, sharps and flats, rests, bar lines.
import { SIDE, fit, colours } from './view.js';

// Fonts with the music signs (clefs) on Windows, Mac, Android and Linux; nothing is loaded from elsewhere.
const MUSIC_FONT = '"Segoe UI Symbol", "Noto Music", "Apple Symbols", "Noto Sans Symbols 2", "DejaVu Sans", serif';
const SIGNS = { sharp: '♯', flat: '♭', natural: '♮' };
const SHARP_LINES = { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] };   // F C G D A E B
const FLAT_LINES = { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] };    // B E A D G C F
const TOP_LINE = { treble: 38, bass: 26 }; // the top staff line: F5 and A3

export class Sheet {
  /** `app` gives piece, player, line (TimeLine), selected; and `score()`, the score of score.js (or null). */
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.boxes = [];
    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = this.boxes.find(b => Math.abs(x - b.x) <= b.w && Math.abs(y - b.y) <= b.h);
      if (hit) this.app.select(hit.ids, e.shiftKey || e.ctrlKey || e.metaKey);
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

  draw(score) {
    const { g, w, h } = fit(this.canvas), c = colours(this.canvas), { player, line, selected } = this.app;
    g.fillStyle = c.bg; g.fillRect(0, 0, w, h);
    this.boxes = [];
    if (!score) return;
    // Sizes: `gap` is the space between two staff lines; everything else is measured in it.
    const gap = Math.max(5, Math.min(10, (h - 24) / 21));
    const tops = [12 + gap * 3.5, 12 + gap * 3.5 + gap * 4 + gap * 6.5];
    const yOf = (staff, l) => tops[staff] + (TOP_LINE[score.staves[staff].clef] - l) * gap / 2;

    // The staff lines, the clefs and the key signature down the left.
    for (let s = 0; s < 2; s++) {
      g.fillStyle = c.subtle;
      for (let i = 0; i < 5; i++) g.fillRect(0, Math.round(tops[s] + i * gap), w, 1);
    }
    g.fillStyle = c.line; g.fillRect(SIDE - 1, 0, 1, h);

    g.save();
    g.beginPath(); g.rect(SIDE, 0, w - SIDE, h); g.clip();
    // Bar lines through both staves, and the time signature at the first bar.
    g.fillStyle = c.text;
    score.bars.forEach((bar, i) => {
      const x = Math.round(line.x(bar.time));
      if (x >= SIDE - 2 && x <= w + 2) g.fillRect(x, tops[0], 1, tops[1] + gap * 4 - tops[0]);
      if (i === score.bars.length - 1) {
        const end = Math.round(line.x(bar.end));
        if (end <= w + 4) { g.fillRect(end - 4, tops[0], 1, tops[1] + gap * 4 - tops[0]); g.fillRect(end - 1, tops[0], 3, tops[1] + gap * 4 - tops[0]); }
      }
    });
    // At the first bar (or the left edge, when the first bar starts before the piece's beginning).
    const tx = Math.max(SIDE + 2, line.x(score.bars[0].time)) + gap * 0.6;
    g.font = `700 ${gap * 2}px system-ui, "Segoe UI", sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let s = 0; s < 2; s++) {
      g.fillText(String(score.meter), tx, tops[s] + gap);
      g.fillText('4', tx, tops[s] + gap * 3);
    }

    // The notes and rests.
    const playing = player.time;
    score.staves.forEach((st, s) => {
      const middle = TOP_LINE[st.clef] - 4; // the middle line
      const events = st.events;
      events.forEach((e, k) => {
        const x = line.x(e.time) + gap * 2.6; // after the bar line and the time signature's room
        if (x < SIDE - gap * 4 || x > w + gap * 4) return;
        if (e.rest) { rest(g, c, e, x, tops[s], gap, line); return; }
        const sounding = e.time <= playing && playing < e.end;
        const on = e.notes.some(n => selected.has(n.id));
        const ink = on ? c.accent : sounding ? c.accent : c.text;
        const lines = e.notes.map(n => n.line);
        const up = lines.reduce((a, b) => a + b, 0) / lines.length < middle;
        const hollow = e.len >= 8 && !e.whole;
        const whole = e.len === 16;
        // Ledger lines above and below the staff.
        g.fillStyle = c.subtle;
        for (const l of lines) {
          for (let ll = TOP_LINE[st.clef] + 2; ll <= l; ll += 2) g.fillRect(x - gap * 1.1, Math.round(yOf(s, ll)), gap * 2.2, 1);
          for (let ll = TOP_LINE[st.clef] - 10; ll >= l; ll -= 2) g.fillRect(x - gap * 1.1, Math.round(yOf(s, ll)), gap * 2.2, 1);
        }
        g.fillStyle = ink; g.strokeStyle = ink;
        for (const n of e.notes) {
          const y = yOf(s, n.line);
          head(g, x, y, gap, hollow || whole);
          if (n.accidental) {
            g.font = `${gap * 2.3}px ${MUSIC_FONT}`;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(SIGNS[n.accidental], x - gap * 1.9, y);
          }
          if ([12, 6, 3].includes(e.len)) {
            const dy = n.line % 2 === TOP_LINE[st.clef] % 2 ? -gap / 2 : 0; // a dot sits in a space
            g.beginPath(); g.arc(x + gap * 1.15, y + dy, gap * 0.18, 0, Math.PI * 2); g.fill();
          }
          this.boxes.push({ ids: e.notes.map(m => m.id), x, y, w: gap * 0.9, h: gap * 0.7 });
        }
        // The stem and its flags.
        if (!whole) {
          const ys = e.notes.map(n => yOf(s, n.line));
          const from = up ? Math.max(...ys) : Math.min(...ys), to = up ? Math.min(...ys) - gap * 3.4 : Math.max(...ys) + gap * 3.4;
          const sx = up ? x + gap * 0.58 : x - gap * 0.58;
          g.lineWidth = Math.max(1, gap * 0.13);
          g.beginPath(); g.moveTo(sx, from); g.lineTo(sx, to); g.stroke();
          const flags = e.len <= 1 ? 2 : e.len <= 3 ? 1 : 0;
          for (let f = 0; f < flags; f++) {
            const fy = to + (up ? 1 : -1) * f * gap * 0.8;
            g.beginPath();
            g.moveTo(sx, fy);
            g.quadraticCurveTo(sx + gap * 1.2, fy + (up ? 1 : -1) * gap * 1.1, sx + gap * 0.9, fy + (up ? 1 : -1) * gap * 2.2);
            g.stroke();
          }
        }
        // A tie to the next chord.
        if (e.tieStart) {
          const next = events.slice(k + 1).find(x2 => !x2.rest);
          if (next) {
            const x2 = line.x(next.time) + gap * 2.6;
            for (const n of e.notes) {
              const y = yOf(s, n.line) + (up ? gap * 0.8 : -gap * 0.8);
              g.lineWidth = Math.max(1, gap * 0.12);
              g.beginPath(); g.moveTo(x + gap * 0.7, y);
              g.quadraticCurveTo((x + x2) / 2, y + (up ? gap * 1.2 : -gap * 1.2), x2 - gap * 0.7, y);
              g.stroke();
            }
          }
        }
      });
    });
    g.restore();

    // Down the left: the clefs and the key signature (over the staff lines' start).
    g.fillStyle = c.bg; g.fillRect(0, 0, SIDE - 1, h);
    g.fillStyle = c.subtle;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 5; i++) g.fillRect(0, Math.round(tops[s] + i * gap), SIDE - 1, 1);
    g.fillStyle = c.text;
    score.staves.forEach((st, s) => {
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      if (st.clef === 'treble') { g.font = `${gap * 6.2}px ${MUSIC_FONT}`; g.fillText('𝄞', 1, tops[s] + gap * 4.6); }
      else { g.font = `${gap * 3.6}px ${MUSIC_FONT}`; g.fillText('𝄢', 2, tops[s] + gap * 3.1); }
      const count = Math.min(7, Math.abs(score.fifths)), lines = (score.fifths > 0 ? SHARP_LINES : FLAT_LINES)[st.clef];
      g.font = `${gap * 2}px ${MUSIC_FONT}`; g.textBaseline = 'middle'; g.textAlign = 'center';
      const room = (SIDE - gap * 3.4) / Math.max(1, count);
      for (let i = 0; i < count; i++) g.fillText(score.fifths > 0 ? '♯' : '♭', gap * 3.3 + Math.min(gap * 0.85, room) * i, yOf(s, lines[i]));
    });
    g.textAlign = 'left';
    g.fillStyle = c.line; g.fillRect(SIDE - 1, 0, 1, h);

    const px = line.x(player.time);
    if (px >= SIDE && px <= w) { g.fillStyle = c.accent; g.fillRect(Math.round(px) - 1, 0, 2, h); }
  }
}

/** A note head: an oval leaning a little, filled or hollow. */
function head(g, x, y, gap, hollow) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.35);
  g.beginPath();
  g.ellipse(0, 0, gap * 0.62, gap * 0.43, 0, 0, Math.PI * 2);
  if (hollow) { g.lineWidth = Math.max(1.2, gap * 0.18); g.stroke(); } else g.fill();
  g.restore();
}

/** A rest of the event's length, drawn in the middle of its staff (`top`: the staff's top line); a whole bar's rest in the middle of the bar. */
function rest(g, c, e, x, top, gap, line) {
  g.fillStyle = c.subtle; g.strokeStyle = c.subtle;
  if (e.whole) {
    const cx = (line.x(e.time) + line.x(e.end)) / 2;
    g.fillRect(cx - gap * 0.6, top + gap, gap * 1.2, gap * 0.5); // hangs from the second line
    return;
  }
  if (e.len >= 8) { g.fillRect(x - gap * 0.6, top + gap * 1.5, gap * 1.2, gap * 0.5); return; } // a half rest sits on the middle line
  g.lineWidth = Math.max(1.2, gap * 0.2);
  if (e.len >= 4) {
    // A quarter rest: a zigzag down the middle of the staff.
    g.beginPath();
    g.moveTo(x - gap * 0.2, top + gap * 0.6);
    g.lineTo(x + gap * 0.4, top + gap * 1.4);
    g.lineTo(x - gap * 0.3, top + gap * 2.2);
    g.lineTo(x + gap * 0.4, top + gap * 3);
    g.quadraticCurveTo(x - gap * 0.6, top + gap * 2.8, x, top + gap * 3.6);
    g.stroke();
    return;
  }
  // Eighth and sixteenth rests: a slanted stroke with one or two little flags (and a dot when dotted).
  g.beginPath(); g.moveTo(x + gap * 0.5, top + gap * 1.5); g.lineTo(x - gap * 0.1, top + gap * 3.4); g.stroke();
  const flags = e.len <= 1 ? 2 : 1;
  for (let f = 0; f < flags; f++) {
    g.beginPath(); g.arc(x - gap * 0.25 + f * gap * 0.25, top + gap * 1.6 + f * gap * 0.9, gap * 0.22, 0, Math.PI * 2); g.fill();
  }
  if (e.len === 3) { g.beginPath(); g.arc(x + gap * 0.9, top + gap * 1.5, gap * 0.16, 0, Math.PI * 2); g.fill(); }
}
