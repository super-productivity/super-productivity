/**
 * Packs the Claude Desktop extension (tools/mcpb) into dist/super-productivity.mcpb.
 * A .mcpb file is a zip with manifest.json at its root. Uses fflate, which the
 * app already depends on, so the bridge adds no package.
 *
 *   node tools/mcpb/pack.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');

const root = __dirname;
const files = ['manifest.json', 'server/index.js', 'README.md'];
const outDir = path.join(root, '..', '..', 'dist');
const outFile = path.join(outDir, 'super-productivity.mcpb');

const entries = Object.fromEntries(
  files.map((file) => [file, new Uint8Array(fs.readFileSync(path.join(root, file)))]),
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, zipSync(entries, { level: 9 }));
console.log(`Wrote ${path.relative(process.cwd(), outFile)}`);
