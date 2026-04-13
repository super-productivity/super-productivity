#!/usr/bin/env node
const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: [path.join(__dirname, '..', 'preload.ts')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'preload.js'),
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
}).catch(() => process.exit(1));
