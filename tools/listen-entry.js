// What goes into vendor/listen/listen.js: the note-finding engine (Spotify's Basic Pitch) and the maths library it runs on
// (TensorFlow.js), bundled once into one file so the app needs no build step and fetches nothing from other sites.
//
//   mkdir build && cd build && npm init -y
//   npm install @spotify/basic-pitch@1.0.1 esbuild
//   npx esbuild ../tools/listen-entry.js --bundle --format=esm --minify --outfile=../vendor/listen/listen.js
//   cp node_modules/@spotify/basic-pitch/model/* ../vendor/listen/model/
export { BasicPitch } from '@spotify/basic-pitch/esm/inference.js';
export { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi.js';
export * as tf from '@tensorflow/tfjs';
