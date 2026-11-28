import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import { flushPendingWrites } from '../../utils/waits';

const { DETAIL_PANEL } = cssSelectors;

/**
 * With "Enable Markdown formatting in task notes" off, notes are a plain
 * textarea whose Enter handler continues Markdown lists. The Enter that
 * confirms an IME candidate (Japanese, Chinese, Korean input) must be left to
 * the IME instead of starting a new list item.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/notes-ime-list.spec.ts -- --retries=0
 */

const disableMarkdownFormatting = async (page: Page): Promise<void> => {
  // Tab 1 is "Tasks"; the section class comes from the form cfg key.
  await page.goto('/#/config?tab=1');
  await page.waitForURL(/config/);

  const section = page.locator('.section-tasks collapsible').first();
  await section.waitFor({ state: 'visible', timeout: 10000 });
  await section.scrollIntoViewIfNeeded();
  const isExpanded = await section.evaluate((el: Element) =>
    el.classList.contains('isExpanded'),
  );
  if (!isExpanded) {
    await section.locator('.collapsible-header').click();
    await section
      .locator('.collapsible-panel')
      .waitFor({ state: 'visible', timeout: 5000 });
  }

  const toggle = section
    .locator('mat-checkbox, mat-slide-toggle')
    .filter({ hasText: 'Enable Markdown formatting in task notes' })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveClass(/checked/, { timeout: 5000 });
  await toggle.click();
  await expect(toggle).not.toHaveClass(/checked/, { timeout: 5000 });
};

const readNotes = (page: Page): Promise<(string | undefined)[]> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    return Object.values(state?.tasks.entities ?? {}).map((task) => task!.notes);
  });

for (const isFullscreen of [false, true]) {
  test(`confirming an IME candidate in a list keeps one item (${
    isFullscreen ? 'fullscreen' : 'inline'
  } plain notes)`, async ({ page, workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await disableMarkdownFormatting(page);
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('IME note');
    await taskPage.openTaskDetail(taskPage.getTaskByText('IME note'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    if (isFullscreen) {
      await notes
        .getByRole('button')
        .filter({ has: page.locator('mat-icon', { hasText: /^fullscreen$/ }) })
        .click();
    }
    const textarea = (
      isFullscreen ? page.locator('dialog-fullscreen-markdown') : notes
    ).locator('textarea');
    await textarea.click();
    // Replace the default notes template.
    await textarea.fill('');
    await page.keyboard.insertText('- ');

    // Chromium's IME emulation: the Enter that confirms the candidate is a
    // keydown with isComposing set, as with a real Japanese or Chinese IME.
    // Send it raw so no newline is typed, then commit the candidate text.
    const session = await page.context().newCDPSession(page);
    await session.send('Input.imeSetComposition', {
      text: '日本',
      selectionStart: 2,
      selectionEnd: 2,
    });
    for (const type of ['rawKeyDown', 'keyUp'] as const) {
      await session.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    }
    await session.send('Input.insertText', { text: '日本' });
    await session.detach();
    await page.keyboard.insertText('のメモ');
    await expect(textarea).toBeFocused();

    if (isFullscreen) {
      await page.locator('#T-save-note').click();
    } else {
      await textarea.blur();
    }
    await expect.poll(() => readNotes(page)).toEqual(['- 日本のメモ']);
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect.poll(() => readNotes(page)).toEqual(['- 日本のメモ']);
  });
}
