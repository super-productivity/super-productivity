const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// SECURITY INVARIANT (cross-layer regression guard)
// --------------------------------------------------
// `src/app/plugins/bundled-plugins.const.ts` declares two lists:
//   - BUNDLED_PLUGIN_PATHS: the on-disk asset dirs of the plugins we ship.
//   - BUNDLED_PLUGIN_IDS:   the reserved set of *manifest ids* that an uploaded
//                           plugin is forbidden from claiming.
// The renderer rejects an uploaded plugin whose manifest id is in
// BUNDLED_PLUGIN_IDS so unverified code cannot impersonate a built-in. With
// nodeExecution now openable to uploaded plugins, an unguarded id would also
// let an upload borrow a bundled dir's "verified built-in" consent dialog in
// the main process. PATHS are keyed by on-disk dir name; IDS by manifest id;
// the dir->id mapping is NOT identity (e.g. dir `yesterday-tasks-plugin` has
// manifest id `yesterday-tasks`). The two lists already drifted once (gitea /
// linear / trello / azure issue-providers were in PATHS but missing from IDS),
// which silently opened the impersonation gap for those ids.
//
// This test enforces PATHS ⊆ IDS: every bundled plugin's real manifest id MUST
// be reserved. It deliberately does NOT require equality — IDS may reserve ids
// for plugins not currently shipped via PATHS (e.g. `ai-productivity-prompts`),
// which only widens the reserved set and is harmless.
//
// A Karma/browser unit test cannot read the filesystem, and this `node --test`
// (electron) suite does not load the app's TypeScript. So we parse the file as
// text here and read manifests straight off disk.

const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLED_PLUGINS_CONST_PATH = path.join(
  REPO_ROOT,
  'src/app/plugins/bundled-plugins.const.ts',
);
const PLUGIN_DEV_DIR = path.join(REPO_ROOT, 'packages/plugin-dev');

/**
 * Extract a named array/Set literal's quoted string entries from the source
 * text. We don't evaluate the file (no Angular import) — we slice the literal
 * between its opening token and the matching close bracket, then pull every
 * single/double-quoted string out of that slice. This stays robust to
 * formatting (line breaks, trailing commas, `as const`) without executing code.
 *
 * @param {string} source   full bundled-plugins.const.ts text
 * @param {string} declStart the literal's opening, e.g. `BUNDLED_PLUGIN_PATHS = [`
 * @param {string} closeChar the matching close bracket, `]` or `)`
 * @returns {string[]} the quoted entries, in source order
 */
const extractStringLiteralList = (source, declStart, closeChar) => {
  const startIdx = source.indexOf(declStart);
  assert.notEqual(
    startIdx,
    -1,
    `Could not find "${declStart}" in bundled-plugins.const.ts — the const may have been renamed; update this regression test.`,
  );
  const contentStart = startIdx + declStart.length;
  const closeIdx = source.indexOf(closeChar, contentStart);
  assert.notEqual(
    closeIdx,
    -1,
    `Could not find closing "${closeChar}" for "${declStart}" in bundled-plugins.const.ts.`,
  );
  const slice = source.slice(contentStart, closeIdx);
  const matches = slice.match(/['"]([^'"]+)['"]/g) || [];
  return matches.map((m) => m.slice(1, -1));
};

/**
 * Locate a bundled plugin's manifest. Both layouts exist in the repo:
 *   packages/plugin-dev/<dir>/manifest.json
 *   packages/plugin-dev/<dir>/src/manifest.json
 * Returns the first that exists, or null if neither does.
 */
const findManifestPath = (dirName) => {
  const candidates = [
    path.join(PLUGIN_DEV_DIR, dirName, 'manifest.json'),
    path.join(PLUGIN_DEV_DIR, dirName, 'src', 'manifest.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
};

test('every BUNDLED_PLUGIN_PATHS plugin has its manifest id reserved in BUNDLED_PLUGIN_IDS', () => {
  const source = fs.readFileSync(BUNDLED_PLUGINS_CONST_PATH, 'utf8');

  const bundledPaths = extractStringLiteralList(source, 'BUNDLED_PLUGIN_PATHS = [', ']');
  const bundledIds = new Set(
    extractStringLiteralList(source, 'BUNDLED_PLUGIN_IDS = new Set<string>([', ']'),
  );

  // Sanity: if either list parsed empty, the source format changed and the
  // guard is silently inert — fail loudly rather than pass vacuously.
  assert.ok(
    bundledPaths.length > 0,
    'Parsed zero entries from BUNDLED_PLUGIN_PATHS — the source format likely changed; update this test.',
  );
  assert.ok(
    bundledIds.size > 0,
    'Parsed zero entries from BUNDLED_PLUGIN_IDS — the source format likely changed; update this test.',
  );

  const missingIds = [];
  const missingManifests = [];

  for (const assetPath of bundledPaths) {
    const dirName = assetPath.split('/').pop();
    const manifestPath = findManifestPath(dirName);

    if (!manifestPath) {
      missingManifests.push(dirName);
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const id = manifest.id;
    assert.ok(
      typeof id === 'string' && id.length > 0,
      `Manifest for "${dirName}" has no string "id" field (${manifestPath}).`,
    );

    if (!bundledIds.has(id)) {
      missingIds.push(`${dirName} -> "${id}"`);
    }
  }

  // A missing manifest for a listed dir is itself drift/misconfig.
  assert.equal(
    missingManifests.length,
    0,
    `No manifest.json (top-level or src/) found under packages/plugin-dev for bundled plugin dir(s): ${missingManifests.join(
      ', ',
    )}. Each BUNDLED_PLUGIN_PATHS entry must have a manifest so its id can be verified.`,
  );

  // The core invariant. List ALL offenders, not just the first.
  assert.equal(
    missingIds.length,
    0,
    `SECURITY: the following bundled plugins' manifest ids are NOT reserved in ` +
      `BUNDLED_PLUGIN_IDS (src/app/plugins/bundled-plugins.const.ts). An uploaded plugin ` +
      `could claim these ids and impersonate a built-in. Add each missing id to ` +
      `BUNDLED_PLUGIN_IDS:\n  ${missingIds.join('\n  ')}`,
  );
});

// Release builds only bundle plugin dirs that have a package.json
// (packages/build-packages.js `getPlugins`); `plugins:build` (build-all.js),
// used by E2E, copies them regardless. A bundled plugin missing it passes E2E
// and silently disappears from releases — observed once, for `parallel-code`.
test('every BUNDLED_PLUGIN_PATHS plugin has a package.json so release builds include it', () => {
  const source = fs.readFileSync(BUNDLED_PLUGINS_CONST_PATH, 'utf8');
  const bundledPaths = extractStringLiteralList(source, 'BUNDLED_PLUGIN_PATHS = [', ']');
  assert.ok(bundledPaths.length > 0, 'Parsed zero entries from BUNDLED_PLUGIN_PATHS.');

  const missing = bundledPaths
    .map((assetPath) => assetPath.split('/').pop())
    .filter((dirName) => {
      // build-packages.js also skips a package.json it can't parse.
      try {
        JSON.parse(
          fs.readFileSync(path.join(PLUGIN_DEV_DIR, dirName, 'package.json'), 'utf8'),
        );
        return false;
      } catch {
        return true;
      }
    });

  assert.deepEqual(
    missing,
    [],
    `Bundled plugin dir(s) without a readable packages/plugin-dev/<dir>/package.json: ${missing.join(', ')}. ` +
      'packages/build-packages.js skips them, so release builds would ship without the plugin.',
  );
});
