// The files: the offline copy lists everything, the version is the same everywhere, nothing is fetched from other
// sites, and the makers of what we use are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { appFiles } from '../tools/list_files.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('one version everywhere', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.match(read('sw.js'), new RegExp(`const VERSION = '${v}'`));
  assert.match(read('src/main.js'), new RegExp(`export const VERSION = '${v}'`));
});

test('the offline copy lists every file the app needs, and only files that exist', () => {
  const listed = [...read('sw.js').match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(listed, appFiles(), 'run: node tools/list_files.mjs');
  for (const f of listed) if (f !== './') assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
  for (const f of ['src/main.js', 'vendor/listen/listen.js', 'vendor/listen/model/model.json', 'vendor/listen/model/group1-shard1of1.bin', 'index.html']) assert.ok(listed.includes(f), f);
});

test("the app's own pages and code fetch nothing from other sites", () => {
  const own = ['index.html', 'sw.js', ...readdirSync(new URL('../src/', import.meta.url)).map(f => 'src/' + f)];
  for (const f of own) {
    const text = read(f).replace(/<a href="https?:[^"]*"/g, ''); // links a person may click are fine
    assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(text), `${f}: nothing loaded from another site`);
    assert.ok(!/fetch\(\s*["'`]https?:/.test(text) && !/XMLHttpRequest|sendBeacon|WebSocket/.test(text), `${f}: nothing sent anywhere`);
  }
});

test('the credit, the licences and the makers are there', () => {
  assert.match(read('index.html'), /Made by Azeem, with Claude and <span class="heart"/);
  const notices = read('THIRD-PARTY-NOTICES.txt');
  assert.ok(notices.includes('Basic Pitch') && notices.includes('TensorFlow.js') && notices.includes('Apache License 2.0'));
  for (const f of ['LICENSE', 'vendor/listen/LICENSE-Apache-2.0.txt']) assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
});

test('the server set-ups in deploy/ use the safety rules the tests run under', async () => {
  const { RULES } = await import('../tools/serve.mjs');
  assert.ok(read('deploy/Caddyfile').includes(RULES), 'Caddyfile');
  assert.ok(read('deploy/nginx.conf').includes(RULES), 'nginx.conf');
});
