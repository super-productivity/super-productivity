import * as fs from 'fs';
import sharp from 'sharp';

/** Default outer width the matrix expects for `desktopMaster` (= 2560 device px). */
const TARGET_WIDTH_PX = 2560;
/** Default outer height the matrix expects for `desktopMaster` (= 1600 device px). */
const TARGET_HEIGHT_PX = 1600;
/** Retina device pixel ratio used by `desktopMaster`. */
const DEVICE_SCALE_FACTOR = 2;

/**
 * AppKit's hiddenInset traffic-light geometry in points. With
 * `titleBarStyle: 'hiddenInset'` the controls float over the web contents,
 * so compositing must draw on top of the existing capture, not pad a titlebar.
 */
const LIGHT_RADIUS_PT = 6.5;
const LIGHT_CENTRE_Y_PT = 14;
const LIGHT_CENTRE_XS_PT = [24, 44, 64];
const LIGHT_FILLS = ['#ff5f57', '#febc2e', '#28c941'] as const;
/** Faint inner outline so the buttons read on light backgrounds. */
const LIGHT_OUTLINES = ['#e0443e', '#dea123', '#1aa334'] as const;

const buildTrafficLightsSvg = (): string => {
  const width = (LIGHT_CENTRE_XS_PT[2] + LIGHT_RADIUS_PT + 2) * DEVICE_SCALE_FACTOR;
  const height = (LIGHT_CENTRE_Y_PT + LIGHT_RADIUS_PT + 2) * DEVICE_SCALE_FACTOR;
  const radius = LIGHT_RADIUS_PT * DEVICE_SCALE_FACTOR;
  const cy = LIGHT_CENTRE_Y_PT * DEVICE_SCALE_FACTOR;
  const lights = LIGHT_CENTRE_XS_PT.map((cxPt, i) => {
    const cx = cxPt * DEVICE_SCALE_FACTOR;
    return (
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${LIGHT_FILLS[i]}" ` +
      `stroke="${LIGHT_OUTLINES[i]}" stroke-width="${DEVICE_SCALE_FACTOR * 0.5}" />`
    );
  }).join('\n  ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n` +
    '  <filter id="s" x="-40%" y="-40%" width="180%" height="180%">\n' +
    '    <feDropShadow dx="0" dy="0.5" stdDeviation="0.75" flood-color="#000" flood-opacity="0.28"/>\n' +
    '  </filter>\n' +
    `  <g filter="url(#s)">\n` +
    `  ${lights}\n` +
    '  </g>\n' +
    `</svg>`
  );
};

/**
 * Add macOS hiddenInset traffic lights to a desktop master capture. This is
 * intentionally a deterministic overlay: Playwright-launched Electron is not
 * always treated like a LaunchServices-started `.app`, and OS capture can
 * therefore miss AppKit's button overlay even when the web contents are right.
 */
export const compositeMacTrafficLights = async (pngPath: string): Promise<void> => {
  if (!fs.existsSync(pngPath)) return;
  const meta = await sharp(pngPath).metadata();
  if (!meta.width || !meta.height) return;
  if (meta.width !== TARGET_WIDTH_PX || meta.height !== TARGET_HEIGHT_PX) {
    throw new Error(
      `Expected ${TARGET_WIDTH_PX}x${TARGET_HEIGHT_PX}, got ${meta.width}x${meta.height}`,
    );
  }

  const composited = await sharp(pngPath)
    .composite([{ input: Buffer.from(buildTrafficLightsSvg()), top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(pngPath, composited);
};
