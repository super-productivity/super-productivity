#!/usr/bin/env node

/**
 * Generate iOS app icon from existing PNG source
 *
 * iOS requires a fully opaque 1024x1024 PNG with no alpha channel.
 * This script resizes the existing logo and ensures it has no alpha channel.
 */

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.log('sharp not found, installing...');
  require('child_process').execSync('npm install --no-save --no-package-lock sharp', {
    stdio: 'inherit',
  });
  sharp = require('sharp');
}
const fs = require('fs');
const path = require('path');

// Configuration
const ICON_SIZE = 1024;

// Paths
const SOURCE_PNG = path.join(__dirname, '../build/icons/sq2160x2160.png');
const OUTPUT_PATH = path.join(
  __dirname,
  '../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
);

async function generateIcon() {
  console.log('🎨 Generating iOS app icon...\n');

  // Step 1: Read source PNG
  console.log('📖 Reading source PNG:', SOURCE_PNG);

  if (!fs.existsSync(SOURCE_PNG)) {
    throw new Error(`Source PNG not found: ${SOURCE_PNG}`);
  }

  console.log('✓ Source PNG found\n');

  // Step 2: Resize and remove alpha channel
  console.log(`🔄 Resizing to ${ICON_SIZE}x${ICON_SIZE} and removing alpha channel...`);

  const iconBuffer = await sharp(SOURCE_PNG)
    .resize(ICON_SIZE, ICON_SIZE, {
      fit: 'cover',
      position: 'center',
    })
    .flatten({ background: { r: 100, g: 149, b: 237 } }) // Fallback background if source has transparency
    .removeAlpha() // Explicitly remove alpha channel
    .toColorspace('srgb')
    .png()
    .toBuffer();

  console.log('✓ Icon resized\n');

  // Step 3: Write to output file
  console.log('💾 Writing icon to:', OUTPUT_PATH);

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, iconBuffer);
  console.log('✓ Icon written\n');

  // Step 4: Verify output
  console.log('🔍 Verifying icon properties...');
  const metadata = await sharp(OUTPUT_PATH).metadata();

  const checks = {
    Dimensions: metadata.width === ICON_SIZE && metadata.height === ICON_SIZE,
    Format: metadata.format === 'png',
    Channels: metadata.channels === 3,
    'No alpha': !metadata.hasAlpha,
    'Color space': metadata.space === 'srgb',
  };

  console.log('\nVerification results:');
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`  ${passed ? '✅' : '❌'} ${check}: ${passed ? 'PASS' : 'FAIL'}`);
  }

  console.log('\nMetadata:');
  console.log(`  Size: ${metadata.width}x${metadata.height}`);
  console.log(`  Format: ${metadata.format}`);
  console.log(`  Channels: ${metadata.channels} (${metadata.hasAlpha ? 'RGBA' : 'RGB'})`);
  console.log(`  Color space: ${metadata.space}`);

  const allPassed = Object.values(checks).every((v) => v);

  if (!allPassed) {
    throw new Error('❌ Icon verification failed! Icon has incorrect properties.');
  }

  console.log('\n✅ SUCCESS! iOS app icon generated with no alpha channel.');
  console.log('\nNext steps:');
  console.log('  1. Run: npm run sync:ios');
  console.log('  2. Test in iOS Simulator/device to verify no white frame');
}

// Run the script
generateIcon().catch((error) => {
  console.error('\n❌ Error generating icon:', error.message);
  process.exit(1);
});
