// Writes the list of files the app needs into sw.js, so it works without the internet:  node tools/list_files.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
export const appFiles = () => ['./', 'index.html', 'manifest.webmanifest', 'THIRD-PARTY-NOTICES.txt',
  ...['src', 'vendor', 'assets'].flatMap(d => walk(join(root, d)).map(p => relative(root, p).split('\\').join('/')))
].filter(f => !/LICENSE/.test(f)).sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(root, 'sw.js'), text = readFileSync(path, 'utf8');
  const list = appFiles().map(f => `  '${f}'`).join(',\n');
  writeFileSync(path, text.replace(/const FILES = \[[\s\S]*?\];/, `const FILES = [\n${list}\n];`));
  console.log(`${appFiles().length} files listed`);
}
