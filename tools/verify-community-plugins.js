#!/usr/bin/env node
/**
 * Checks src/assets/community-plugins.json, the plugin listing shown in
 * Settings → Plugins (type: CommunityPlugin in
 * src/app/plugins/util/community-plugin.util.ts).
 *
 *   node tools/verify-community-plugins.js             # shape only (runs in lint)
 *   node tools/verify-community-plugins.js --download  # also fetch every release
 *
 * --download fetches each pinned release, checks its size and SHA-256, and that
 * the ZIP's manifest.json has the listed id and version, so a reviewer of a
 * listing PR does not have to hash files by hand. It reads manifest.json with
 * `unzip -p` and never runs plugin code.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const LISTING_PATH = path.join(__dirname, '../src/assets/community-plugins.json');
// Same as MAX_PLUGIN_ZIP_SIZE in src/app/plugins/plugin.const.ts (a test compares them).
const MAX_PLUGIN_ZIP_SIZE = 10 * 1024 * 1024;

const ENTRY_KEYS = new Set([
  'name',
  'shortDescription',
  'url',
  'author',
  'authorUrl',
  'id',
  'release',
]);
const RELEASE_KEYS = new Set(['version', 'downloadUrl', 'sha256']);
// Manifest ids must not contain ':' (validatePluginManifest); this is stricter.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Numeric only, so the app can tell whether a listed release is newer.
const VERSION_PATTERN = /^\d+(\.\d+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// Manifest values come from the downloaded ZIP: quote and cap them so they cannot
// forge GitHub Actions workflow commands (`::notice::`) in the log.
const show = (v) => JSON.stringify(v ?? null).slice(0, 100);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Returns a list of human-readable problems; empty means valid. */
const validateCommunityPlugins = (entries) => {
  if (!Array.isArray(entries)) {
    return ['The listing must be a JSON array'];
  }
  const errors = [];
  const names = new Set();
  const ids = new Set();

  entries.forEach((entry, i) => {
    const at = `Entry ${i}${isNonEmptyString(entry?.name) ? ` ("${entry.name}")` : ''}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) {
        errors.push(`${at}: unknown key "${key}"`);
      }
    }
    for (const key of ['name', 'shortDescription', 'author']) {
      if (!isNonEmptyString(entry[key])) {
        errors.push(`${at}: "${key}" must be a non-empty string`);
      }
    }
    if (!isHttpsUrl(entry.url)) {
      errors.push(`${at}: "url" must be an https URL`);
    }
    if (entry.authorUrl !== undefined && !isHttpsUrl(entry.authorUrl)) {
      errors.push(`${at}: "authorUrl" must be an https URL`);
    }
    if (isNonEmptyString(entry.name)) {
      const key = entry.name.trim().toLowerCase();
      if (names.has(key)) {
        errors.push(`${at}: duplicate name`);
      }
      names.add(key);
    }
    if (entry.id !== undefined) {
      if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
        errors.push(`${at}: "id" must be the plugin's manifest id`);
      } else if (ids.has(entry.id)) {
        errors.push(`${at}: duplicate id "${entry.id}"`);
      } else {
        ids.add(entry.id);
      }
    }
    if (entry.release !== undefined) {
      errors.push(...validateRelease(entry.release, entry.id).map((e) => `${at}: ${e}`));
    }
  });
  return errors;
};

const validateRelease = (release, id) => {
  if (typeof release !== 'object' || release === null || Array.isArray(release)) {
    return ['"release" must be an object'];
  }
  const errors = [];
  if (id === undefined) {
    errors.push('"release" requires "id"');
  }
  for (const key of Object.keys(release)) {
    if (!RELEASE_KEYS.has(key)) {
      errors.push(`unknown key "release.${key}"`);
    }
  }
  if (typeof release.version !== 'string' || !VERSION_PATTERN.test(release.version)) {
    errors.push('"release.version" must be a numeric version like "1.2.0"');
  }
  if (!isHttpsUrl(release.downloadUrl)) {
    errors.push('"release.downloadUrl" must be an https URL');
  }
  if (typeof release.sha256 !== 'string' || !SHA256_PATTERN.test(release.sha256)) {
    errors.push('"release.sha256" must be 64 lowercase hex characters');
  }
  return errors;
};

const readManifestWithUnzip = (zipBytes) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-community-plugin-'));
  try {
    const zipPath = path.join(dir, 'plugin.zip');
    fs.writeFileSync(zipPath, zipBytes);
    return JSON.parse(
      execFileSync('unzip', ['-p', zipPath, 'manifest.json'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Downloads one entry's release; returns a list of problems. */
const verifyRelease = async (
  entry,
  { fetchFn = fetch, readManifest = readManifestWithUnzip } = {},
) => {
  const { release } = entry;
  let bytes;
  try {
    const res = await fetchFn(release.downloadUrl, { redirect: 'follow' });
    if (!res.ok) {
      return [`download failed: HTTP ${res.status}`];
    }
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return [`download failed: ${e.message}`];
  }
  if (bytes.length > MAX_PLUGIN_ZIP_SIZE) {
    return [`ZIP is ${bytes.length} bytes, over the ${MAX_PLUGIN_ZIP_SIZE} byte limit`];
  }
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== release.sha256) {
    return [`sha256 mismatch: listed ${release.sha256}, downloaded ${actual}`];
  }
  let manifest;
  try {
    manifest = readManifest(bytes);
  } catch (e) {
    return [`could not read manifest.json from the ZIP: ${show(e.message)}`];
  }
  const errors = [];
  if (manifest?.id !== entry.id) {
    errors.push(`manifest id is ${show(manifest?.id)}, listed id is "${entry.id}"`);
  }
  if (manifest?.version !== release.version) {
    errors.push(
      `manifest version is ${show(manifest?.version)}, listed version is "${release.version}"`,
    );
  }
  return errors;
};

const main = async () => {
  const entries = JSON.parse(fs.readFileSync(LISTING_PATH, 'utf8'));
  const errors = validateCommunityPlugins(entries);

  if (errors.length === 0 && process.argv.includes('--download')) {
    for (const entry of entries.filter((e) => e.release)) {
      const problems = await verifyRelease(entry);
      errors.push(...problems.map((p) => `"${entry.name}": ${p}`));
      if (problems.length === 0) {
        console.log(`ok  ${entry.name} ${entry.release.version}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`${path.relative(process.cwd(), LISTING_PATH)}:`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }
  console.log(`community-plugins.json: ${entries.length} entries OK`);
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  validateCommunityPlugins,
  verifyRelease,
  LISTING_PATH,
  MAX_PLUGIN_ZIP_SIZE,
};
