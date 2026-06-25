#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function buildPlugin() {
  console.log('Building markdown-notes plugin with esbuild...');

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  await build({
    entryPoints: [path.join(SRC_DIR, 'plugin.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    globalName: 'MarkdownNotesPlugin',
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  await build({
    entryPoints: [path.join(SRC_DIR, 'ui', 'app.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'app.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  const appJs = fs
    .readFileSync(path.join(DIST_DIR, 'app.js'), 'utf8')
    .replace(/<\/script>/gi, '<\\/script>');
  const rawHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'index.html'), 'utf8');
  const inlinedHtml = rawHtml.replace(
    /<script src="app\.js"><\/script>/,
    () => `<script>${appJs}</script>`,
  );

  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), inlinedHtml);
  fs.copyFileSync(
    path.join(SRC_DIR, 'manifest.json'),
    path.join(DIST_DIR, 'manifest.json'),
  );
  fs.copyFileSync(path.join(SRC_DIR, 'icon.svg'), path.join(DIST_DIR, 'icon.svg'));

  console.log('\nBuild complete! Output in dist/');
}

buildPlugin().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
