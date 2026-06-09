/* eslint-disable @typescript-eslint/naming-convention */
export const MIME_TYPE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
} as const;

export const EXTENSION_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Canonical list of supported image extensions (lowercase, dot-prefixed). Single
 * source of truth for the image-file security allowlists in the filesystem IPC
 * handlers (clipboard copy/save, ipc-handler-wrapper). Keep those checks derived
 * from this — drift between an "allowed to write" set and an "allowed to copy"
 * set reopens holes.
 */
export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] =
  Object.keys(EXTENSION_MIME_TYPES);
