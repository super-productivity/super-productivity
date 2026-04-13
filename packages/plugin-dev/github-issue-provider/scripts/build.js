#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const I18N_SRC = path.join(ROOT_DIR, 'i18n');
const I18N_DIST = path.join(DIST_DIR, 'i18n');

async function buildPlugin() {
  console.log('Building github-issue-provider...');

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  // Build TypeScript to IIFE bundle
  await build({
    entryPoints: [path.join(SRC_DIR, 'plugin.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  // Copy manifest.json
  fs.copyFileSync(path.join(SRC_DIR, 'manifest.json'), path.join(DIST_DIR, 'manifest.json'));

  // Copy icon.svg if present
  const iconSrc = path.join(ROOT_DIR, 'icon.svg');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(DIST_DIR, 'icon.svg'));
    console.log('Copied icon.svg');
  }

  // Copy i18n files
  if (fs.existsSync(I18N_SRC)) {
    fs.mkdirSync(I18N_DIST, { recursive: true });
    for (const file of fs.readdirSync(I18N_SRC)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(I18N_SRC, file), path.join(I18N_DIST, file));
      }
    }
    console.log('Copied i18n files');
  }

  console.log('Build complete!');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
