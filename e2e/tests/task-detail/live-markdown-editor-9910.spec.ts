import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL, DETAIL_PANEL_BTN } = cssSelectors;

/**
 * Issue #9910: task notes are edited in an Obsidian-style live editor — one
 * surface that renders markdown while you type, instead of an edit/preview
 * split.
 *
 * What is worth pinning here is the part that is invisible to unit tests: the
 * document keeps the raw markdown while the view hides the syntax, and the
 * checkbox a checklist renders as writes back into that source.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/live-markdown-editor-9910.spec.ts -- --retries=0
 */

test.describe('Live markdown editor (#9910)', () => {
  test('renders markdown inline and toggles a checklist item from its checkbox', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('live markdown task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('live markdown task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    // Always mounted: there is no "edit" mode to enter any more.
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    // The notes start out holding the stock notes template, and the config that
    // supplies it loads asynchronously — select all so this test types into a
    // known document either way.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('# A heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] a checklist item');

    // Blur, so no line is revealed as raw source any more. Escape hands focus
    // back to the detail panel's notes item 150ms later; wait for that settled
    // state, or the panel grabs focus in the middle of the click below.
    await page.keyboard.press('Escape');
    await editor.blur();
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? ''),
      )
      .toBe('task-detail-item');

    // The heading renders as a heading and its `#` marker is hidden from view,
    // even though the note's text still holds it.
    await expect(notes.locator('.cm-md-h1')).toBeVisible();
    await expect(editor).not.toContainText('# A heading');
    await expect(editor).toContainText('A heading');

    // ...and the source really is untouched: putting the caret back on that
    // line reveals the raw markdown again. This is the round-trip guarantee —
    // nothing is rewritten, only hidden.
    await notes.locator('.cm-md-h1').click();
    await expect(editor).toContainText('# A heading');

    // The checklist prefix renders as a real checkbox (a Material Icons
    // ligature, same as the rendered-markdown path uses).
    const checkbox = notes.locator('.cm-md-task-checkbox');
    await expect(checkbox).toHaveText('check_box_outline_blank');
    await expect(editor).not.toContainText('[ ]');

    // Clicking it edits the source — the line is now `- [x] …`.
    await checkbox.click();
    await expect(checkbox).toHaveText('check_box');
    await expect(notes.locator('.cm-md-task-done')).toBeVisible();

    // ...and that edit is SAVED. The widget flipping in the view proves
    // nothing on its own: notes commit on blur, and the checkbox handler
    // suppresses its own mousedown, so without an explicit focus the toggle
    // would never reach task.notes. Close and reopen to read it back.
    const task = taskPage.getTaskByText('live markdown task');
    await task.locator(DETAIL_PANEL_BTN).click();
    await expect(page.locator(DETAIL_PANEL)).not.toBeVisible();
    await taskPage.openTaskDetail(task);

    const reopened = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    await reopened.locator('.cm-content').waitFor({ state: 'visible' });
    await expect(reopened.locator('.cm-md-task-checkbox')).toHaveText('check_box');
  });

  // An image whose `![...](...)` spans a line break cannot be replaced by a
  // view plugin — CodeMirror throws while building the view, which would leave
  // the note blank and uneditable with no way to get the text back out.
  test('survives an image that spans a line break', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await workViewPage.waitForTaskList();
    await workViewPage.addTask('multiline image task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('multiline image task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.type('![foo');
    await page.keyboard.press('Enter');
    await page.keyboard.type('bar](img.png)');
    await editor.blur();

    // Left as plain source rather than rendered — and, crucially, the view was
    // built at all: before the fix the constructor threw and the editor's host
    // stayed empty.
    await expect(editor).toContainText('![foo');
    await expect(editor).toContainText('bar](img.png)');
    expect(errors).toEqual([]);
  });

  test('opens a link when the note is not being edited', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('link note task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('link note task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.type('see [docs](https://example.com/docs) now');
    await editor.blur();

    // The editor renders a styled span, not an anchor, so the click has to be
    // handled — nothing would open without it.
    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = (url?: string | URL): null => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      };
    });
    await notes.locator('.cm-md-link').first().click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
      )
      .toEqual(['https://example.com/docs']);
  });

  // A press-and-drag that starts on a link is a selection gesture, not a click
  // — opening from the mousedown hijacked it and left nothing selected, which
  // is the friction #8524 was built to remove.
  test('drag-selecting from a link selects text instead of opening it', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('drag select task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('drag select task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('read [the docs](https://example.com/docs) carefully');
    await editor.blur();

    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = (url?: string | URL): null => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      };
    });

    const link = notes.locator('.cm-md-link').first();
    const box = (await link.boundingBox())!;
    const halfHeight = box.height / 2;
    const midY = box.y + halfHeight;
    await page.mouse.move(box.x + 2, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 40, midY, { steps: 8 });
    await page.mouse.up();

    expect(
      await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
    ).toEqual([]);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe(
      '',
    );
  });

  // Escape and Ctrl+Enter left the notes field on the textarea path. Without a
  // binding the only way out of a contenteditable is Tab.
  test('Escape and Ctrl+Enter leave the notes field', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('keyboard exit task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('keyboard exit task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    const isInEditor = (): Promise<boolean> =>
      page.evaluate(() =>
        Boolean(document.activeElement?.classList.contains('cm-content')),
      );
    // Leaving the editor hands focus back to the detail panel's notes item —
    // 150ms later, via its task-guarded focus. Waiting for that settled state
    // (rather than just "not the editor") keeps the panel from grabbing focus
    // in the middle of the next gesture.
    const activeTag = (): Promise<string> =>
      page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '');

    // Polled, not sampled: focus lands a tick after the click, and under a
    // loaded parallel run that tick is not free.
    await editor.click();
    await expect.poll(isInEditor).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(activeTag).toBe('task-detail-item');

    await editor.click();
    await expect.poll(isInEditor).toBe(true);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(activeTag).toBe('task-detail-item');
  });

  // `![alt](src =WxH)` is the app's own sizing syntax; CommonMark cannot parse
  // it, so without help it renders as raw source in every note that uses it.
  test('renders the app image-sizing syntax', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('sized image task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('sized image task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('![an icon](assets/icons/favicon-32x32.png =16x16)');
    await editor.blur();

    const img = notes.locator('img.cm-md-image');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('width', '16');
    await expect(img).toHaveAttribute('height', '16');
  });

  // The checklist toolbar is the one control that edits the document from
  // outside the editor, and it reads the live document rather than the last
  // committed note — keying off the committed copy hid the actions menu for the
  // whole time you were typing the checklist.
  test('offers checklist actions while a checklist is still being typed', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('checklist toolbar task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('checklist toolbar task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('- [ ] one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [x] two');

    // Still focused, nothing committed yet.
    const actionsBtn = notes
      .locator('button')
      .filter({ has: page.locator('mat-icon', { hasText: 'playlist_add_check' }) });
    await expect(actionsBtn).toBeVisible();

    await actionsBtn.click();
    await page
      .locator('.mat-mdc-menu-panel button')
      .filter({ has: page.locator('mat-icon', { hasText: 'done_all' }) })
      .click();
    // The menu's overlay backdrop swallows clicks until it is gone.
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);

    // "Check all" rewrote the source: both items are checked, and it survives
    // a close/reopen, so it went through the normal commit path.
    await expect(notes.locator('.cm-md-task-checkbox')).toHaveCount(2);
    const task = taskPage.getTaskByText('checklist toolbar task');
    await task.locator(DETAIL_PANEL_BTN).click();
    await expect(page.locator(DETAIL_PANEL)).not.toBeVisible();
    // Once the notes hold a checklist the row swaps the plain notes toggle for
    // the progress badge, so reopen through that (see `isShowToggleButton`).
    await task.hover();
    await task.locator('.checklist-progress-btn').click();

    const reopened = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    await reopened.locator('.cm-content').waitFor({ state: 'visible' });
    await expect(reopened.locator('.cm-md-task-checkbox')).toHaveText([
      'check_box',
      'check_box',
    ]);
  });

  // The regex src stops at the first `)`, which silently truncated a legal
  // balanced-paren destination into a broken image with the source hidden
  // behind the widget. The parsed URL node is used instead.
  test('keeps an image destination that contains parentheses', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('paren image task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('paren image task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('![ico](assets/icons/favicon-32x32.png?a=(b))');
    await editor.blur();

    const img = notes.locator('img.cm-md-image');
    await expect(img).toHaveAttribute('src', 'assets/icons/favicon-32x32.png?a=(b)');
  });

  test('renders an image inline', async ({ page, workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('image note task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('image note task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    // A bundled asset stands in for a pasted image: the src resolver only
    // rewrites the app's own indexeddb:// URLs and passes anything else through.
    await editor.click();
    await page.keyboard.type('![an icon](assets/icons/favicon-32x32.png)');
    await editor.blur();

    const img = notes.locator('img.cm-md-image');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'an icon');
    // Visible AND actually decoded — a broken src would still be "visible".
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('opens fullscreen with a single editor and no preview toggle', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('fullscreen live markdown task');
    await taskPage.openTaskDetail(
      taskPage.getTaskByText('fullscreen live markdown task'),
    );

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    await notes.locator('.cm-content').waitFor({ state: 'visible' });

    // The controls are opacity:0 until the notes area is hovered.
    await notes.hover();
    await notes
      .locator('button')
      .filter({ has: page.locator('mat-icon', { hasText: 'fullscreen' }) })
      .first()
      .click();

    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator('.cm-content')).toBeVisible();
    // The EDIT / SPLIT / PARSED toggle is gone: the live editor is all three.
    await expect(dialog.locator('mat-button-toggle-group')).toHaveCount(0);
  });
});
