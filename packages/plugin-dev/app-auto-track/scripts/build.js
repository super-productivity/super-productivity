#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function buildPlugin() {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  await build({
    entryPoints: [path.join(SRC_DIR, 'background.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  for (const file of ['manifest.json', 'config-schema.json', 'icon.svg']) {
    fs.copyFileSync(path.join(SRC_DIR, file), path.join(DIST_DIR, file));
  }
  fs.cpSync(path.join(SRC_DIR, 'i18n'), path.join(DIST_DIR, 'i18n'), { recursive: true });

  console.log('Build complete! Output in dist/');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
