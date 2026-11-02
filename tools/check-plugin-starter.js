#!/usr/bin/env node
/**
 * Checks packages/plugin-starter the way a plugin author gets it, not through
 * the workspace symlink: packs plugin-api into a tarball, copies the starter to
 * a temp folder, installs the tarball there, typechecks the starter with
 * --checkJs, packs plugin.zip and checks its layout.
 *
 *   npm run plugin-starter:check
 *
 * Needs the repository's TypeScript (installed with plugin-api's dependencies).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_API_DIR = path.join(ROOT, 'packages/plugin-api');
const STARTER_DIR = path.join(ROOT, 'packages/plugin-starter');
const REQUIRED_ZIP_ENTRIES = ['manifest.json', 'plugin.js', 'icon.svg'];

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

/** Entry names from a ZIP's central directory. */
const zipEntryNames = (buf) => {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('plugin.zip has no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-starter-'));
try {
  // prepack builds dist/, so this is exactly what npm publish would ship.
  run('npm', ['pack', '--pack-destination', tmp], PLUGIN_API_DIR);
  const tarball = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));

  const starter = path.join(tmp, 'starter');
  fs.cpSync(STARTER_DIR, starter, {
    recursive: true,
    filter: (src) => !['node_modules', 'plugin.zip'].includes(path.basename(src)),
  });
  run(
    'npm',
    ['install', '--no-save', '--no-audit', '--no-fund', path.join(tmp, tarball)],
    starter,
  );

  const tsc = require.resolve('typescript/bin/tsc', { paths: [PLUGIN_API_DIR] });
  run(process.execPath, [tsc, '-p', 'jsconfig.json', '--checkJs'], starter);
  run(process.execPath, ['scripts/pack.mjs'], starter);

  const names = zipEntryNames(fs.readFileSync(path.join(starter, 'plugin.zip')));
  const missing = REQUIRED_ZIP_ENTRIES.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`plugin.zip lacks ${missing.join(', ')} at its root`);
  }
  console.log('✓ plugin starter typechecks against the packed plugin-api and packs');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
