import { isImageUrlSimple } from '../../util/is-image-url';
import { DropPasteIcons, DropPasteInput } from './drop-paste.model';

export const createFromDrop = (ev: DragEvent): null | DropPasteInput => {
  if (!ev.dataTransfer) {
    throw new Error('No drop data');
  }
  const text = ev.dataTransfer.getData('text');
  return text ? _createTextBookmark(text) : _createFileBookmark(ev.dataTransfer);
};

/**
 * Extract a single http(s) web link from a drag event, or null when the drop
 * isn't a shareable link (files, plain-text selections, or non-web schemes).
 *
 * Reads both `text/uri-list` and `text/plain` because sources disagree on where
 * the URL lives: browsers dragging a hyperlink populate `text/uri-list` with the
 * bare URL, while `text/plain` is often `"<url>\n<page title>"` (and Electron
 * cross-app drops may fill only one of them). We scan every line and take the
 * first that is exactly an http(s) URL — a line with inner whitespace is a text
 * selection, not a link, so it's skipped.
 */
export const getDroppedUrl = (ev: DragEvent): string | null => {
  const dt = ev.dataTransfer;
  if (!dt) {
    return null;
  }
  const lines = `${dt.getData('text/uri-list')}\n${dt.getData('text/plain')}`.split(
    /[\r\n]+/,
  );
  return (
    lines.map((line) => line.trim()).find((line) => /^https?:\/\/\S+$/i.test(line)) ??
    null
  );
};

export const createFromPaste = (ev: ClipboardEvent): null | DropPasteInput => {
  if (ev.target && (ev.target as HTMLElement).getAttribute('contenteditable')) {
    return null;
  }
  const text = ev.clipboardData && ev.clipboardData.getData('text/plain');
  if (text) {
    return _createTextBookmark(text);
  }
  return null;
};

const _createTextBookmark = (text: string): null | DropPasteInput => {
  if (text) {
    if (text.match(/\n/)) {
      // addItem({
      //  title: text.substr(0, MAX_TITLE_LENGTH),
      //  type: 'TEXT'
      // });
    } else {
      let path = text;
      if (!path.match(/^http/)) {
        path = '//' + path;
      }
      const isImage = isImageUrlSimple(path);

      return {
        title: _baseName(text),
        path,
        type: isImage ? 'IMG' : 'LINK',
        icon: isImage ? DropPasteIcons.IMG : DropPasteIcons.LINK,
      };
    }
  }
  return null;
};

const _createFileBookmark = (dataTransfer: DataTransfer): null | DropPasteInput => {
  const file = dataTransfer.files[0];
  if (!file) {
    return null;
  }

  // Electron 32+ removed the non-standard File.path property. Without the
  // absolute path the attachment only stores the bare file name, so "open"
  // silently fails (shell.openPath can't resolve a relative path). Recover it
  // via webUtils.getPathForFile (exposed on window.ea, Electron-only). See
  // issue #8553.
  const path = window.ea?.getPathForFile?.(file) || file.name;
  if (!path) {
    return null;
  }

  // Keep the title clean (file.name is already the bare name) so it isn't the
  // full OS path once `path` resolves to an absolute Windows/Unix path.
  return {
    title: _baseName(file.name || path),
    path,
    type: 'FILE',
    icon: DropPasteIcons.FILE,
  };
};

const _baseName = (passedStr: string): string => {
  const str = passedStr.trim();
  let base;
  if (str[str.length - 1] === '/') {
    const strippedStr = str.substring(0, str.length - 2);
    base = strippedStr.substring(strippedStr.lastIndexOf('/') + 1);
  } else {
    base = str.substring(str.lastIndexOf('/') + 1);
  }

  if (base.lastIndexOf('.') !== -1) {
    base = base.substring(0, base.lastIndexOf('.'));
  }
  return base;
};
