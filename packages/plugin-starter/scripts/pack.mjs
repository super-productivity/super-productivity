#!/usr/bin/env node
// Packs this folder into plugin.zip, ready for Settings → Plugins → Choose
// Plugin File, and prints the SHA-256 a community-plugins.json listing needs.
//
//   node scripts/pack.mjs    (or: npm run pack)
//
// No dependencies. Everything in the folder is included except development
// files (see EXCLUDED). The same files always produce the same ZIP, so the
// SHA-256 only changes when the plugin does.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..');
const OUT = 'plugin.zip';
const MAX_ZIP_BYTES = 10 * 1024 * 1024; // the app refuses larger plugins
const EXCLUDED = new Set([
  OUT,
  'node_modules',
  'scripts',
  'package.json',
  'package-lock.json',
  'jsconfig.json',
  'tsconfig.json',
  'README.md',
]);

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const readManifest = () => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  } catch (e) {
    fail(`manifest.json is missing or not valid JSON: ${e.message}`);
  }
  for (const key of ['id', 'name', 'version', 'manifestVersion', 'minSupVersion']) {
    if (!manifest[key]) fail(`manifest.json needs "${key}"`);
  }
  if (manifest.id.includes(':')) fail('manifest.json "id" must not contain ":"');
  if (!/^\d+(\.\d+)*$/.test(manifest.version)) {
    fail(`manifest.json "version" must be numeric like 1.2.0, got "${manifest.version}"`);
  }
  return manifest;
};

// Paths inside the ZIP always use "/", whatever the OS: the app looks up
// "manifest.json" and "i18n/en.json" by exact name.
const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && !EXCLUDED.has(e.name))
    .flatMap((e) => {
      const full = join(dir, e.name);
      return e.isDirectory()
        ? listFiles(full)
        : [relative(ROOT, full).split(sep).join('/')];
    });

// Minimal ZIP writer (deflate, no ZIP64), timestamps fixed to 1980-01-01.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const zip = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of files) {
    const data = readFileSync(join(ROOT, name));
    const packed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
};

const manifest = readManifest();
const files = listFiles(ROOT).sort();
if (!files.includes('plugin.js') && !files.includes('index.html')) {
  fail('add a plugin.js, or an index.html with "iFrame": true in manifest.json');
}
const buf = zip(files);
if (buf.length > MAX_ZIP_BYTES) {
  fail(
    `plugin.zip is ${(buf.length / 1024 / 1024).toFixed(1)} MB; the app accepts 10 MB`,
  );
}
writeFileSync(join(ROOT, OUT), buf);

console.log(`✓ ${OUT}: ${manifest.name} ${manifest.version} (${files.length} files)`);
for (const f of files) console.log(`  ${f}`);
console.log(`sha256: ${createHash('sha256').update(buf).digest('hex')}`);
