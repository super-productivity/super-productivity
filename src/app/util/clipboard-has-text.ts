/**
 * True when the clipboard carries text (plain or HTML).
 *
 * Used to prioritize a normal text paste over turning the paste into an image
 * attachment: apps like OneNote/Office put both text and an image on the
 * clipboard, and silently converting that to an image would lose the text.
 */
export const clipboardHasText = (clipboardData: DataTransfer | null): boolean =>
  !!clipboardData &&
  (clipboardData.types.includes('text/plain') ||
    clipboardData.types.includes('text/html'));
