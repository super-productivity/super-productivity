import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export const RELEASED_APP_URL = 'http://127.0.0.1:4249';
export type ClientRelease = 'old' | 'new';

/** Serve unmodified published bundles, switching releases without changing origin. */
export const serveReleasedClientAssets = async (
  directories: Record<ClientRelease, string>,
): Promise<{ close: () => Promise<void> }> => {
  const roots = { old: resolve(directories.old), new: resolve(directories.new) };
  await Promise.all(Object.values(roots).map((root) => readFile(`${root}/index.html`)));
  const mime: Record<string, string> = {
    html: 'text/html',
    js: 'text/javascript',
    css: 'text/css',
    json: 'application/json',
    svg: 'image/svg+xml',
    wasm: 'application/wasm',
    woff2: 'font/woff2',
    png: 'image/png',
    ico: 'image/x-icon',
  };
  const server = createServer(async (request, response) => {
    const root = /(?:^|;\s*)compat-release=old(?:;|$)/.test(request.headers.cookie ?? '')
      ? roots.old
      : roots.new;
    const pathname = new URL(request.url ?? '/', RELEASED_APP_URL).pathname;
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const contents = await readFile(file);
      response.setHeader(
        'Content-Type',
        mime[extname(file).slice(1)] ?? 'application/octet-stream',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.writeHead(200);
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(4249, '127.0.0.1', ready);
  });
  return {
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
};
