// A tiny web server for trying the app and for the browser test:  node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export const RULES = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

export function serve(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) throw new Error('outside');
      const data = await readFile(file);
      // The same safety rules as in deploy/ (what the page may load and from where), so the tests run under them too.
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': RULES, 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8080;
  await serve(port);
  console.log(`KUDUTUNES at http://localhost:${port}/`);
}
