#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TARGET_DIR = path.join(
  ROOT_DIR,
  '..',
  '..',
  '..',
  'src',
  'assets',
  'bundled-plugins',
  'document-mode',
);

// editor.js is inlined into index.html, so it doesn't need to be deployed.
const FILES = ['manifest.json', 'plugin.js', 'index.html', 'icon.svg'];

if (!fs.existsSync(DIST_DIR)) {
  console.error('Error: dist directory not found. Run "npm run build" first.');
  process.exit(1);
}
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}
for (const file of FILES) {
  const src = path.join(DIST_DIR, file);
  const dest = path.join(TARGET_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied ${file}`);
  } else {
    console.warn(`⚠ ${file} not found in dist`);
  }
}
console.log(`\n✅ Deployed to ${TARGET_DIR}`);
