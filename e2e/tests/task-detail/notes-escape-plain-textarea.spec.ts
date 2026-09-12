import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL } = cssSelectors;

/**
 * With "Enable Markdown formatting in task notes" OFF, notes are a plain
 * textarea instead of the live editor the #9910 suite covers — and that
 * textarea is mounted unconditionally (`@else if (isShowEdit() ||
 * !isMarkdownFormattingEnabled())`), so `untoggleShowEdit()` leaves it on
 * screen and focused.
 *
 * Leaving it therefore depends on two pieces agreeing: `keypressHandler` blurs
 * the field (#10080) and the panel's deferred `focusItem(noteWrapperElRef)`
 * then hands focus to the notes item — which it declines to do while a text
 * field still owns focus (#10079). Drop either half and Escape strands the
 * caret in the field it was meant to leave, with no keyboard way out but Tab:
 * a second Escape cannot help, since `task-detail-item` ignores keydown coming
 * from an input.
 *
 * That combination shipped broken once because every notes focus test drives
 * the live editor. This is the end-to-end pin for the other configuration.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/notes-escape-plain-textarea.spec.ts -- --retries=0
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

test.describe('Notes without markdown formatting', () => {
  test('Escape leaves the plain textarea', async ({ page, workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await disableMarkdownFormatting(page);

    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('plain notes task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('plain notes task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const textarea = notes.locator('textarea');
    await textarea.waitFor({ state: 'visible' });
    await textarea.click();
    await page.keyboard.type('a plain note');

    await page.keyboard.press('Escape');

    // Focus must end up on the panel's notes item, not stay in the textarea.
    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? ''),
        { timeout: 5000 },
      )
      .toBe('task-detail-item');
  });
});
