#!/usr/bin/env node
'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { crc32, inflateSync } = require('node:zlib');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MIN_TRANSPARENT_PIXEL_RATIO = 0.2;
// Same-sized 1x and 2x images are separate semantic representations in ICNS.
// iconutil stores the small sizes as ic04/ic05 (ARGB form) while the portable
// generator writes icp4/icp5 (PNG form); either type satisfies the slot.
const REPRESENTATIONS = [
  { label: '16x16', type: 'icp4', argbType: 'ic04', file: 'icon_16x16.png', pixels: 16 },
  { label: '16x16@2x', type: 'ic11', file: 'icon_16x16@2x.png', pixels: 32 },
  { label: '32x32', type: 'icp5', argbType: 'ic05', file: 'icon_32x32.png', pixels: 32 },
  { label: '32x32@2x', type: 'ic12', file: 'icon_32x32@2x.png', pixels: 64 },
  { label: '128x128', type: 'ic07', file: 'icon_128x128.png', pixels: 128 },
  { label: '128x128@2x', type: 'ic13', file: 'icon_128x128@2x.png', pixels: 256 },
  { label: '256x256', type: 'ic08', file: 'icon_256x256.png', pixels: 256 },
  { label: '256x256@2x', type: 'ic14', file: 'icon_256x256@2x.png', pixels: 512 },
  { label: '512x512', type: 'ic09', file: 'icon_512x512.png', pixels: 512 },
  { label: '512x512@2x', type: 'ic10', file: 'icon_512x512@2x.png', pixels: 1024 },
];
const ICONSET_FILES = REPRESENTATIONS.map(({ file, pixels }) => [file, pixels]);

const fail = (source, message) => {
  throw new Error(`${source}: ${message}`);
};

const paethPredictor = (left, up, upperLeft) => {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
};

const decodePng = (buffer, expectedPixels, source) => {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(source, 'invalid PNG signature');
  }

  let offset = 8;
  let width;
  let height;
  let sawHeader = false;
  let sawEnd = false;
  let idatEnded = false;
  const compressedParts = [];

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      fail(source, `truncated PNG chunk at byte ${offset}`);
    }

    const dataLength = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) {
      fail(source, `truncated PNG ${type} chunk`);
    }

    const declaredCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (declaredCrc !== actualCrc) {
      fail(source, `invalid PNG ${type} CRC`);
    }

    if (!sawHeader && type !== 'IHDR') {
      fail(source, 'PNG IHDR must be the first chunk');
    }
    if (type === 'IHDR') {
      if (sawHeader || dataLength !== 13) {
        fail(source, 'invalid PNG IHDR');
      }
      sawHeader = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const compression = buffer[dataStart + 10];
      const filter = buffer[dataStart + 11];
      const interlace = buffer[dataStart + 12];
      if (
        width !== expectedPixels ||
        height !== expectedPixels ||
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        fail(
          source,
          `expected ${expectedPixels}x${expectedPixels} non-interlaced 8-bit RGBA PNG`,
        );
      }
    } else if (type === 'IDAT') {
      if (idatEnded) fail(source, 'PNG IDAT chunks must be consecutive');
      compressedParts.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (dataLength !== 0 || chunkEnd !== buffer.length) {
        fail(source, 'invalid PNG IEND');
      }
      sawEnd = true;
    } else {
      if (compressedParts.length) idatEnded = true;
      if (/^[A-Z]/.test(type) && type !== 'PLTE') {
        fail(source, `unsupported critical PNG chunk ${type}`);
      }
    }

    offset = chunkEnd;
  }

  if (!sawHeader || !sawEnd || !compressedParts.length) {
    fail(source, 'PNG is missing IHDR, IDAT, or IEND');
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const expectedLength = (rowLength + 1) * height;
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(compressedParts), {
      maxOutputLength: expectedLength,
    });
  } catch (error) {
    fail(source, `invalid PNG image data: ${error.message}`);
  }

  if (filtered.length !== expectedLength) {
    fail(source, `decoded PNG length ${filtered.length}; expected ${expectedLength}`);
  }

  const pixels = Buffer.alloc(rowLength * height);
  let filteredOffset = 0;
  for (let row = 0; row < height; row++) {
    const filter = filtered[filteredOffset++];
    const rowStart = row * rowLength;
    for (let column = 0; column < rowLength; column++) {
      const encoded = filtered[filteredOffset++];
      const left =
        column >= bytesPerPixel ? pixels[rowStart + column - bytesPerPixel] : 0;
      const up = row > 0 ? pixels[rowStart - rowLength + column] : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? pixels[rowStart - rowLength + column - bytesPerPixel]
          : 0;

      let decoded;
      switch (filter) {
        case 0:
          decoded = encoded;
          break;
        case 1:
          decoded = encoded + left;
          break;
        case 2:
          decoded = encoded + up;
          break;
        case 3:
          decoded = encoded + Math.floor((left + up) / 2);
          break;
        case 4:
          decoded = encoded + paethPredictor(left, up, upperLeft);
          break;
        default:
          fail(source, `unsupported PNG row filter ${filter}`);
      }
      pixels[rowStart + column] = decoded & 0xff;
    }
  }

  let transparentPixels = 0;
  for (let alphaOffset = 3; alphaOffset < pixels.length; alphaOffset += 4) {
    if (pixels[alphaOffset] === 0) transparentPixels++;
  }
  const minimumTransparentPixels = Math.ceil(
    width * height * MIN_TRANSPARENT_PIXEL_RATIO,
  );
  if (transparentPixels < minimumTransparentPixels) {
    fail(
      source,
      `only ${transparentPixels} fully transparent pixels; expected at least ${minimumTransparentPixels}`,
    );
  }

  return { width, height, pixels };
};

// CoreGraphics runs ARGB payloads through a premultiply round trip whose
// rounding can land one level away from Math.round on anti-aliased pixels
// (#9481 — an exact compare failed every mac release build since v18.17.0).
// Real artwork regressions like #6323 move many pixels by many levels, so
// one level of noise is safe to absorb.
const CODEC_ROUNDING_TOLERANCE = 1;
const MAX_REPORTED_PIXEL_DIFFS = 8;

const compareDecodedPng = (expected, actual, source) => {
  const diffs = [];
  for (let offset = 0; offset < expected.pixels.length; offset += 4) {
    const expectedAlpha = expected.pixels[offset + 3];
    const actualAlpha = actual.pixels[offset + 3];
    let delta = Math.abs(expectedAlpha - actualAlpha);

    for (let channel = 0; channel < 3; channel++) {
      const expectedPremultiplied = Math.round(
        (expected.pixels[offset + channel] * expectedAlpha) / 255,
      );
      const actualPremultiplied = Math.round(
        (actual.pixels[offset + channel] * actualAlpha) / 255,
      );
      delta = Math.max(delta, Math.abs(expectedPremultiplied - actualPremultiplied));
    }

    if (delta > CODEC_ROUNDING_TOLERANCE) {
      diffs.push({ pixel: offset / 4, delta, offset });
    }
  }

  if (diffs.length) {
    const details = diffs
      .slice(0, MAX_REPORTED_PIXEL_DIFFS)
      .map(({ pixel, delta, offset }) => {
        const expectedRgba = Array.from(expected.pixels.subarray(offset, offset + 4));
        const actualRgba = Array.from(actual.pixels.subarray(offset, offset + 4));
        return `pixel ${pixel} (delta ${delta}): expected rgba(${expectedRgba.join(',')}), got rgba(${actualRgba.join(',')})`;
      })
      .join('; ');
    fail(
      source,
      `artwork differs at ${diffs.length} pixel(s) beyond rounding tolerance: ${details}`,
    );
  }
};

const ARGB_MAGIC = Buffer.from('ARGB', 'ascii');

// icns run-length encoding (not classic PackBits): a control byte below 0x80
// starts a literal run of control+1 bytes; 0x80 and above repeats the next
// byte control-0x80+3 times.
const decodeIcnsRle = (data, expectedLength, source) => {
  const plane = Buffer.alloc(expectedLength);
  let inputOffset = 0;
  let outputOffset = 0;
  while (outputOffset < expectedLength) {
    if (inputOffset >= data.length) {
      fail(source, 'truncated RLE channel data');
    }
    const control = data[inputOffset++];
    const count = control < 0x80 ? control + 1 : control - 0x80 + 3;
    if (outputOffset + count > expectedLength) {
      fail(
        source,
        `RLE run overflows channel by ${outputOffset + count - expectedLength} bytes`,
      );
    }
    if (control < 0x80) {
      if (inputOffset + count > data.length) {
        fail(source, 'truncated RLE literal run');
      }
      data.copy(plane, outputOffset, inputOffset, inputOffset + count);
      inputOffset += count;
    } else {
      if (inputOffset >= data.length) {
        fail(source, 'truncated RLE repeat run');
      }
      plane.fill(data[inputOffset++], outputOffset, outputOffset + count);
    }
    outputOffset += count;
  }
  return { plane, bytesRead: inputOffset };
};

// iconutil stores small representations (icp4/icp5) as 'ARGB': four
// icns-RLE-compressed planes in alpha, red, green, blue order holding
// straight (non-premultiplied) channel values.
const decodeArgbChunk = (buffer, expectedPixels, source) => {
  const pixelCount = expectedPixels * expectedPixels;
  const pixels = Buffer.alloc(pixelCount * 4);
  let offset = ARGB_MAGIC.length;
  for (const channel of [3, 0, 1, 2]) {
    const { plane, bytesRead } = decodeIcnsRle(
      buffer.subarray(offset),
      pixelCount,
      `${source}:plane${channel}`,
    );
    for (let i = 0; i < pixelCount; i++) {
      pixels[i * 4 + channel] = plane[i];
    }
    offset += bytesRead;
  }
  if (offset !== buffer.length) {
    fail(source, `unexpected ${buffer.length - offset} trailing bytes in ARGB data`);
  }
  return { width: expectedPixels, height: expectedPixels, pixels };
};

const parseIcns = (buffer, source) => {
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'icns') {
    fail(source, 'invalid ICNS header');
  }

  const declaredLength = buffer.readUInt32BE(4);
  if (declaredLength !== buffer.length) {
    fail(
      source,
      `declared length ${declaredLength} does not match file length ${buffer.length}`,
    );
  }

  const chunks = new Map();
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      fail(source, `truncated chunk header at byte ${offset}`);
    }

    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) {
      fail(source, `invalid ${type} chunk length ${length} at byte ${offset}`);
    }
    if (chunks.has(type)) {
      fail(source, `duplicate ${type} chunk`);
    }

    chunks.set(type, buffer.subarray(offset + 8, offset + length));
    offset += length;
  }

  return chunks;
};

const verifyIconset = (directory) => {
  const expectedFiles = ICONSET_FILES.map(([file]) => file).sort();
  const actualFiles = readdirSync(directory)
    .filter((file) => file.endsWith('.png'))
    .sort();
  if (actualFiles.join('\n') !== expectedFiles.join('\n')) {
    fail(directory, `expected iconset files: ${expectedFiles.join(', ')}`);
  }

  const decodedFiles = new Map();
  for (const [file, pixels] of ICONSET_FILES) {
    const source = join(directory, file);
    decodedFiles.set(file, decodePng(readFileSync(source), pixels, source));
  }
  return decodedFiles;
};

const compareIconsets = (expectedDirectory, actualDirectory) => {
  const expectedFiles = verifyIconset(expectedDirectory);
  const actualFiles = verifyIconset(actualDirectory);
  for (const [file, expected] of expectedFiles) {
    compareDecodedPng(expected, actualFiles.get(file), join(actualDirectory, file));
  }
};

const decodeRepresentationChunk = (chunk, expectedPixels, chunkSource) => {
  if (chunk.subarray(0, 4).equals(ARGB_MAGIC)) {
    return decodeArgbChunk(chunk, expectedPixels, chunkSource);
  }
  if (chunk.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return decodePng(chunk, expectedPixels, chunkSource);
  }
  fail(
    chunkSource,
    `unrecognized payload (starts with ${chunk.subarray(0, 8).toString('hex')})`,
  );
};

const verifyIcns = (buffer, source = 'ICNS', expectedIconsetDirectory) => {
  const chunks = parseIcns(buffer, source);
  const expectedFiles = expectedIconsetDirectory
    ? verifyIconset(expectedIconsetDirectory)
    : undefined;
  const missing = [];

  for (const representation of REPRESENTATIONS) {
    const presentTypes = [representation.type, representation.argbType].filter(
      (type) => type && chunks.has(type),
    );
    if (!presentTypes.length) {
      missing.push(`${representation.label} (${representation.type})`);
      continue;
    }

    for (const type of presentTypes) {
      const chunkSource = `${source}:${type}`;
      const decoded = decodeRepresentationChunk(
        chunks.get(type),
        representation.pixels,
        chunkSource,
      );
      if (expectedFiles) {
        compareDecodedPng(expectedFiles.get(representation.file), decoded, chunkSource);
      }
    }
  }

  if (missing.length) {
    fail(source, `missing icon representations: ${missing.join(', ')}`);
  }

  return [...chunks.keys()];
};

const main = (inputs) => {
  if (!inputs.length) {
    throw new Error('Usage: node tools/verify-mac-icon.js <icon.icns> [...]');
  }

  for (const iconPath of inputs) {
    const chunkTypes = verifyIcns(readFileSync(iconPath), iconPath);
    console.log(`Verified ${iconPath}: ${chunkTypes.join(', ')}`);
  }
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  compareIconsets,
  verifyIconset,
  verifyIcns,
};
