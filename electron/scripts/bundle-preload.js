#!/usr/bin/env node
const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: [
    path.join(__dirname, '..', 'preload.ts'),
    path.join(__dirname, '..', 'quick-add-preload.ts'),
  ],
  bundle: true,
  outdir: path.join(__dirname, '..'),
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
}).catch(() => process.exit(1));
