/**
 * Lazy `sharp` loader.
 *
 * `sharp` is a native module that breaks reproducible/offline builds (notably
 * F-Droid, see issue #7542), so it is intentionally NOT a declared dependency.
 * It is only needed by the marketing-screenshot pipeline, which is a manual
 * dev task — so install it on demand here, mirroring tools/generate-*-icon.js.
 */

import { execSync } from 'child_process';

type Sharp = typeof import('sharp');

let cached: Sharp | undefined;

const resolveModule = (mod: unknown): Sharp => {
  const m = mod as { default?: Sharp };
  return m.default ?? (mod as Sharp);
};

export const loadSharp = async (): Promise<Sharp> => {
  if (cached) return cached;
  try {
    cached = resolveModule(await import('sharp'));
  } catch {
    // eslint-disable-next-line no-console
    console.log('sharp not found, installing (dev-only screenshot tool)...');
    execSync('npm install --no-save --no-package-lock sharp', { stdio: 'inherit' });
    cached = resolveModule(await import('sharp'));
  }
  return cached;
};
