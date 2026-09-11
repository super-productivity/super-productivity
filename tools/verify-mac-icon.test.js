'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { crc32, deflateSync } = require('node:zlib');
const afterPack = require('./afterPack');
const { resolveNpmInvocation } = require('./generate-mac-icon');
const { compareIconsets, verifyIconset, verifyIcns } = require('./verify-mac-icon');

const ICON_PATH = join(__dirname, '..', 'build', 'icon.icns');
const ICONSET_PATH = join(__dirname, '..', 'build', 'icon.iconset');
const GENERIC_SMALL_ICON = join(__dirname, '..', 'build', 'icons', '16x16.png');

test('macOS icon generator launches npm through Node on Windows', () => {
  const npmExecPath = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
  const nodeExecutable = String.raw`C:\Program Files\nodejs\node.exe`;

  assert.deepEqual(
    resolveNpmInvocation({
      platform: 'win32',
      npmExecPath,
      nodeExecutable,
    }),
    {
      command: nodeExecutable,
      prefixArgs: [npmExecPath],
    },
  );
});

test('checked-in macOS icon sources contain every standard representation', () => {
  assert.doesNotThrow(() => verifyIconset(ICONSET_PATH));
  assert.doesNotThrow(() => verifyIcns(readFileSync(ICON_PATH), ICON_PATH, ICONSET_PATH));
});

test('macOS icon verification rejects unrecognized small-icon payloads', () => {
  const mangledIcon = Buffer.from(readFileSync(ICON_PATH));
  assert.equal(mangledIcon.toString('ascii', 8, 12), 'icp4');
  mangledIcon.write('ic04', 8, 4, 'ascii');
  mangledIcon.fill(0, 16, 24);

  assert.throws(
    () => verifyIcns(mangledIcon, 'mangled.icns', ICONSET_PATH),
    /unrecognized payload/,
  );
});

test('macOS icon verification rejects corrupt PNG data', () => {
  const corruptIcon = Buffer.from(readFileSync(ICON_PATH));
  const pngOffset = corruptIcon.indexOf(Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.notEqual(pngOffset, -1);
  corruptIcon[pngOffset + 29] ^= 1;

  assert.throws(() => verifyIcns(corruptIcon, 'corrupt.icns'), /invalid PNG IHDR CRC/);
});

test('macOS icon verification rejects the full-bleed generic small artwork', (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sp-mac-iconset-test-'));
  const actualIconset = join(temporaryDirectory, 'icon.iconset');
  cpSync(ICONSET_PATH, actualIconset, { recursive: true });
  copyFileSync(GENERIC_SMALL_ICON, join(actualIconset, 'icon_16x16.png'));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  assert.throws(
    () => compareIconsets(ICONSET_PATH, actualIconset),
    /fully transparent pixels/,
  );
});

const pngChunk = (type, data) => {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
};

const encodePng = (size, pixels) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rowLength = size * 4;
  const filtered = Buffer.alloc((rowLength + 1) * size);
  for (let row = 0; row < size; row++) {
    pixels.copy(
      filtered,
      row * (rowLength + 1) + 1,
      row * rowLength,
      (row + 1) * rowLength,
    );
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(filtered)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

// Move one channel of one anti-aliased pixel by exactly `levels` steps in
// premultiplied space — the same kind of drift the iconutil round trip
// introduces (one level) and real artwork regressions exceed (many levels).
const shiftChannelByPremultipliedLevels = (decoded, levels) => {
  const pixels = Buffer.from(decoded.pixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if (alpha < 32 || alpha === 255) continue;
    for (let channel = 0; channel < 3; channel++) {
      const premultiplied = Math.round((pixels[offset + channel] * alpha) / 255);
      if (premultiplied <= levels) continue;
      const shifted = Math.round(((premultiplied - levels) * 255) / alpha);
      if (Math.round((shifted * alpha) / 255) !== premultiplied - levels) continue;
      pixels[offset + channel] = shifted;
      return pixels;
    }
  }
  throw new Error('no shiftable anti-aliased pixel found in iconset');
};

const writeShiftedSmallIcon = (directory, levels) => {
  const actualIconset = join(directory, 'icon.iconset');
  cpSync(ICONSET_PATH, actualIconset, { recursive: true });
  const decoded = verifyIconset(ICONSET_PATH).get('icon_16x16.png');
  const pixels = shiftChannelByPremultipliedLevels(decoded, levels);
  writeFileSync(join(actualIconset, 'icon_16x16.png'), encodePng(16, pixels));
  return actualIconset;
};

test('macOS icon comparison tolerates one level of premultiplied rounding noise', (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sp-mac-iconset-test-'));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const actualIconset = writeShiftedSmallIcon(temporaryDirectory, 1);
  assert.doesNotThrow(() => compareIconsets(ICONSET_PATH, actualIconset));
});

// iconutil compiles small representations as 'ARGB' chunks: four icns-RLE
// planes in A,R,G,B order with straight-alpha values. Encode literal-only
// runs, which the icns RLE decoder must accept.
const encodeIcnsRlePlane = (plane) => {
  const parts = [];
  for (let offset = 0; offset < plane.length; offset += 128) {
    const literals = plane.subarray(offset, Math.min(offset + 128, plane.length));
    parts.push(Buffer.from([literals.length - 1]), literals);
  }
  return Buffer.concat(parts);
};

const buildIcnsWithArgbSmallIcon = (pixels) => {
  const planes = [3, 0, 1, 2].map((channel) => {
    const plane = Buffer.alloc(pixels.length / 4);
    for (let i = 0; i < plane.length; i++) {
      plane[i] = pixels[i * 4 + channel];
    }
    return encodeIcnsRlePlane(plane);
  });
  const argbData = Buffer.concat([Buffer.from('ARGB', 'ascii'), ...planes]);

  const source = readFileSync(ICON_PATH);
  const chunks = [];
  let offset = 8;
  while (offset < source.length) {
    const type = source.toString('ascii', offset, offset + 4);
    const length = source.readUInt32BE(offset + 4);
    // iconutil emits the 16x16 slot as ic04 with ARGB data; mirror that shape.
    chunks.push(
      type === 'icp4'
        ? { type: 'ic04', data: argbData }
        : { type, data: source.subarray(offset + 8, offset + length) },
    );
    offset += length;
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 8);
  const icns = Buffer.alloc(totalLength);
  icns.write('icns', 0, 4, 'ascii');
  icns.writeUInt32BE(totalLength, 4);
  let outputOffset = 8;
  for (const { type, data } of chunks) {
    icns.write(type, outputOffset, 4, 'ascii');
    icns.writeUInt32BE(8 + data.length, outputOffset + 4);
    data.copy(icns, outputOffset + 8);
    outputOffset += 8 + data.length;
  }
  return icns;
};

test('macOS icns verification accepts iconutil-style ARGB small representations', () => {
  const decoded = verifyIconset(ICONSET_PATH).get('icon_16x16.png');
  const icns = buildIcnsWithArgbSmallIcon(decoded.pixels);
  assert.doesNotThrow(() => verifyIcns(icns, 'argb.icns', ICONSET_PATH));
});

test('macOS icns verification rejects ARGB artwork drift', () => {
  const decoded = verifyIconset(ICONSET_PATH).get('icon_16x16.png');
  const pixels = shiftChannelByPremultipliedLevels(decoded, 8);
  const icns = buildIcnsWithArgbSmallIcon(pixels);
  assert.throws(() => verifyIcns(icns, 'argb.icns', ICONSET_PATH), /artwork differs/);
});

test('macOS icon comparison rejects artwork drift beyond rounding noise', (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sp-mac-iconset-test-'));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const actualIconset = writeShiftedSmallIcon(temporaryDirectory, 8);
  assert.throws(() => compareIconsets(ICONSET_PATH, actualIconset), /artwork differs/);
});

for (const electronPlatformName of ['darwin', 'mas']) {
  test(`afterPack verifies the icon copied into a ${electronPlatformName} app`, async (t) => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'sp-mac-icon-test-'));
    const resourcesDir = join(
      appOutDir,
      'Super Productivity.app',
      'Contents',
      'Resources',
    );
    mkdirSync(resourcesDir, { recursive: true });
    copyFileSync(ICON_PATH, join(resourcesDir, 'icon.icns'));
    t.after(() => rmSync(appOutDir, { recursive: true, force: true }));

    await assert.doesNotReject(() =>
      afterPack({
        electronPlatformName,
        appOutDir,
        packager: { appInfo: { productFilename: 'Super Productivity' } },
      }),
    );
  });
}

test('afterPack rejects a packaged macOS icon that differs from the source', async (t) => {
  const sourceIcon = readFileSync(ICON_PATH);
  const packagedIcon = Buffer.alloc(sourceIcon.length + 9);
  sourceIcon.copy(packagedIcon);
  packagedIcon.writeUInt32BE(packagedIcon.length, 4);
  packagedIcon.write('name', sourceIcon.length, 4, 'ascii');
  packagedIcon.writeUInt32BE(9, sourceIcon.length + 4);

  const appOutDir = mkdtempSync(join(tmpdir(), 'sp-mac-icon-test-'));
  const resourcesDir = join(appOutDir, 'Super Productivity.app', 'Contents', 'Resources');
  mkdirSync(resourcesDir, { recursive: true });
  writeFileSync(join(resourcesDir, 'icon.icns'), packagedIcon);
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      afterPack({
        electronPlatformName: 'darwin',
        appOutDir,
        packager: { appInfo: { productFilename: 'Super Productivity' } },
      }),
    /does not match/,
  );
});
