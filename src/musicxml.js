// The sheet music as a MusicXML file, which notation programs (MuseScore, Finale, Sibelius, Dorico...) open.
// Made from the same score as the drawing (score.js). One part with two staves (piano), or two parts when the piece is
// set to two instruments.
import { TYPES, STEP_NAMES } from './score.js';

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One note or rest of an event (`chord`: a note sounding with the one before it), on staff `staff` in voice `voice`. */
function noteXml(e, n, chord, staff, voice) {
  const [type, dots] = e.whole ? ['whole', 0] : TYPES[e.len];
  const x = ['<note>'];
  if (e.rest) x.push(e.whole ? '<rest measure="yes"/>' : '<rest/>');
  else {
    if (chord) x.push('<chord/>');
    x.push(`<pitch><step>${STEP_NAMES[n.step]}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>`);
  }
  x.push(`<duration>${e.len}</duration>`);
  if (!e.rest && e.tieStop) x.push('<tie type="stop"/>');
  if (!e.rest && e.tieStart) x.push('<tie type="start"/>');
  x.push(`<voice>${voice}</voice>`);
  if (!e.whole) x.push(`<type>${type}</type>`);
  for (let i = 0; i < dots; i++) x.push('<dot/>');
  if (!e.rest && n.accidental) x.push(`<accidental>${n.accidental}</accidental>`);
  if (staff) x.push(`<staff>${staff}</staff>`);
  if (!e.rest && (e.tieStart || e.tieStop)) {
    x.push('<notations>' + (e.tieStop ? '<tied type="stop"/>' : '') + (e.tieStart ? '<tied type="start"/>' : '') + '</notations>');
  }
  x.push('</note>');
  return x.join('');
}

/** The notes and rests of a bar on one staff (a chord's notes after the first are marked as sounding with it). */
function eventsXml(events, staff, voice) {
  const out = [];
  for (const e of events) {
    if (e.rest) out.push(noteXml(e, null, false, staff, voice));
    else e.notes.forEach((n, i) => out.push(noteXml(e, n, i > 0, staff, voice)));
  }
  return out.join('');
}

/** What the first bar starts with: the key, the time signature, the clefs and the tempo. */
function attributes(score, clefs) {
  const staves = clefs.length > 1 ? `<staves>${clefs.length}</staves>` : '';
  const clefXml = clefs.map((c, i) => `<clef${clefs.length > 1 ? ` number="${i + 1}"` : ''}><sign>${c === 'treble' ? 'G' : 'F'}</sign><line>${c === 'treble' ? 2 : 4}</line></clef>`).join('');
  return `<attributes><divisions>4</divisions><key><fifths>${score.fifths}</fifths></key><time><beats>${score.meter}</beats><beat-type>4</beat-type></time>${staves}${clefXml}</attributes>` +
    `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>`;
}

/** The MusicXML text of a score from buildScore. `twoParts`: two instruments, each its own part. */
export function musicXml(score, title = 'KUDUTUNES', twoParts = false) {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    `<score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work>` +
    '<identification><encoding><software>KUDUTUNES</software></encoding></identification>';
  const bars = score.bars.length, byBar = st => Array.from({ length: bars }, (_, b) => st.events.filter(e => e.bar === b));
  if (twoParts) {
    const list = '<part-list>' + score.staves.map((st, i) => `<score-part id="P${i + 1}"><part-name>Instrument ${i + 1}</part-name></score-part>`).join('') + '</part-list>';
    const parts = score.staves.map((st, i) => {
      const measures = byBar(st).map((events, b) => `<measure number="${b + 1}">${b === 0 ? attributes(score, [st.clef]) : ''}${eventsXml(events, 0, 1)}</measure>`);
      return `<part id="P${i + 1}">${measures.join('')}</part>`;
    });
    return head + list + parts.join('') + '</score-partwise>\n';
  }
  const list = '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>';
  const [upper, lower] = score.staves.map(byBar);
  const measures = upper.map((events, b) =>
    `<measure number="${b + 1}">${b === 0 ? attributes(score, score.staves.map(s => s.clef)) : ''}` +
    eventsXml(events, 1, 1) + `<backup><duration>${score.barSteps}</duration></backup>` + eventsXml(lower[b], 2, 5) + '</measure>');
  return head + list + `<part id="P1">${measures.join('')}</part>` + '</score-partwise>\n';
}
