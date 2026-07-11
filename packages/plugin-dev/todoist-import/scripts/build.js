#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const buildPlugin = async () => {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  // Bundle the UI and inline it: the host loads index.html via iframe srcdoc,
  // so the document must be fully self-contained (no relative script URLs).
  const result = await build({
    entryPoints: [path.join(SRC_DIR, 'ui', 'main.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
  });
  const bundle = result.outputFiles[0].text;

  const htmlTemplate = fs.readFileSync(path.join(SRC_DIR, 'ui', 'index.html'), 'utf8');
  const marker = '<!-- BUILD:SCRIPT -->';
  if (!htmlTemplate.includes(marker)) {
    throw new Error(`index.html is missing the ${marker} marker`);
  }
  // function replacer: a literal replacement string would corrupt the bundle
  // if the minified JS ever contains `$&`/`$'`-style replacement patterns
  const html = htmlTemplate.replace(marker, () => `<script>\n${bundle}\n</script>`);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);

  for (const file of ['manifest.json', 'plugin.js', 'icon.svg']) {
    fs.copyFileSync(path.join(SRC_DIR, file), path.join(DIST_DIR, file));
  }
  fs.cpSync(path.join(ROOT_DIR, 'i18n'), path.join(DIST_DIR, 'i18n'), {
    recursive: true,
  });
  console.log('todoist-import build complete → dist/');
};

buildPlugin().catch((err) => {
  console.error('todoist-import build failed:', err);
  process.exit(1);
});
