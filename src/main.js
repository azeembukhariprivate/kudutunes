// KUDUTUNES: the screens, and everything the buttons and keys do.
import { ready, toMono, findNotes, RATE } from './listen.js';
import { tidy } from './tidy.js';
import { Piece, DEFAULTS } from './piece.js';
import { Player } from './player.js';
import { TimeLine, Roll, Tabs, SIDE } from './view.js';
import { TUNINGS, arrange, tabText, noteName, range, otherStrings, setup } from './guitar.js';
import { midiFile } from './midi.js';
import { pack, unpack } from './project.js';
import * as store from './store.js';

export const VERSION = '1.1.1';

const $ = id => document.getElementById(id);
const testing = new URLSearchParams(location.search).has('test');
const screens = ['home', 'busy', 'record', 'editor'];

const app = {
  piece: new Piece(),
  line: new TimeLine(),
  selected: new Set(),
  placed: new Map(),
  sound: null, // { blob, name }: the recording being played along
  player: null,
  select(ids, add) {
    if (!add) app.selected.clear();
    for (const id of ids) app.selected.add(id);
    showSelection();
  },
  seek(t) { app.player.seek(t); },
  loop(l) { app.player.setLoop(l); $('clearLoop').disabled = !app.player.loop; if (app.player.loop) app.player.seek(app.player.loop.from); },
  redraw() { wantDraw(); }
};
app.player = new Player(() => app.piece.shown);
const roll = new Roll($('roll'), app), tabs = new Tabs($('tabs'), app);

// ------------------------------------------------------------------ drawing

let drawing = false;
function wantDraw() {
  if (drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    if ($('editor').hidden) return;
    roll.draw();
    tabs.draw(app.placed);
  });
}
addEventListener('resize', wantDraw);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', wantDraw);

function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  const editing = name === 'editor';
  for (const id of ['name', 'toHome', 'saveFile', 'saveMidi', 'saveTabs']) $(id).hidden = !editing;
  if (editing) wantDraw();
}

let toastTimer = null;
function toast(text, seconds = 3.5) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), seconds * 1000);
}

function ask(text, yes = 'OK') {
  return new Promise(resolve => {
    $('askText').textContent = text;
    $('askYes').textContent = yes;
    const done = v => { $('askBox').close(); $('askYes').onclick = $('askNo').onclick = $('askBox').oncancel = null; resolve(v); };
    $('askYes').onclick = () => done(true);
    $('askNo').onclick = () => done(false);
    $('askBox').oncancel = () => done(false);
    $('askBox').showModal();
  });
}

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ a piece on the screen

/** Works out the guitar places again and brings every control up to date (after any change to the notes). */
function refresh() {
  const shown = app.piece.shown, s = app.piece.settings;
  const places = arrange(shown, s);
  app.placed = new Map();
  shown.forEach((n, i) => { if (places[i]) app.placed.set(n.id, places[i]); });
  for (const id of [...app.selected]) if (!shown.some(n => n.id === id)) app.selected.delete(id);
  app.player.length = app.piece.length;

  const cant = shown.length - app.placed.size, [low, high] = range(s);
  $('tabNote').textContent = cant > 0 ? `${cant} ${cant === 1 ? 'note is' : 'notes are'} outside what the guitar can play as set up (${noteName(low)} to ${noteName(high)}), or too many at once` : '';
  $('count').textContent = `${shown.length} of ${app.piece.notes.length} notes`;
  $('undo').disabled = app.piece.undone.length === 0;
  $('redo').disabled = app.piece.redone.length === 0;
  showSelection();
  showTime();
  wantDraw();
}

function showSelection() {
  const ids = [...app.selected], one = ids.length === 1 ? app.piece.notes.find(n => n.id === ids[0]) : null;
  $('delete').disabled = ids.length === 0;
  const place = one && app.placed.get(one.id), strings = one ? otherStrings(one, app.piece.settings) : [];
  $('stringUp').disabled = !place || !strings.some(st => st > place.string);
  $('stringDown').disabled = !place || !strings.some(st => st < place.string);
  if (one) {
    const where = place ? `string ${6 - place.string}, fret ${place.fret}` : "the guitar can't play it as set up";
    status(`${noteName(one.p)} at ${one.t.toFixed(2)} s, ${one.d.toFixed(2)} s long · guitar: ${where}`);
  } else if (ids.length > 1) status(`${ids.length} notes chosen. Drag to move them, Delete to remove them.`);
  else status(app.piece.notes.length === 0 ? 'No notes were found. Double-click in the piano roll to add one.' : 'Click a note to choose it. Double-click an empty place to add one. Drag along the time ruler to repeat a part.');
  wantDraw();
}

function status(text) { $('status').textContent = text; }
function showTime() { $('time').textContent = `${clock(app.player.time)} / ${clock(app.piece.length)}`; }

/** Puts a piece on the working screen. */
function openPiece(piece, sound) {
  app.player.pause();
  app.piece = piece;
  app.sound = sound;
  app.selected.clear();
  app.line.t0 = 0;
  const s = piece.settings;
  $('name').value = piece.name;
  $('least').value = s.least;
  $('tuning').value = setup(s).tuning;
  $('capo').value = setup(s).capo;
  $('highest').value = setup(s).highest;
  $('voice').value = s.voice;
  $('speed').value = String(s.speed);
  $('mix').value = s.mix;
  app.player.voice = s.voice;
  app.player.setSound(sound ? sound.blob : null);
  app.player.setSpeed(Number(s.speed) || 1);
  app.player.setMix(Number(s.mix));
  app.player.setLoop(null);
  app.player.time = 0;
  $('clearLoop').disabled = true;
  $('mixBox').hidden = !sound;
  $('addSoundBox').hidden = !!sound;
  piece.onChange = () => { refresh(); saveSoon(); };
  show('editor');
  refresh();
}

// ------------------------------------------------------------------ keeping pieces

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if ($('editor').hidden && app.piece.id == null) return;
  try {
    app.piece.id = await store.put(app.piece.plain());
  } catch {
    toast("This browser couldn't save the piece (it may be out of room, or in a private window). Use “Save project file” to keep it.", 7);
  }
}

async function showHome() {
  app.player.pause();
  if (!$('editor').hidden) await saveNow();
  show('home');
  let pieces = [];
  try { pieces = await store.list(); } catch { /* a private window: nothing kept */ }
  $('saved').hidden = pieces.length === 0;
  $('pieces').replaceChildren(...pieces.map(p => {
    const row = document.createElement('div');
    row.className = 'piece';
    const what = document.createElement('div');
    what.className = 'what';
    const b = document.createElement('b'), small = document.createElement('span');
    b.textContent = p.name || 'Untitled';
    small.textContent = `${p.notes.length} notes · ${clock(p.duration || 0)} · changed ${new Date(p.changed || p.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    what.append(b, small);
    const open = document.createElement('button'), del = document.createElement('button');
    open.textContent = 'Open';
    open.className = 'main';
    open.onclick = async () => {
      const kept = await store.getSound(p.id);
      openPiece(new Piece(p), kept ? { blob: kept.blob, name: kept.name } : null);
    };
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (!(await ask(`Delete “${p.name || 'Untitled'}” from this browser? This can't be undone.`, 'Delete'))) return;
      await store.remove(p.id);
      showHome();
    };
    row.append(what, open, del);
    return row;
  }));
}

// ------------------------------------------------------------------ listening

function busy(title, hint) {
  $('busyTitle').textContent = title;
  if (hint) $('busyHint').textContent = hint;
  $('busyBar').removeAttribute('value');
  show('busy');
}

/** Listens to decoded sound and opens the result as a new piece. */
async function listenTo(samples, duration, name, blob) {
  busy('Getting ready to listen…', 'Finding the notes. A long recording takes a while; you can leave this tab open and do something else.');
  await ready();
  $('busyTitle').textContent = 'Listening…';
  $('busyBar').value = 0;
  const found = await findNotes(samples, p => { $('busyBar').value = p; });
  const piece = new Piece({ name, notes: tidy(found), duration });
  piece.id = null;
  try {
    piece.id = await store.put(piece.plain());
    if (blob && !(await store.putSound(piece.id, blob, name))) toast("The recording is too big to keep in this browser. The notes are saved; open the recording again next time to hear it.", 7);
  } catch { /* a private window: the piece is open but not kept */ }
  openPiece(piece, blob ? { blob, name } : null);
  if (piece.notes.length === 0) toast('No notes were found in this recording.', 5);
}

async function decode(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close().catch(() => {});
  }
}

async function openSound(file) {
  if (!$('editor').hidden) await saveNow();
  app.player.pause();
  busy('Reading the sound…');
  let audio;
  try {
    audio = await decode(file);
  } catch {
    await showHome();
    toast("This file's sound couldn't be read. Try an MP3, WAV or M4A file.", 6);
    return;
  }
  if (audio.duration > 20 * 60 && !(await ask(`This recording is ${Math.round(audio.duration / 60)} minutes long. Listening to it all can take a long time and a lot of memory. Carry on?`, 'Carry on'))) return showHome();
  try {
    await listenTo(await toMono(audio), audio.duration, (file.name || 'Recording').replace(/\.[^.]+$/, ''), file);
  } catch (e) {
    console.error(e);
    await showHome();
    toast('Something went wrong while listening. A shorter recording may work.', 6);
  }
}

async function openProject(file) {
  let data;
  try { data = unpack(new Uint8Array(await file.arrayBuffer())); }
  catch (e) { toast(e.message, 6); return; }
  if (!$('editor').hidden) await saveNow();
  const piece = new Piece({ name: data.name, notes: data.notes, settings: data.settings, duration: data.duration });
  const blob = data.sound ? new Blob([data.sound.bytes], { type: data.sound.type }) : null;
  try {
    piece.id = await store.put(piece.plain());
    if (blob) await store.putSound(piece.id, blob, data.sound.name);
  } catch { /* not kept */ }
  openPiece(piece, blob ? { blob, name: data.sound.name } : null);
}

function openAny(file) {
  if (!file) return;
  if (/\.kudu(tunes|notes)$/i.test(file.name)) openProject(file); // .kudunotes: saved before the app was renamed
  else openSound(file);
}

// ------------------------------------------------------------------ recording

const rec = { stream: null, recorder: null, parts: [], started: 0, timer: null, ctx: null, keep: false };

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    toast(location.protocol === 'https:' || location.hostname === 'localhost' ? "This browser can't record sound." : 'Recording needs a secure address (https). Opening a sound file still works.', 7);
    return;
  }
  try {
    // The microphone's own "improvements" are for speech and spoil music: switched off.
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    toast("The microphone couldn't be used. Allow it in the browser's address bar and try again.", 6);
    return;
  }
  rec.parts = [];
  rec.keep = false;
  rec.recorder = new MediaRecorder(rec.stream);
  rec.recorder.ondataavailable = e => { if (e.data.size) rec.parts.push(e.data); };
  rec.recorder.onstop = finishRecording;
  rec.recorder.start(1000);
  rec.started = performance.now();

  const AC = window.AudioContext || window.webkitAudioContext;
  rec.ctx = new AC();
  const meter = rec.ctx.createAnalyser(), data = new Float32Array(1024);
  rec.ctx.createMediaStreamSource(rec.stream).connect(meter);
  rec.timer = setInterval(() => {
    $('clock').textContent = clock((performance.now() - rec.started) / 1000);
    meter.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    $('level').firstElementChild.style.width = Math.min(100, Math.round(peak * 140)) + '%';
  }, 100);
  $('clock').textContent = '0:00';
  show('record');
}

function stopRecording(keep) {
  rec.keep = keep;
  clearInterval(rec.timer);
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
  if (rec.ctx) rec.ctx.close().catch(() => {});
}

async function finishRecording() {
  if (!rec.keep) return showHome();
  const blob = new Blob(rec.parts, { type: rec.recorder.mimeType || 'audio/webm' });
  const when = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const file = new File([blob], `Recording ${when}.webm`, { type: blob.type });
  await openSound(file);
}

// ------------------------------------------------------------------ files out

function download(bytes, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
const fileName = () => (app.piece.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Untitled';

async function saveProjectFile() {
  const p = app.piece.plain();
  let sound = null;
  if (app.sound && app.sound.blob.size <= store.BIGGEST_SOUND) sound = { bytes: new Uint8Array(await app.sound.blob.arrayBuffer()), type: app.sound.blob.type, name: app.sound.name };
  download(pack(p, sound), fileName() + '.kudutunes', 'application/octet-stream');
  toast(sound ? 'Saved, with the recording inside.' : app.sound ? 'Saved without the recording (it is too big). The notes are all there.' : 'Saved.');
}

// ------------------------------------------------------------------ buttons and keys

function changeSetting(key, value, redoPlaces = true) {
  app.piece.settings[key] = value;
  if (redoPlaces) refresh();
  saveSoon();
}

function moveString(dir) {
  const id = [...app.selected][0], note = app.piece.notes.find(n => n.id === id), place = app.placed.get(id);
  if (app.selected.size !== 1 || !note || !place) return;
  const options = otherStrings(note, app.piece.settings).filter(st => (dir > 0 ? st > place.string : st < place.string));
  if (options.length === 0) return;
  app.piece.onString(id, dir > 0 ? Math.min(...options) : Math.max(...options));
}

function nudge(dt, dp) {
  if (app.selected.size === 0) return false;
  app.piece.move([...app.selected], { dt, dp });
  if (dp !== 0 && app.selected.size === 1) { const n = app.piece.notes.find(x => app.selected.has(x.id)); if (n) app.player.sample(n.p, 0.3); }
  return true;
}

function zoom(by) { app.line.zoom(by, SIDE + ($('roll').clientWidth - SIDE) / 2); wantDraw(); }

function wire() {
  for (const [key, t] of Object.entries(TUNINGS)) $('tuning').add(new Option(t.name, key));
  $('version').textContent = VERSION;

  $('pickSound').onchange = e => { const f = e.target.files[0]; e.target.value = ''; openAny(f); };
  $('pickProject').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); };
  $('addSound').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    app.sound = { blob: f, name: f.name };
    app.player.setSound(f);
    $('mixBox').hidden = false;
    $('addSoundBox').hidden = true;
    if (app.piece.id != null) store.putSound(app.piece.id, f, f.name);
  };
  $('startRecord').onclick = startRecording;
  $('stopRecord').onclick = () => stopRecording(true);
  $('cancelRecord').onclick = () => stopRecording(false);
  $('toHome').onclick = showHome;
  $('help').onclick = () => $('helpBox').showModal();
  $('about').onclick = () => $('aboutBox').showModal();
  for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();

  $('name').onchange = () => { app.piece.name = $('name').value.trim() || 'Untitled'; $('name').value = app.piece.name; saveSoon(); };
  $('saveFile').onclick = saveProjectFile;
  $('saveMidi').onclick = () => download(midiFile(app.piece.shown, app.piece.name), fileName() + '.mid', 'audio/midi');
  $('saveTabs').onclick = () => {
    const shown = app.piece.shown;
    download(tabText(shown, shown.map(n => app.placed.get(n.id) || null), app.piece.settings, app.piece.name), fileName() + ' (tabs).txt', 'text/plain;charset=utf-8');
  };

  $('play').onclick = () => app.player.toggle();
  $('speed').onchange = () => { app.player.setSpeed(Number($('speed').value)); changeSetting('speed', Number($('speed').value), false); };
  $('mix').oninput = () => { app.player.setMix(Number($('mix').value)); changeSetting('mix', Number($('mix').value), false); };
  $('voice').onchange = () => { app.player.voice = $('voice').value; changeSetting('voice', $('voice').value, false); app.player.requeue(); };
  $('clearLoop').onclick = () => app.loop(null);
  $('zoomIn').onclick = () => zoom(1.25);
  $('zoomOut').onclick = () => zoom(0.8);

  $('undo').onclick = () => app.piece.undo();
  $('redo').onclick = () => app.piece.redo();
  $('delete').onclick = () => app.piece.remove([...app.selected]);
  $('least').oninput = () => changeSetting('least', Number($('least').value));
  $('tuning').onchange = () => changeSetting('tuning', $('tuning').value);
  $('capo').onchange = () => { $('capo').value = setup({ capo: Number($('capo').value) }).capo; changeSetting('capo', Number($('capo').value)); };
  $('highest').onchange = () => { $('highest').value = setup({ highest: Number($('highest').value) }).highest; changeSetting('highest', Number($('highest').value)); };
  $('stringUp').onclick = () => moveString(1);
  $('stringDown').onclick = () => moveString(-1);

  app.player.onTick = t => {
    showTime();
    $('play').textContent = app.player.playing ? '❚❚ Pause' : '▶ Play';
    // Keep the moment being played in view.
    const w = $('roll').clientWidth, x = app.line.x(t);
    if (app.player.playing && (x > w - 60 || x < SIDE)) app.line.t0 = Math.max(0, t - ((w - SIDE) * 0.12) / app.line.pps);
    else if (!app.player.playing && (x > w || x < SIDE)) app.line.t0 = Math.max(0, t - ((w - SIDE) * 0.3) / app.line.pps);
    wantDraw();
  };
  app.player.onEnd = () => { $('play').textContent = '▶ Play'; };

  addEventListener('keydown', e => {
    if ($('editor').hidden || document.querySelector('dialog[open]')) return;
    const typing = e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number' || !e.target.type) || e.target instanceof HTMLSelectElement;
    if (typing && e.code !== 'Escape') return;
    const ctrl = e.ctrlKey || e.metaKey;
    let done = true;
    if (e.code === 'Space') app.player.toggle();
    else if (e.code === 'Delete' || e.code === 'Backspace') app.piece.remove([...app.selected]);
    else if (ctrl && e.code === 'KeyZ' && !e.shiftKey) app.piece.undo();
    else if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) app.piece.redo();
    else if (ctrl && e.code === 'KeyA') app.select(app.piece.shown.map(n => n.id), false);
    else if (e.code === 'Escape') { if (app.selected.size) app.select([], false); else app.loop(null); if (typing) e.target.blur(); }
    else if (e.code === 'ArrowUp') done = nudge(0, e.shiftKey ? 12 : 1);
    else if (e.code === 'ArrowDown') done = nudge(0, e.shiftKey ? -12 : -1);
    else if (e.code === 'ArrowLeft') { if (!nudge(e.shiftKey ? -0.1 : -0.02, 0)) app.seek(app.player.time - (e.shiftKey ? 5 : 1)); }
    else if (e.code === 'ArrowRight') { if (!nudge(e.shiftKey ? 0.1 : 0.02, 0)) app.seek(app.player.time + (e.shiftKey ? 5 : 1)); }
    else if (e.code === 'Home') app.seek(0);
    else if (e.code === 'BracketRight') moveString(1);
    else if (e.code === 'BracketLeft') moveString(-1);
    else if (e.key === '+' || e.key === '=') zoom(1.25);
    else if (e.key === '-') zoom(0.8);
    else done = false;
    if (done) e.preventDefault();
  });

  // Dropping a file anywhere.
  addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop'); });
  addEventListener('dragleave', () => document.body.classList.remove('drop'));
  addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drop'); if ($('busy').hidden && $('record').hidden) openAny(e.dataTransfer.files[0]); });

  // Leaving: what's on the screen is saved first.
  addEventListener('pagehide', () => { if (!$('editor').hidden) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !$('editor').hidden) saveNow(); });
}

wire();
showHome();

if ('serviceWorker' in navigator && !testing && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (testing) {
  // For the browser test: the app's insides, and a way in for sound made by the test.
  window.__views = { roll, tabs };
  window.kudutunes = {
    app, store, DEFAULTS, RATE,
    listen: (samples, name = 'Test') => listenTo(samples, samples.length / RATE, name, null),
    openSound, openProject, saveNow, showHome,
    state: () => ({ screen: screens.find(s => !$(s).hidden), notes: app.piece.notes.length, shown: app.piece.shown.length, placed: app.placed.size, selected: app.selected.size, time: app.player.time, playing: app.player.playing, id: app.piece.id })
  };
}
