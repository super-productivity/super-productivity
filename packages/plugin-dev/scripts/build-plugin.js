#!/usr/bin/env node

/**
 * Shared build for host-side (plugin.js) plugins, run from the plugin's directory:
 *
 *   node ../scripts/build-plugin.js [--entry src/background.ts]
 *
 * Bundles the entry (default src/plugin.ts) into dist/plugin.js as a minified
 * IIFE and copies the plugin's assets into dist/ when present:
 * manifest.json (required), config-schema.json, icon.svg and i18n/*.json —
 * each looked up in src/ first, then the plugin root.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Resolve esbuild from the plugin, so each plugin keeps its pinned version.
const { build } = require(require.resolve('esbuild', { paths: [ROOT_DIR] }));

const getArg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const findAsset = (name) =>
  [path.join(SRC_DIR, name), path.join(ROOT_DIR, name)].find((p) => fs.existsSync(p));

async function buildPlugin() {
  const pluginName = path.basename(ROOT_DIR);
  const entry = path.join(ROOT_DIR, getArg('entry', 'src/plugin.ts'));
  console.log(`Building ${pluginName}...`);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR);

  await build({
    entryPoints: [entry],
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

  const manifest = findAsset('manifest.json');
  if (!manifest) {
    throw new Error('manifest.json not found in src/ or plugin root');
  }
  fs.copyFileSync(manifest, path.join(DIST_DIR, 'manifest.json'));

  for (const file of ['config-schema.json', 'icon.svg']) {
    const src = findAsset(file);
    if (src) {
      fs.copyFileSync(src, path.join(DIST_DIR, file));
    }
  }

  const i18nDir = findAsset('i18n');
  if (i18nDir) {
    const i18nDist = path.join(DIST_DIR, 'i18n');
    fs.mkdirSync(i18nDist);
    for (const file of fs.readdirSync(i18nDir)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(i18nDir, file), path.join(i18nDist, file));
      }
    }
  }

  console.log('Build complete!');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
