#!/usr/bin/env node

'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const httpServer = require('http-server');

const PORT = 4243;
const DIST_ROOT = path.resolve(process.cwd(), 'dist/browser');
const INDEX_PATH = path.join(DIST_ROOT, 'index.html');
const NGSW_MANIFEST_PATH = path.join(DIST_ROOT, 'ngsw.json');
const VERSION_MARKER = '    <meta content="v2" name="pwa-e2e-version">\n';

const version1Html = readFileSync(INDEX_PATH, 'utf8');
const version1Manifest = JSON.parse(readFileSync(NGSW_MANIFEST_PATH, 'utf8'));
const version1ManifestBody = Buffer.from(JSON.stringify(version1Manifest));

if (!version1Html.includes('</head>')) {
  throw new Error(`Unable to add the PWA E2E version marker to ${INDEX_PATH}`);
}

const version2Index = Buffer.from(
  version1Html.replace('</head>', `${VERSION_MARKER}</head>`),
);
const version2Manifest = JSON.parse(JSON.stringify(version1Manifest));

if (typeof version2Manifest.hashTable?.['/index.html'] !== 'string') {
  throw new Error(`Missing /index.html hash in ${NGSW_MANIFEST_PATH}`);
}

version2Manifest.timestamp = version1Manifest.timestamp + 1;
version2Manifest.hashTable['/index.html'] = createHash('sha1')
  .update(version2Index)
  .digest('hex');
const version2ManifestBody = Buffer.from(JSON.stringify(version2Manifest));

// Installs from before #10715 registered ngsw-worker.js directly. The
// "legacy" version serves this build with only that registration changed, so a
// test can update such an install to the sw.js entry point.
const buildLegacyVersion = () => {
  const mainScript = version1Html.match(/<script src="(main-[^"]+\.js)"/)?.[1];
  if (!mainScript) {
    throw new Error(`Unable to find the main script in ${INDEX_PATH}`);
  }
  let registrations = 0;
  const legacyMain = readFileSync(path.join(DIST_ROOT, mainScript), 'utf8').replace(
    /([`'"])sw\.js\1/g,
    (_match, quote) => {
      registrations += 1;
      return `${quote}ngsw-worker.js${quote}`;
    },
  );
  if (registrations !== 2) {
    throw new Error(
      `Expected 2 sw.js registrations in ${mainScript}, found ${registrations}`,
    );
  }
  const mainBody = Buffer.from(legacyMain);
  const manifest = JSON.parse(JSON.stringify(version1Manifest));
  manifest.hashTable[`/${mainScript}`] = createHash('sha1')
    .update(mainBody)
    .digest('hex');
  return {
    mainPath: `/${mainScript}`,
    mainBody,
    manifestBody: Buffer.from(JSON.stringify(manifest)),
  };
};
let legacyVersion = null;

let activeVersion = 'v1';
let manifestRequestCount = 0;

const sendBuffer = (request, response, contentType, body) => {
  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Length': body.length,
    'Content-Type': contentType,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
};

const interceptVersionedRequests = (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const versionMatch = pathname.match(/^\/__e2e\/pwa\/version\/(v1|v2|legacy)$/);

  if (request.method === 'GET' && pathname === '/__e2e/pwa/manifest-request-count') {
    sendBuffer(
      request,
      response,
      'text/plain; charset=utf-8',
      Buffer.from(String(manifestRequestCount)),
    );
    return;
  }

  if (request.method === 'POST' && versionMatch) {
    if (versionMatch[1] === 'legacy' && !legacyVersion) {
      try {
        legacyVersion = buildLegacyVersion();
      } catch (e) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(String(e));
        return;
      }
    }
    activeVersion = versionMatch[1];
    sendBuffer(
      request,
      response,
      'application/json; charset=utf-8',
      Buffer.from(JSON.stringify({ version: activeVersion })),
    );
    return;
  }

  if (activeVersion === 'v2' && (pathname === '/' || pathname === '/index.html')) {
    sendBuffer(request, response, 'text/html; charset=utf-8', version2Index);
    return;
  }

  if (activeVersion === 'legacy' && pathname === legacyVersion.mainPath) {
    sendBuffer(
      request,
      response,
      'text/javascript; charset=utf-8',
      legacyVersion.mainBody,
    );
    return;
  }

  if (pathname === '/ngsw.json') {
    const manifestBody =
      activeVersion === 'v2'
        ? version2ManifestBody
        : activeVersion === 'legacy'
          ? legacyVersion.manifestBody
          : version1ManifestBody;
    manifestRequestCount += 1;
    sendBuffer(request, response, 'application/json; charset=utf-8', manifestBody);
    return;
  }

  response.emit('next');
};

const server = httpServer.createServer({
  root: DIST_ROOT,
  cache: -1,
  before: [interceptVersionedRequests],
  proxy: `http://localhost:${PORT}?`,
  showDir: 'false',
});

server.listen(PORT, () => {
  console.log(`PWA E2E server listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close());
