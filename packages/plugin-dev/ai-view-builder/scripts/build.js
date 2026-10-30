#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function buildPlugin() {
  console.log('Building ai-view-builder plugin with esbuild...');

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  // Background script — runs in the host page context, registers UI + hooks.
  console.log('Building plugin.js (background)...');
  await build({
    entryPoints: [path.join(SRC_DIR, 'background.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    globalName: 'AiViewBuilderPlugin',
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  // UI bundle — runs inside the iframe.
  console.log('Building app.js (iframe)...');
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

  // The iframe is loaded via blob URL, so relative <script src="editor.js">
  // does not resolve. Inline the bundle into index.html instead.
  const appJs = fs.readFileSync(path.join(DIST_DIR, 'app.js'), 'utf8');
  const rawHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'index.html'), 'utf8');
  // Function-form replacement so `$&`, ``$`` ``, etc. in the bundle aren't
  // interpreted as replace() back-references. Also escape any literal
  // `</script>` inside the JS so the HTML parser doesn't close the tag early.
  const safeAppJs = appJs.replace(/<\/script>/gi, '<\\/script>');
  const viewCss = fs.readFileSync(path.join(SRC_DIR, 'ui', 'view.css'), 'utf8');
  const inlinedHtml = rawHtml
    .replace(
      /<link\s+rel="stylesheet"\s+href="view\.css"\s*\/>/,
      () => `<style>${viewCss}</style>`,
    )
    .replace(/<script src="app\.js"><\/script>/, () => `<script>${safeAppJs}</script>`);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), inlinedHtml);
  fs.copyFileSync(
    path.join(SRC_DIR, 'manifest.json'),
    path.join(DIST_DIR, 'manifest.json'),
  );
  fs.copyFileSync(path.join(SRC_DIR, 'icon.svg'), path.join(DIST_DIR, 'icon.svg'));

  console.log('\nBuild complete! Output in dist/');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
