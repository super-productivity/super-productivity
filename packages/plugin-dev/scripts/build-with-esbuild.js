#!/usr/bin/env node

/**
 * Shared esbuild build for plugins, run from the plugin's directory (npm run build):
 *
 *   node ../scripts/build-with-esbuild.js [--entry src/background.ts] [--ui src/ui/main.ts]
 *
 * - Bundles --entry (default src/plugin.ts) into dist/plugin.js as a minified IIFE.
 *   Without a .ts entry, a plain src/plugin.js is copied as-is.
 * - With --ui, bundles that file and inlines it into the index.html next to it at
 *   the `<!-- BUILD:SCRIPT -->` marker: the host loads index.html via iframe srcdoc,
 *   so the document must be self-contained.
 * - Copies manifest.json (required), config-schema.json, icon.svg and i18n/*.json
 *   when present, each looked up in src/ first, then the plugin root (so a copy
 *   in src/ wins over one in the root).
 *
 * Only builds plugin directories next to this script's folder (plugin-dev/<name>).
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const UI_SCRIPT_MARKER = '<!-- BUILD:SCRIPT -->';

const KNOWN_ARGS = ['entry', 'ui'];

/** Parses `--name value` and `--name=value`; rejects unknown or empty flags. */
const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match || !KNOWN_ARGS.includes(match[1])) {
      throw new Error(
        `Unknown argument: ${argv[i]} (known: --${KNOWN_ARGS.join(', --')})`,
      );
    }
    const value = match[2] !== undefined ? match[2] : argv[++i];
    if (!value || value.startsWith('--')) {
      throw new Error(`--${match[1]} needs a file path`);
    }
    args[match[1]] = value;
  }
  return args;
};

// Resolved from the plugin, so each plugin keeps its pinned esbuild version.
const loadEsbuild = () => require(require.resolve('esbuild', { paths: [ROOT_DIR] }));

const findAsset = (name) =>
  [path.join(SRC_DIR, name), path.join(ROOT_DIR, name)].find((p) => fs.existsSync(p));

const esbuildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
  minify: true,
  sourcemap: false,
};

async function buildPlugin() {
  const { entry: entryArg, ui: uiArg } = parseArgs(process.argv.slice(2));
  const entry = path.resolve(ROOT_DIR, entryArg || 'src/plugin.ts');
  const plainPluginJs = path.join(SRC_DIR, 'plugin.js');
  const ui = uiArg && path.resolve(ROOT_DIR, uiArg);
  const manifest = findAsset('manifest.json');

  // Validate before touching dist/, so a run from the wrong directory deletes nothing.
  if (
    path.dirname(ROOT_DIR) !== path.resolve(__dirname, '..') ||
    !fs.existsSync(path.join(ROOT_DIR, 'package.json')) ||
    !manifest
  ) {
    throw new Error(
      `${ROOT_DIR} is not a plugin directory (plugin-dev/<name> with package.json + manifest.json)`,
    );
  }
  const hasEntry = fs.existsSync(entry);
  if (entryArg && !hasEntry) {
    throw new Error(`Entry not found: ${entryArg}`);
  }
  if (!hasEntry && !fs.existsSync(plainPluginJs) && !ui) {
    throw new Error('Nothing to build: no src/plugin.ts, src/plugin.js or --ui');
  }
  if (ui && !fs.existsSync(ui)) {
    throw new Error(`UI entry not found: ${uiArg}`);
  }

  console.log(`Building ${path.basename(ROOT_DIR)}...`);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR);

  if (hasEntry) {
    await loadEsbuild().build({
      ...esbuildOptions,
      entryPoints: [entry],
      outfile: path.join(DIST_DIR, 'plugin.js'),
    });
  } else if (fs.existsSync(plainPluginJs)) {
    fs.copyFileSync(plainPluginJs, path.join(DIST_DIR, 'plugin.js'));
  }

  if (ui) {
    const result = await loadEsbuild().build({
      ...esbuildOptions,
      entryPoints: [ui],
      write: false,
    });
    const template = fs.readFileSync(path.join(path.dirname(ui), 'index.html'), 'utf8');
    if (!template.includes(UI_SCRIPT_MARKER)) {
      throw new Error(`index.html is missing the ${UI_SCRIPT_MARKER} marker`);
    }
    const bundle = result.outputFiles[0].text;
    // Function replacer: a replacement string would interpret `$&`-style
    // patterns that minified JS can contain.
    const html = template.replace(
      UI_SCRIPT_MARKER,
      () => `<script>\n${bundle}\n</script>`,
    );
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);
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
