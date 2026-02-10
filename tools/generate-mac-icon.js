#!/usr/bin/env node

/**
 * Generate macOS app icon with squircle mask from existing PNG source.
 *
 * macOS does not automatically apply a squircle mask to .icns icons —
 * the shape must be baked into the image. This script applies Apple's
 * continuous-corner rounded rectangle (the "squircle") to the square
 * source icon and generates build/icon.icns.
 *
 * The bezier curve constants are reverse-engineered from iOS
 * UIBezierPath(roundedRect:cornerRadius:) by Liam Rosenfeld.
 * See: https://liamrosenfeld.com/posts/apple_icon_quest/
 *
 * The .icns file is assembled directly from PNG buffers (no native tools needed).
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_PNG = path.join(__dirname, '../build/icons/sq2160x2160.png');
const OUTPUT_ICNS = path.join(__dirname, '../build/icon.icns');

// ICNS OSType codes for PNG-based entries, mapped by pixel size
// See: https://en.wikipedia.org/wiki/Apple_Icon_Image_format
const ICNS_TYPES = [
  { osType: 'ic10', size: 1024 },
  { osType: 'ic09', size: 512 },
  { osType: 'ic08', size: 256 },
  { osType: 'ic07', size: 128 },
  { osType: 'icp5', size: 32 },
  { osType: 'icp4', size: 16 },
];

// Apple's corner radius: 185.4px at 824x824, scaled to full canvas
const CORNER_RADIUS_RATIO = 185.4 / 824;

/**
 * Generate an SVG path for Apple's continuous-corner rounded rectangle.
 *
 * Unlike a standard SVG rounded rect (which uses circular arcs), this uses
 * cubic bezier curves with continuous curvature — the transition from
 * straight edge to curve is gradual, not abrupt.
 *
 * Constants from UIBezierPath(roundedRect:cornerRadius:) reverse-engineering.
 */
function continuousRoundedRectSvg(size) {
  const cr = Math.round(size * CORNER_RADIUS_RATIO);

  // Helper functions matching the Swift implementation
  const tl = (x, y) => [x * cr, y * cr];
  const tr = (x, y) => [size - x * cr, y * cr];
  const br = (x, y) => [size - x * cr, size - y * cr];
  const bl = (x, y) => [x * cr, size - y * cr];

  const p = (pt) => `${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`;

  // Build SVG path using Apple's continuous-corner bezier curves
  const d = [
    `M ${p(tl(1.528665, 0))}`,
    `L ${p(tr(1.528665, 0))}`,
    `C ${p(tr(1.08849296, 0))} ${p(tr(0.86840694, 0))} ${p(tr(0.63149379, 0.07491139))}`,
    `C ${p(tr(0.37282383, 0.16905956))} ${p(tr(0.16905956, 0.37282383))} ${p(tr(0.07491139, 0.63149379))}`,
    `C ${p(tr(0, 0.86840694))} ${p(tr(0, 1.08849296))} ${p(tr(0, 1.52866498))}`,
    `L ${p(br(0, 1.528665))}`,
    `C ${p(br(0, 1.08849296))} ${p(br(0, 0.86840694))} ${p(br(0.07491139, 0.63149379))}`,
    `C ${p(br(0.16905956, 0.37282383))} ${p(br(0.37282383, 0.16905956))} ${p(br(0.63149379, 0.07491139))}`,
    `C ${p(br(0.86840694, 0))} ${p(br(1.08849296, 0))} ${p(br(1.52866498, 0))}`,
    `L ${p(bl(1.528665, 0))}`,
    `C ${p(bl(1.08849296, 0))} ${p(bl(0.86840694, 0))} ${p(bl(0.63149379, 0.07491139))}`,
    `C ${p(bl(0.37282383, 0.16905956))} ${p(bl(0.16905956, 0.37282383))} ${p(bl(0.07491139, 0.63149379))}`,
    `C ${p(bl(0, 0.86840694))} ${p(bl(0, 1.08849296))} ${p(bl(0, 1.52866498))}`,
    `L ${p(tl(0, 1.528665))}`,
    `C ${p(tl(0, 1.08849296))} ${p(tl(0, 0.86840694))} ${p(tl(0.07491139, 0.63149379))}`,
    `C ${p(tl(0.16905956, 0.37282383))} ${p(tl(0.37282383, 0.16905956))} ${p(tl(0.63149379, 0.07491139))}`,
    `C ${p(tl(0.86840694, 0))} ${p(tl(1.08849296, 0))} ${p(tl(1.52866498, 0))}`,
    'Z',
  ].join(' ');

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <path d="${d}" fill="white"/>
</svg>`;
}

function buildIcns(entries) {
  // ICNS file format:
  // Header: 4 bytes magic ('icns') + 4 bytes total file size
  // Entries: 4 bytes OSType + 4 bytes entry size (including header) + PNG data
  const HEADER_SIZE = 8;
  const ENTRY_HEADER_SIZE = 8;

  let totalSize = HEADER_SIZE;
  for (const entry of entries) {
    totalSize += ENTRY_HEADER_SIZE + entry.data.length;
  }

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // File header
  buffer.write('icns', offset, 4, 'ascii');
  offset += 4;
  buffer.writeUInt32BE(totalSize, offset);
  offset += 4;

  // Entries
  for (const entry of entries) {
    buffer.write(entry.osType, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32BE(ENTRY_HEADER_SIZE + entry.data.length, offset);
    offset += 4;
    entry.data.copy(buffer, offset);
    offset += entry.data.length;
  }

  return buffer;
}

async function generateMacIcon() {
  console.log('Generating macOS app icon with continuous-corner squircle mask...\n');

  if (!fs.existsSync(SOURCE_PNG)) {
    throw new Error(`Source PNG not found: ${SOURCE_PNG}`);
  }
  console.log('Source PNG found:', SOURCE_PNG);

  const entries = [];

  for (const { osType, size } of ICNS_TYPES) {
    const svg = continuousRoundedRectSvg(size);

    // Resize and apply squircle mask (preserving alpha for transparent edges)
    // macOS .icns natively supports PNG with alpha — no flatten needed.
    // See: https://github.com/super-productivity/super-productivity/issues/6323
    const pngBuffer = await sharp(SOURCE_PNG)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
      .png()
      .toBuffer();

    entries.push({ osType, data: pngBuffer });
    console.log(`  Generated ${size}x${size} (${osType}, ${pngBuffer.length} bytes)`);
  }

  // Build and write .icns file
  console.log('\nAssembling .icns file...');
  const icnsBuffer = buildIcns(entries);
  fs.writeFileSync(OUTPUT_ICNS, icnsBuffer);

  const stats = fs.statSync(OUTPUT_ICNS);
  console.log(`Generated: ${OUTPUT_ICNS} (${stats.size} bytes)`);

  // Verify the largest entry retains alpha (transparent edges)
  const metadata = await sharp(entries[0].data).metadata();
  console.log(`\nVerification (1024px entry):`);
  console.log(`  Dimensions: ${metadata.width}x${metadata.height}`);
  console.log(`  Channels: ${metadata.channels} (${metadata.hasAlpha ? 'RGBA' : 'RGB'})`);
  console.log(`  Has alpha: ${metadata.hasAlpha ? 'YES (correct)' : 'NO (unexpected)'}`);

  console.log('\nDone! macOS squircle icon generated at build/icon.icns');
}

generateMacIcon().catch((error) => {
  console.error('\nError generating icon:', error.message);
  process.exit(1);
});
