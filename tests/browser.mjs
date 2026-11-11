// Uses the real app in a browser (Chromium through Playwright): listens to made-up tunes whose notes are known,
// then plays, corrects, saves and exports them. Fails on any error in the page. Pictures go to screenshots/.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serve } from '../tools/serve.mjs';
import { MELODY, CHORDS, PICKING, render, strike, pluck, compare, RATE } from './tunes.js';
import { readMidi } from '../src/midi.js';
import { unpack } from '../src/project.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const PORT = 8097, URL_ = `http://localhost:${PORT}/?test`;
const server = await serve(PORT);
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  // The last two give the test a pretend microphone (it beeps) and answer "allow" to the browser's question.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const errors = [];
const watch = page => {
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
};
const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  const t = Date.now();
  await fn();
  assert.deepEqual(errors, [], 'no errors in the page');
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(0)} s)`);
};
const shot = (page, name) => page.screenshot({ path: out + name + '.png' });

/** Sound as a WAV file, the way a person would have it. */
function wav(samples, rate = RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}
const files = new URL('../screenshots/files/', import.meta.url).pathname;
mkdirSync(files, { recursive: true });
writeFileSync(files + 'Twinkle piano.wav', wav(render(MELODY, strike)));
writeFileSync(files + 'Picking guitar.wav', wav(render(PICKING, pluck)));
writeFileSync(files + 'Chords piano.wav', wav(render(CHORDS, strike)));

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 800 }, acceptDownloads: true });
  watch(page);
  const state = () => page.evaluate(() => kudutunes.state());
  const shown = () => page.evaluate(() => kudutunes.app.piece.shown.map(n => ({ t: n.t, d: n.d, p: n.p, id: n.id })));
  const inEditor = () => page.waitForFunction(() => kudutunes.state().screen === 'editor', null, { timeout: 600000 });
  /** Opens a sound file and waits for the new piece (not the one already on the screen). */
  const open = async file => {
    const was = (await state()).id;
    await page.setInputFiles('#pickSound', files + file);
    await page.waitForFunction(was => { const s = kudutunes.state(); return s.screen === 'editor' && s.id !== was; }, was, { timeout: 600000 });
    await page.waitForTimeout(300);
  };
  /** Where a note is on the page (the middle of its bar in the piano roll). */
  const barOf = id => page.evaluate(id => {
    const { roll } = window.__views, b = roll.boxes.find(x => x.id === id), r = document.getElementById('roll').getBoundingClientRect();
    return b ? { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2, right: r.left + b.x + b.w - 3, w: b.w, row: roll.row } : null;
  }, id);

  await step('the app opens on its first screen', async () => {
    await page.goto(URL_);
    await page.waitForFunction(() => window.kudutunes);
    assert.equal((await state()).screen, 'home');
    assert.ok(await page.isVisible('text=Open a sound file'));
    assert.ok(!(await page.isVisible('#saved')), 'no pieces yet');
    await shot(page, '01-home');
  });

  await step('a piano tune from a sound file: every note found, none made up', async () => {
    await open('Twinkle piano.wav');
    const got = await shown(), c = compare(MELODY, got);
    assert.equal(c.found, 1, `found ${got.length} notes, ${Math.round(c.found * 100)}% of the real ones`);
    assert.equal(c.right, 1, 'no extra notes');
    assert.equal(await page.inputValue('#name'), 'Twinkle piano');
    const s = await state();
    assert.equal(s.placed, s.shown, 'every note has a place on the guitar');
    assert.ok(s.id != null, 'saved in the browser');
    await shot(page, '02-piano-tune');
  });

  await step('playing: the notes and the recording together, slower, a repeated part, a jump', async () => {
    assert.ok(await page.isVisible('#mixBox'), 'the recording is there to mix in');
    await page.click('#play');
    await page.waitForFunction(() => kudutunes.state().time > 1.2, null, { timeout: 60000 });
    assert.ok((await state()).playing);
    assert.ok(await page.evaluate(() => kudutunes.app.player.synth.playing.size > 0 || kudutunes.app.player.queuedTo > 1), 'notes were handed to the sound system');
    await shot(page, '03-playing');
    await page.keyboard.press('Space');
    assert.equal((await state()).playing, false);

    await page.selectOption('#speed', '0.5');
    assert.equal(await page.evaluate(() => kudutunes.app.player.sound.playbackRate), 0.5);
    assert.equal(await page.evaluate(() => kudutunes.app.player.sound.preservesPitch), true, 'slower without changing the pitch');
    await page.fill('#mix', '1');
    assert.equal(await page.evaluate(() => kudutunes.app.player.sound.volume), 0, 'all the way to Notes: the recording is silent');
    await page.fill('#mix', '0.5');

    // Drag along the ruler: repeat from about 1 s to 2 s.
    const r = await page.evaluate(() => { const b = document.getElementById('roll').getBoundingClientRect(), l = kudutunes.app.line; return { y: b.top + 10, a: b.left + l.x(1), b: b.left + l.x(2) }; });
    await page.mouse.move(r.a, r.y); await page.mouse.down(); await page.mouse.move(r.b, r.y, { steps: 5 }); await page.mouse.up();
    const loop = await page.evaluate(() => kudutunes.app.player.loop);
    assert.ok(loop && Math.abs(loop.from - 1) < 0.05 && Math.abs(loop.to - 2) < 0.05, 'a part chosen to repeat');
    await page.selectOption('#speed', '1.25');
    await page.click('#play');
    await page.waitForTimeout(2500);
    const t = (await state()).time;
    assert.ok(t >= 0.95 && t <= 2.05, `still inside the repeated part after going round (${t.toFixed(2)})`);
    await page.click('#play');
    await page.click('#clearLoop');
    assert.equal(await page.evaluate(() => kudutunes.app.player.loop), null);
    await page.selectOption('#speed', '1');
    // A click on the ruler jumps there.
    const j = await page.evaluate(() => { const b = document.getElementById('roll').getBoundingClientRect(); return { x: b.left + kudutunes.app.line.x(4), y: b.top + 10 }; });
    await page.mouse.click(j.x, j.y);
    assert.ok(Math.abs((await state()).time - 4) < 0.05, 'jumped to 4 seconds');
    await page.selectOption('#voice', 'guitar');
    assert.equal(await page.evaluate(() => kudutunes.app.player.voice), 'guitar');
    await page.keyboard.press('Home');
  });

  await step('correcting: choose, move, stretch, delete, add, undo and redo', async () => {
    const before = await shown(), first = before[0];
    let b = await barOf(first.id);
    await page.mouse.click(b.x, b.y);
    assert.equal((await state()).selected, 1);
    assert.match(await page.textContent('#status'), /C4.*guitar: string 2, fret 1/);

    // Drag it up two rows and a little to the right.
    await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 30, b.y - b.row * 2, { steps: 6 }); await page.mouse.up();
    let now = (await shown()).find(n => n.id === first.id);
    assert.equal(now.p, first.p + 2, 'two notes higher');
    assert.ok(now.t > first.t + 0.1, 'and later');

    // Its right end, dragged: longer.
    b = await barOf(first.id);
    await page.mouse.move(b.right, b.y); await page.mouse.down(); await page.mouse.move(b.right + 40, b.y, { steps: 5 }); await page.mouse.up();
    const longer = (await shown()).find(n => n.id === first.id);
    assert.ok(longer.d > now.d + 0.15, 'longer');

    await page.keyboard.press('ArrowDown');
    assert.equal((await shown()).find(n => n.id === first.id).p, first.p + 1, 'the arrow key moves it a note');
    await page.keyboard.press('Delete');
    assert.equal((await shown()).length, before.length - 1);

    // A double click on an empty place adds a note.
    const spot = await page.evaluate(() => { const b = document.getElementById('roll').getBoundingClientRect(), { roll } = window.__views; return { x: b.left + kudutunes.app.line.x(8.5), y: b.top + roll.y(64) + roll.row / 2 }; });
    await page.mouse.dblclick(spot.x, spot.y);
    const added = (await shown()).find(n => Math.abs(n.t - 8.5) < 0.05);
    assert.ok(added && added.p === 64, 'a note added where it was double-clicked');

    // Undo everything, then redo it.
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
    assert.deepEqual((await shown()).map(n => [n.t, n.d, n.p]), before.map(n => [n.t, n.d, n.p]), 'undo brings it all back');
    assert.ok(await page.isDisabled('#undo'));
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+y');
    assert.equal((await shown()).length, before.length);
    for (let i = 0; i < 5; i++) await page.click('#undo');

    // A box dragged round several notes chooses them.
    const box = await page.evaluate(() => { const b = document.getElementById('roll').getBoundingClientRect(), l = kudutunes.app.line; return { x0: b.left + l.x(0.1), x1: b.left + l.x(2.2), y0: b.top + 40, y1: b.bottom - 10 }; });
    await page.mouse.move(box.x0, box.y0); await page.mouse.down(); await page.mouse.move(box.x1, box.y1, { steps: 5 }); await page.mouse.up();
    assert.equal((await state()).selected, 4, 'the first four notes chosen with a box');
    await page.keyboard.press('Escape');
    assert.equal((await state()).selected, 0);
    await shot(page, '04-corrected');
  });

  await step('guitar picking: found, and written as the tabs a guitarist would play', async () => {
    await open('Picking guitar.wav');
    const got = await shown(), c = compare(PICKING, got);
    assert.ok(c.found >= 0.9, `${Math.round(c.found * 100)}% of the real notes found`);
    assert.ok(c.right >= 0.75, `${Math.round(c.right * 100)}% of the notes shown are real`);
    const first = await page.evaluate(() => { const a = kudutunes.app, n = a.piece.shown[0]; return { p: n.p, place: a.placed.get(n.id) }; });
    assert.deepEqual(first, { p: 40, place: { string: 0, fret: 0 } }, 'the low E is the open sixth string');
    await shot(page, '05-guitar-picking');
  });

  await step('the faint-notes slider, tunings, the capo and moving a note to another string', async () => {
    const usual = (await state()).shown;
    await page.fill('#least', '0.2');
    const all = (await state()).shown;
    assert.ok(all > usual, `moved left, more notes show (${usual} to ${all})`);
    assert.match(await page.textContent('#count'), new RegExp(`^${all} of \\d+ notes$`));
    await page.fill('#least', '0.95');
    assert.ok((await state()).shown < usual, 'moved right, fewer');
    await page.fill('#least', '0.7');
    assert.equal((await state()).shown, usual);

    // A capo on fret 2: the low E can't be played any more, and says so.
    await page.fill('#capo', '2'); await page.press('#capo', 'Tab');
    assert.ok((await state()).placed < (await state()).shown);
    assert.match(await page.textContent('#tabNote'), /outside what the guitar can play/);
    await page.fill('#capo', '0'); await page.press('#capo', 'Tab');
    await page.selectOption('#tuning', 'dropD');
    assert.deepEqual(await page.evaluate(() => { const a = kudutunes.app, n = a.piece.shown[0]; return a.placed.get(n.id); }), { string: 0, fret: 2 }, 'in Drop D the low E is the second fret');
    await page.selectOption('#tuning', 'standard');

    // The open B string (59): played on the G string instead, fret 4.
    const b = await page.evaluate(() => kudutunes.app.piece.shown.find(n => n.p === 59).id);
    const bar = await barOf(b);
    await page.mouse.click(bar.x, bar.y);
    assert.deepEqual(await page.evaluate(id => kudutunes.app.placed.get(id), b), { string: 4, fret: 0 });
    await page.click('#stringDown');
    assert.deepEqual(await page.evaluate(id => kudutunes.app.placed.get(id), b), { string: 3, fret: 4 });
    await page.keyboard.press(']');
    assert.deepEqual(await page.evaluate(id => kudutunes.app.placed.get(id), b), { string: 4, fret: 0 });
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  });

  let project;
  await step('files out: MIDI, tabs as text and a project file with the recording inside', async () => {
    const want = await shown();
    const save = async button => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(button)]); const path = out + 'files/' + d.suggestedFilename(); await d.saveAs(path); return path; };
    const midi = await save('#saveMidi');
    assert.ok(midi.endsWith('Picking guitar.mid'));
    const back = readMidi(new Uint8Array(readFileSync(midi)));
    assert.deepEqual(back.map(n => n.p), want.map(n => n.p), 'the MIDI file has the notes shown');
    const tabs = readFileSync(await save('#saveTabs'), 'utf8');
    assert.ok(tabs.includes('Picking guitar') && /^E \|-0/m.test(tabs) && tabs.split('\n').filter(l => /^[A-G] \|/.test(l)).length % 6 === 0, tabs);
    project = await save('#saveFile');
    const p = unpack(new Uint8Array(readFileSync(project)));
    assert.equal(p.name, 'Picking guitar');
    assert.ok(p.sound && p.sound.bytes.length > 100000, 'the recording is inside');
    assert.equal(p.notes.length, (await state()).notes);
  });

  await step('pieces are kept: both are listed, one opens again with its recording, one is deleted', async () => {
    await page.fill('#name', 'My picking'); await page.press('#name', 'Enter');
    await page.click('#toHome');
    await page.waitForSelector('.piece');
    const names = await page.$$eval('.piece b', els => els.map(e => e.textContent));
    assert.deepEqual(names.sort(), ['My picking', 'Twinkle piano']);
    await shot(page, '06-pieces');
    await page.reload();
    await page.waitForFunction(() => window.kudutunes);
    await page.waitForSelector('.piece');
    await page.click('.piece:has-text("My picking") button.main');
    await inEditor();
    assert.ok(await page.isVisible('#mixBox'), 'its recording came back too');
    assert.ok((await state()).shown >= 14);
    await page.click('#toHome');
    await page.click('.piece:has-text("Twinkle piano") button:has-text("Delete")');
    await page.click('#askYes');
    await page.waitForFunction(() => document.querySelectorAll('.piece').length === 1);
  });

  await step('a project file opens as it was saved; a file that is not one is refused politely', async () => {
    await page.setInputFiles('#pickProject', project);
    await inEditor();
    await page.waitForFunction(() => document.getElementById('name').value === 'Picking guitar');
    assert.equal(await page.inputValue('#name'), 'Picking guitar');
    assert.ok(await page.isVisible('#mixBox'));
    await page.click('#toHome');
    await page.setInputFiles('#pickProject', { name: 'wrong.kudutunes', mimeType: 'application/octet-stream', buffer: Buffer.from('not a project') });
    await page.waitForSelector('#toast.show');
    assert.match(await page.textContent('#toast'), /isn't a KUDUTUNES project file/);
    assert.equal((await state()).screen, 'home');
    await page.setInputFiles('#pickSound', { name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is not sound at all') });
    await page.waitForFunction(() => /couldn't be read/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
    assert.equal((await state()).screen, 'home');
  });

  await step('piano chords with a tune on top: nearly all found, few made up', async () => {
    await open('Chords piano.wav');
    const got = await shown(), c = compare(CHORDS, got);
    assert.ok(c.found >= 0.9, `${Math.round(c.found * 100)}% of the real notes found`);
    assert.ok(c.right >= 0.85, `${Math.round(c.right * 100)}% of the notes shown are real`);
    console.log(`\n  (chords: ${Math.round(c.found * 100)}% found, ${Math.round(c.right * 100)}% right, of ${CHORDS.length})`);
    await shot(page, '07-piano-chords');
  });

  await step('recording with the microphone: it records, listens and opens the result with its recording', async () => {
    await page.click('#toHome');
    await page.click('#startRecord');
    await page.waitForFunction(() => kudutunes.state().screen === 'record', null, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('clock').textContent >= '0:03', null, { timeout: 30000 });
    assert.ok(await page.evaluate(() => parseFloat(document.querySelector('#level i').style.width) >= 0), 'the level shows');
    await shot(page, '07b-recording');
    const was = (await state()).id;
    await page.click('#stopRecord');
    await page.waitForFunction(was => { const s = kudutunes.state(); return s.screen === 'editor' && s.id !== was; }, was, { timeout: 600000 });
    assert.match(await page.inputValue('#name'), /^Recording /);
    assert.ok(await page.isVisible('#mixBox'), 'the recording can be played along');
    assert.ok(await page.evaluate(() => kudutunes.app.piece.duration) >= 2.5, 'about three seconds were recorded');
    // Cancelling a recording goes back without making a piece.
    await page.click('#toHome');
    await page.waitForSelector('.piece:has-text("Recording ")');
    const count = await page.$$eval('.piece', e => e.length);
    await page.click('#startRecord');
    await page.waitForFunction(() => kudutunes.state().screen === 'record');
    await page.click('#cancelRecord');
    await page.waitForFunction(() => kudutunes.state().screen === 'home');
    await page.waitForTimeout(300);
    assert.equal(await page.$$eval('.piece', e => e.length), count);
    await page.click('.piece button.main');
    await inEditor();
  });

  await step('Help and About, with the credit line', async () => {
    await page.click('#help');
    assert.ok(await page.isVisible('text=How to use KUDUTUNES'));
    await shot(page, '08-help');
    await page.click('#helpBox [data-close]');
    await page.click('#about');
    assert.ok(await page.isVisible('text=Made by Azeem, with Claude and'));
    assert.ok(await page.isVisible('#aboutBox >> text=never sent anywhere'));
    await page.click('#aboutBox [data-close]');
  });
  await page.close();

  const dark = await browser.newPage({ viewport: { width: 1360, height: 800 }, colorScheme: 'dark' });
  watch(dark);
  await step('the dark look, with a piece from a project file', async () => {
    await dark.goto(URL_);
    await dark.waitForFunction(() => window.kudutunes);
    await dark.setInputFiles('#pickProject', project);
    await dark.waitForFunction(() => kudutunes.state().screen === 'editor');
    await dark.waitForTimeout(400);
    await shot(dark, '09-dark');
  });
  await dark.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  watch(phone);
  await step('on a phone: it opens, shows a piece and plays', async () => {
    await phone.goto(URL_);
    await phone.waitForFunction(() => window.kudutunes);
    await shot(phone, '10-phone-home');
    await phone.setInputFiles('#pickProject', project);
    await phone.waitForFunction(() => kudutunes.state().screen === 'editor');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing hangs off the side');
    await phone.tap('#play');
    await phone.waitForFunction(() => kudutunes.state().time > 0.5, null, { timeout: 60000 });
    await shot(phone, '11-phone-piece');
    await phone.tap('#play');
  });
  console.log('All good.');
} finally {
  await browser.close();
  server.close();
}
