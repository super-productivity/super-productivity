import type { Locator } from '@playwright/test';

/**
 * The markdown editing surface inside `scope`.
 *
 * Deliberately NOT `.cm-content, textarea`: the textarea still exists for the
 * markdown-formatting-off path, and matching either one would let a silent fall
 * back to the old editor keep every migrated suite green. Notes are edited in
 * the live editor, so pin it — if that ever changes, these should fail loudly
 * rather than quietly test the other path.
 */
export const markdownEditor = (scope: Locator): Locator =>
  scope.locator('.cm-content').first();

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
