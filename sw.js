// Keeps a copy of the app on the device, so it opens without the internet. A new version (VERSION below, the same
// as in package.json and src/main.js) fetches everything afresh.
const VERSION = '1.1.0';
const CACHE = 'kudutunes-' + VERSION;
const FILES = [
  './',
  'THIRD-PARTY-NOTICES.txt',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'index.html',
  'manifest.webmanifest',
  'src/guitar.js',
  'src/listen.js',
  'src/main.js',
  'src/midi.js',
  'src/piece.js',
  'src/player.js',
  'src/project.js',
  'src/store.js',
  'src/synth.js',
  'src/tidy.js',
  'src/view.js',
  'vendor/listen/listen.js',
  'vendor/listen/model/group1-shard1of1.bin',
  'vendor/listen/model/model.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('kudutunes-') || k.startsWith('kudunotes-')) && k !== CACHE) /* kudunotes-: the app's first name */.map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // The kept copy first; the network for anything not kept.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
