/**
 * Lazy `sharp` loader.
 *
 * `sharp` is a native module that breaks reproducible/offline builds (notably
 * F-Droid, see issue #7542), so it is intentionally NOT a declared dependency.
 * It is only needed by the marketing-screenshot pipeline, which is a manual
 * dev task — so install it on demand here, mirroring tools/generate-*-icon.js.
 */

import { execSync } from 'child_process';

interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number }>;
  ensureAlpha(): SharpImage;
  composite(
    images: { input: Buffer; blend?: string; left?: number; top?: number }[],
  ): SharpImage;
  blur(sigma: number): SharpImage;
  png(): SharpImage;
  jpeg(options: {
    quality: number;
    mozjpeg: boolean;
    progressive: boolean;
    chromaSubsampling: string;
  }): SharpImage;
  toBuffer(): Promise<Buffer>;
}

type Sharp = (
  input:
    | string
    | Buffer
    | {
        create: {
          width: number;
          height: number;
          channels: 4;
          background: { r: number; g: number; b: number; alpha: number };
        };
      },
) => SharpImage;

// A variable module name keeps this optional dependency out of static resolution.
const sharpModuleName: string = 'sharp';

let cached: Sharp | undefined;

const resolveModule = (mod: unknown): Sharp => {
  const m = mod as { default?: Sharp };
  return m.default ?? (mod as Sharp);
};

export const loadSharp = async (): Promise<Sharp> => {
  if (cached) return cached;
  try {
    cached = resolveModule(await import(sharpModuleName));
  } catch {
    console.log('sharp not found, installing (dev-only screenshot tool)...');
    execSync('npm install --no-save --no-package-lock sharp', { stdio: 'inherit' });
    cached = resolveModule(await import(sharpModuleName));
  }
  return cached;
};
