/**
 * Makes Home/End move the caret to the start/end of the current (visual) line
 * inside a textarea or text input; Shift extends the selection.
 *
 * On macOS, Chromium maps Home/End in text fields to "scroll to beginning/end of
 * document" without moving the caret; when the field can't scroll, the scroll
 * chains to the page and the list jumps to the top. Call this on macOS only —
 * other platforms already behave this way natively.
 *
 * @returns true if the event was handled (and its default prevented)
 */
export const handleHomeEndInTextField = (ev: KeyboardEvent): boolean => {
  if (
    (ev.key !== 'Home' && ev.key !== 'End') ||
    ev.metaKey ||
    ev.ctrlKey ||
    ev.altKey ||
    ev.isComposing
  ) {
    return false;
  }
  const el = ev.target;
  if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
    return false;
  }
  // null for input types without a caret (checkbox, email, number, …)
  const selection = el.ownerDocument.getSelection();
  if (el.selectionStart === null || !selection) {
    return false;
  }

  ev.preventDefault();
  selection.modify(
    ev.shiftKey ? 'extend' : 'move',
    ev.key === 'Home' ? 'backward' : 'forward',
    'lineboundary',
  );
  return true;
};
