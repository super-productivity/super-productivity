import { IS_ELECTRON } from '../../app.constants';

/**
 * Resolve a background-image URL to something a CSS `background` can render.
 *
 * On Electron a `file://` URL has to be read off disk and inlined as a data
 * URL (the renderer can't load arbitrary `file://` paths); every other URL
 * passes through unchanged. Returns null when there is no image or the read
 * fails, so callers fall back to no background.
 *
 * Note: callers that react to a changing source should guard against stale
 * results themselves (e.g. a request-id), since this resolves asynchronously.
 */
export const resolveBgImageToDataUrl = async (
  bgImage: string | null | undefined,
): Promise<string | null> => {
  if (!bgImage) {
    return null;
  }
  if (!IS_ELECTRON || !bgImage.startsWith('file://')) {
    return bgImage;
  }
  const readLocalImageAsDataUrl = window.ea?.readLocalImageAsDataUrl;
  if (!readLocalImageAsDataUrl) {
    return null;
  }
  try {
    return (await readLocalImageAsDataUrl(bgImage)) || null;
  } catch {
    // A missing/unreadable file just means "no background" — fall back quietly.
    return null;
  }
};
