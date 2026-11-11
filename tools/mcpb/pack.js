/**
 * Packs the Claude Desktop extension (tools/mcpb) into dist/super-productivity.mcpb.
 * A .mcpb file is a zip with manifest.json at its root. Uses fflate, which the
 * app already depends on, so the bridge adds no package.
 *
 * The packed manifest carries the app's version, so every release asset is a
 * new extension version, and the app icon. The SHA-256 it prints is what
 * registries that list .mcpb files ask for.
 *
 *   node tools/mcpb/pack.js
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { strToU8, zipSync } = require('fflate');

const root = __dirname;
const repoRoot = path.join(root, '..', '..');
const outDir = path.join(repoRoot, 'dist');
const outFile = path.join(outDir, 'super-productivity.mcpb');

const read = (file) => new Uint8Array(fs.readFileSync(file));

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.version = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).version;

const entries = {
  'manifest.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
  'server/index.js': read(path.join(root, 'server', 'index.js')),
  'README.md': read(path.join(root, 'README.md')),
  [manifest.icon]: read(path.join(repoRoot, 'build', 'icons', '512x512.png')),
};

const bundle = zipSync(entries, { level: 9 });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, bundle);
const sha256 = crypto.createHash('sha256').update(bundle).digest('hex');
console.log(
  `Wrote ${path.relative(process.cwd(), outFile)} (version ${manifest.version}, sha256 ${sha256})`,
);
