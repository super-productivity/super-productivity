#!/usr/bin/env node
'use strict';

/**
 * Generate the complete macOS iconset and build/icon.icns.
 *
 * Apple defines ten logical representations: five point sizes at 1x and 2x.
 * On macOS, iconutil compiles the iconset. Pass --compile-only in packaging
 * jobs to compile the checked-in iconset without needing Sharp.
 *
 * https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html
 * https://github.com/super-productivity/super-productivity/issues/6323
 */

const { execFileSync } = require('node:child_process');
const {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { verifyIcns } = require('./verify-mac-icon');

const BUILD_DIR = join(__dirname, '..', 'build');
const SOURCE_SVG = join(BUILD_DIR, 'icon-mac.svg');
const ICONSET_DIR = join(BUILD_DIR, 'icon.iconset');
const OUTPUT_ICNS = join(BUILD_DIR, 'icon.icns');
const SHARP_INSTALL_DIR = join(__dirname, '..', '.tmp', 'mac-icon-tools');
const SHARP_VERSION = '0.35.3';
const COMPILE_ONLY = process.argv.includes('--compile-only');

const ICONSET_ENTRIES = [
  { file: 'icon_16x16.png', pixels: 16, osType: 'icp4' },
  { file: 'icon_16x16@2x.png', pixels: 32, osType: 'ic11' },
  { file: 'icon_32x32.png', pixels: 32, osType: 'icp5' },
  { file: 'icon_32x32@2x.png', pixels: 64, osType: 'ic12' },
  { file: 'icon_128x128.png', pixels: 128, osType: 'ic07' },
  { file: 'icon_128x128@2x.png', pixels: 256, osType: 'ic13' },
  { file: 'icon_256x256.png', pixels: 256, osType: 'ic08' },
  { file: 'icon_256x256@2x.png', pixels: 512, osType: 'ic14' },
  { file: 'icon_512x512.png', pixels: 512, osType: 'ic09' },
  { file: 'icon_512x512@2x.png', pixels: 1024, osType: 'ic10' },
];

const buildPortableIcns = (entries) => {
  const totalLength = entries.reduce(
    (length, entry) => length + 8 + entry.data.length,
    8,
  );
  const buffer = Buffer.alloc(totalLength);
  buffer.write('icns', 0, 4, 'ascii');
  buffer.writeUInt32BE(totalLength, 4);

  let offset = 8;
  for (const entry of entries) {
    buffer.write(entry.osType, offset, 4, 'ascii');
    buffer.writeUInt32BE(8 + entry.data.length, offset + 4);
    entry.data.copy(buffer, offset + 8);
    offset += 8 + entry.data.length;
  }

  return buffer;
};

const resolveNpmInvocation = ({
  platform = process.platform,
  npmExecPath = process.env.npm_execpath,
  nodeExecutable = process.execPath,
} = {}) => {
  // npm is a .cmd shim on Windows, which execFileSync cannot launch directly.
  if (npmExecPath) {
    return {
      command: nodeExecutable,
      prefixArgs: [npmExecPath],
    };
  }
  if (platform === 'win32') {
    throw new Error(
      'npm cannot be located safely on Windows; run npm run generate:mac-icon',
    );
  }
  return {
    command: 'npm',
    prefixArgs: [],
  };
};

const loadSharp = () => {
  const installedPackage = join(
    SHARP_INSTALL_DIR,
    'node_modules',
    'sharp',
    'package.json',
  );
  try {
    const installedVersion = JSON.parse(readFileSync(installedPackage, 'utf8')).version;
    if (installedVersion === SHARP_VERSION) {
      return require(join(SHARP_INSTALL_DIR, 'node_modules', 'sharp'));
    }
  } catch {
    // Install below.
  }

  console.log(`Installing sharp ${SHARP_VERSION} in .tmp...`);
  mkdirSync(SHARP_INSTALL_DIR, { recursive: true });
  const npm = resolveNpmInvocation();
  execFileSync(
    npm.command,
    [
      ...npm.prefixArgs,
      'install',
      '--prefix',
      SHARP_INSTALL_DIR,
      '--no-save',
      '--no-package-lock',
      `sharp@${SHARP_VERSION}`,
    ],
    { stdio: 'inherit' },
  );
  const installedVersion = JSON.parse(readFileSync(installedPackage, 'utf8')).version;
  if (installedVersion !== SHARP_VERSION) {
    throw new Error(`Expected sharp ${SHARP_VERSION}; installed ${installedVersion}`);
  }
  return require(join(SHARP_INSTALL_DIR, 'node_modules', 'sharp'));
};

const generateIconset = async () => {
  const sharp = loadSharp();
  mkdirSync(ICONSET_DIR, { recursive: true });

  const renderedEntries = [];
  for (const entry of ICONSET_ENTRIES) {
    const data = await sharp(SOURCE_SVG)
      .resize(entry.pixels, entry.pixels)
      .ensureAlpha()
      .png()
      .toBuffer();
    writeFileSync(join(ICONSET_DIR, entry.file), data);
    renderedEntries.push({ ...entry, data });
    console.log(`Generated ${entry.file} (${entry.pixels}x${entry.pixels})`);
  }

  return renderedEntries;
};

const compileWithIconutil = () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sp-mac-icon-'));
  const temporaryIcon = join(temporaryDirectory, 'icon.icns');

  try {
    execFileSync(
      '/usr/bin/iconutil',
      ['--convert', 'icns', '--output', temporaryIcon, ICONSET_DIR],
      { stdio: 'inherit' },
    );
    // Verify the compiled artifact directly. `iconutil --convert iconset`
    // must NOT be used as a round-trip oracle: it un-premultiplies the
    // straight-alpha ARGB planes its own compile step wrote, clamping
    // anti-aliased pixels into garbage (#9481).
    verifyIcns(readFileSync(temporaryIcon), temporaryIcon, ICONSET_DIR);
    copyFileSync(temporaryIcon, OUTPUT_ICNS);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const generateMacIcon = async () => {
  const renderedEntries = COMPILE_ONLY ? undefined : await generateIconset();

  if (process.platform === 'darwin') {
    compileWithIconutil();
    console.log(`Verified compiled ${OUTPUT_ICNS} against the source iconset`);
  } else {
    if (COMPILE_ONLY) {
      throw new Error('--compile-only requires macOS and /usr/bin/iconutil');
    }
    console.warn(
      'iconutil is only available on macOS; writing an equivalent ten-slot ICNS.',
    );
    writeFileSync(OUTPUT_ICNS, buildPortableIcns(renderedEntries));
    const chunkTypes = verifyIcns(readFileSync(OUTPUT_ICNS), OUTPUT_ICNS, ICONSET_DIR);
    console.log(`Verified ${OUTPUT_ICNS}: ${chunkTypes.join(', ')}`);
  }
};

if (require.main === module) {
  generateMacIcon().catch((error) => {
    console.error(`Failed to generate macOS icon: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  generateMacIcon,
  resolveNpmInvocation,
};
