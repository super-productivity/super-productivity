import type { Locator } from '@playwright/test';

/**
 * The markdown editing surface inside `scope`. Since #9910 notes are edited in
 * a CodeMirror contenteditable (`.cm-content`); the plain textarea is still
 * reachable when the "Live Markdown editor" setting is off, so fall back to it.
 */
export const markdownEditor = (scope: Locator): Locator =>
  scope.locator('.cm-content, textarea').first();

/**
 * Replaces the markdown editor's content. `fill()` is not used because it takes
 * a different path on a contenteditable than real typing does; select-all +
 * type is the same input CodeMirror sees from a user.
 */
export const fillMarkdownEditor = async (
  scope: Locator,
  content: string,
): Promise<void> => {
  const editor = markdownEditor(scope);
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.click();
  await editor.press('ControlOrMeta+a');
  // An empty string still needs the select-all to be cleared.
  if (content) {
    await editor.pressSequentially(content);
  } else {
    await editor.press('Delete');
  }
};
