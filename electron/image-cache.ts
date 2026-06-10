import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { assertPathOutside } from './file-path-guard';

/**
 * Main-owned cache for user-picked images (e.g. background images).
 *
 * Background (issue #8228): the legacy flow was
 *   pick → renderer holds an absolute path / file:// URL → renderer asks
 *   main to inline that path as a data URL on every render.
 * That gave any compromised renderer the ability to ask main to read any
 * image-extension file outside userData, indefinitely. The path was the
 * authorization token, and the path could be swapped after the pick.
 *
 * After this module: the renderer picks a file via `dialog.showOpenDialog`
 * (proven user intent), main copies the file into a private cache directory
 * under userData and hands back an opaque `id`. The renderer stores that id
 * in user config and asks main for the data URL by id. No path ever leaves
 * main. Subsequent app launches can resolve the id without re-asking the
 * user — the file is now owned by the app.
 *
 * Source-path validation is layered defense-in-depth:
 *   - source must live outside userData (no laundering the grant file)
 *   - extension must be in the allow-list (binary blobs masquerading as png
 *     won't decode in the renderer anyway, but reject early)
 *   - size must be under MAX_IMAGE_BYTES (avoid memory pressure when
 *     copying / base64-encoding)
 *   - the id is `randomBytes(16)` (128 bits) — unguessable, so a renderer
 *     cannot iterate the cache directory looking for files it didn't import.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// SVG is deliberately excluded: it is a scriptable format (can embed
// <script>/event handlers) and inlining it as a data URL would reintroduce an
// XSS surface, so the cache only accepts raster formats.
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const ID_RE = /^[a-f0-9]{32}$/;

const getCacheDir = (): string => path.join(app.getPath('userData'), 'bg-images');

const ensureCacheDir = async (): Promise<string> => {
  const dir = getCacheDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const getExt = (p: string): string => {
  // Use path.extname so Windows backslash separators are handled too —
  // the renderer-supplied path may originate from a Windows-style picker.
  const ext = path.extname(p).toLowerCase();
  return ext.startsWith('.') ? ext.substring(1) : ext;
};

export interface ImportedImage {
  readonly id: string;
  readonly mimeType: string;
}

/**
 * Copy the source image into the cache and return an opaque id. Returns
 * null on any rejection (unsupported extension, too large, inside userData,
 * read error). The caller — typically the renderer-facing IPC — must not
 * surface the rejection reason as a path-bearing error.
 */
export const importImage = async (
  absoluteSourcePath: string,
): Promise<ImportedImage | null> => {
  if (typeof absoluteSourcePath !== 'string' || absoluteSourcePath.length === 0) {
    return null;
  }

  // The renderer-supplied path was just returned from SHOW_OPEN_DIALOG (proven
  // user intent), but we still validate — a compromised renderer could call
  // this IPC with any path, not just the dialog result.
  try {
    assertPathOutside(app.getPath('userData'), absoluteSourcePath);
  } catch {
    return null;
  }

  const ext = getExt(absoluteSourcePath);
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    return null;
  }

  let stat;
  try {
    stat = await fs.stat(absoluteSourcePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_IMAGE_BYTES) return null;
  if (stat.size === 0) return null;

  const dir = await ensureCacheDir();
  const id = randomBytes(16).toString('hex');
  const target = path.join(dir, `${id}.${ext}`);

  try {
    await fs.copyFile(absoluteSourcePath, target);
  } catch {
    // Best-effort cleanup if a partial copy landed.
    try {
      await fs.unlink(target);
    } catch {
      // ignore
    }
    return null;
  }
  return { id, mimeType };
};

interface CachedImageFile {
  readonly absolutePath: string;
  readonly mimeType: string;
}

const findCachedFile = async (id: string): Promise<CachedImageFile | null> => {
  if (!ID_RE.test(id)) return null;
  const dir = getCacheDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.startsWith(`${id}.`)) continue;
    const ext = getExt(name);
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) continue;
    return { absolutePath: path.join(dir, name), mimeType };
  }
  return null;
};

/**
 * Return a `data:<mime>;base64,…` URL for the cached image. Returns null
 * when the id is unknown, malformed, or the file disappeared between
 * import and read.
 */
export const getImageDataUrl = async (id: string): Promise<string | null> => {
  const found = await findCachedFile(id);
  if (!found) return null;
  let stat;
  try {
    stat = await fs.stat(found.absolutePath);
  } catch {
    return null;
  }
  // Defence-in-depth: a file already in the cache should not be larger than
  // the import limit, but the import limit may change between releases. Be
  // paranoid about a too-large read either way.
  if (stat.size > MAX_IMAGE_BYTES) return null;
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(found.absolutePath);
  } catch {
    return null;
  }
  return `data:${found.mimeType};base64,${buffer.toString('base64')}`;
};

/** Remove a cached image by id. No-op when the id is unknown. */
export const removeCachedImage = async (id: string): Promise<void> => {
  const found = await findCachedFile(id);
  if (!found) return;
  try {
    await fs.unlink(found.absolutePath);
  } catch {
    // ignore
  }
};
