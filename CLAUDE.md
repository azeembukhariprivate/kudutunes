# KUDUTUNES

Listens to music and writes out its notes for piano and guitar: a free web app. Open a sound file or record, and
get a piano roll and guitar tabs to play back, slow down, correct and save. Everything happens in the browser.
Part of the KUDU family of free, open-source (MIT) apps by Azeem Bukhari.
It was first called KUDUNOTES: the GitHub repository, the server folder (`/var/www/kudunotes`) and the address on
Azeem's server (`azeembukhari.com/kudunotes/`) still carry that name, and so does the browser's store of pieces.

## Working with Azeem (the owner)

- **Branches:** work on `main` and push to `main`. Ask before creating any other branch.
- **New features:** first say what you understood, and ask your doubts and suggestions, one question at a time.
  Only start building when Azeem says "build".
- **Look:** keep the app's current look (the KUDU apps' calm style, light and dark following the device, the rose
  accent). No redesigns unless asked.
- **Credit:** About says "Made by Azeem, with Claude and ♥" (the heart in the accent colour). Keep it.
- **Commits:** author `Azeem Bukhari <12558389+azeembukhariprivate@users.noreply.github.com>`. Clear messages that say
  what changed and why. Don't put AI model names or versions in commits, code or docs.
- **Words:** the app's text, README and notes use plain everyday words, not technical jargon.
- **Before pushing:** run the tests locally, and re-read the diff. After pushing, watch the GitHub Actions
  build until it's green; fix failures, never skip or disable a test to get green.

## What was agreed for version 1

- Recordings of one or two instruments (not full songs with singing and drums). With two instruments all the notes
  are shown together; the app doesn't say who played what.
- In: a sound file or the microphone (record, then listen). Not live, and not from YouTube or Spotify links.
- Shown as a piano roll with a keyboard, and guitar tabs. No sheet music, no fretboard picture.
- Playback: the notes, the recording, or both; slower without changing pitch; repeat a part; jump anywhere.
- Correcting: delete, add, move, lengthen, another guitar string, undo/redo, and the "Faint notes" slider.
- Kept in the browser; a project file; MIDI; tabs as text. No printing or PDF.
- Made for a computer first; a phone can open, record, show and play.
- Guitar: standard, Drop D, half a step down, open G, DADGAD; a capo; the highest fret. No bass or ukulele.
- Installed on Azeem's own server (INSTALL.md); nothing is published from GitHub.

Ideas left for later: sheet music, a split between two instruments (a dividing line you set), tidying timing to a
beat, moving to another key, live listening, printing.

## How the app is built

- Plain JavaScript modules in `src/`, no build step. One page (`index.html`, its styles inside it).
- **Listening** (`src/listen.js`): Spotify's Basic Pitch on TensorFlow.js, bundled once into
  `vendor/listen/listen.js` with its model beside it (`tools/listen-entry.js` says how). It runs on the graphics card
  (WebGL), else slowly on the processor. Notes are found generously, each with `a` (how loud) and `o` (how clearly it
  began).
- **Tidying** (`src/tidy.js`): gives each note a sureness `s`: `o`, lowered for overtones of a louder note, echoes and
  blips. The slider (`settings.least`, usually 0.7) hides notes below it; nothing is thrown away. Notes changed or
  added by hand get `s = 1`.
- **A piece** (`src/piece.js`): the notes `{ t, d, p, a, o, s, g?, hand? }` (start and length in seconds, MIDI pitch,
  `g` a guitar string chosen by hand), settings, and undo (whole copies of the notes, 200 deep).
- **Guitar** (`src/guitar.js`): tunings, `places` (every string and fret for a pitch), `arrange` (the best few ways
  to play each chord, then the path through the piece that moves the hand least), `tabText`.
- **Pictures** (`src/view.js`): `Roll` and `Tabs` draw on canvases sharing one `TimeLine`; the roll handles the
  mouse (choose, drag, stretch, box, ruler for jumping and repeating).
- **Playback** (`src/player.js`, `src/synth.js`): the recording plays in an `<audio>` element (the browser keeps its
  pitch when slowed) and is the clock; the notes are made in code (a struck string and a plucked string, worked out
  once per pitch) and handed to WebAudio a moment ahead.
- **Keeping** (`src/store.js`): IndexedDB `kudunotes` (the app's first name, kept so
  earlier pieces stay): `pieces` and `sounds` (recordings up to 80 MB). `src/project.js` is the `.kudutunes` file (it
  also opens `.kudunotes` files saved before the rename); `src/midi.js` writes MIDI.
- `src/main.js`: the screens, buttons and keys. `?test` adds `window.kudutunes` for the browser test.
- Works offline: `sw.js` lists every file (`node tools/list_files.mjs` writes the list); its `VERSION` must match
  `package.json` and `src/main.js` (a test checks).
- Nothing is sent anywhere, and nothing is loaded from other sites (a test checks). `tools/serve.mjs` and `deploy/`
  send the same safety rules (Content-Security-Policy); a test checks they match.

```
npm test               # tidying, the guitar, MIDI, project files, editing, the files
npm run test:browser   # the real app in Chromium: listens to made-up tunes, plays, corrects, saves, records
npm run serve          # http://localhost:8080/
```

## Testing the listening

`tests/tunes.js` makes tunes whose notes are known, in a struck-string and a plucked-string sound made in code. The
browser test listens to them and counts notes found and notes made up (a single-line tune must be exact; chords and
picking nearly so). These are not real instruments: before changing `tidy.js` or the thresholds in `listen.js`, try
real recordings too, and don't tune only to the made-up sounds.

## Releasing

1. Raise `version` in `package.json`, `VERSION` in `sw.js` and in `src/main.js`.
2. Run `node tools/list_files.mjs` if files were added or removed.
3. Commit and push to `main`; GitHub Actions tests it.
4. On the server: `cd /var/www/kudunotes && sudo git pull` (INSTALL.md).
