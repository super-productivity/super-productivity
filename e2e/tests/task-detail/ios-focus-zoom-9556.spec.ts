import { Locator, Page } from 'playwright/test';

import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issues #9415, #9551, #9556: on iOS, tapping the tag field in a task's detail
 * panel zoomed the whole page and left the tag autocomplete misaligned.
 *
 * iOS zooms the page whenever the focused form control's computed font-size is
 * below 16px, and only restores the scale on blur. That was suppressed app-wide
 * by `user-scalable=no` in the viewport meta until #9272 deliberately dropped it
 * to restore pinch-zoom (shipped in v18.16.0) — which surfaced the zoom on every
 * bare input that is not inside a mat-form-field (those resolve to 16px via
 * --mat-form-field-container-text-size).
 *
 * The zoom itself is a WebKit behavior and cannot be reproduced in Chromium, so
 * these pin the invariant it keys off instead: every focusable text control
 * reachable from the detail panel must compute to >= 16px. That is exactly what
 * regressed — verified to fail against the pre-fix stylesheets.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/ios-focus-zoom-9556.spec.ts -- --retries=0
 */

const IOS_ZOOM_THRESHOLD_PX = 16;

const getFontSizePx = async (page: Page, selector: string): Promise<number> => {
  const raw = await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
  return parseFloat(raw);
};

const openTaskDetailPanel = async (
  page: Page,
  workViewPage: {
    waitForTaskList: () => Promise<void>;
    addTask: (t: string) => Promise<void>;
  },
  taskPage: { getTaskByText: (t: string) => Locator },
  title: string,
): Promise<Locator> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title);
  await task.hover();
  await page.getByRole('button', { name: 'Show/hide task panel' }).click();
  return task;
};

// Mirrors WorkViewPage.addSubTask: the 'a' shortcut only lands once focus has
// actually settled on the task, so verify and retry rather than assuming.
const openSubTaskDraft = async (page: Page, task: Locator): Promise<void> => {
  await task.focus();
  await page.waitForTimeout(200);
  const isFocused = await task.evaluate(
    (el) => el === document.activeElement || el.contains(document.activeElement),
  );
  if (!isFocused) {
    await task.focus();
    await page.waitForTimeout(200);
  }
  await task.press('a');
  await page
    .locator('.e2e-add-subtask-input')
    .waitFor({ state: 'visible', timeout: 5000 });
};

test.describe('Task detail iOS focus zoom', () => {
  test('should keep detail panel inputs at or above the iOS zoom threshold', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const task = await openTaskDetailPanel(
      page,
      workViewPage,
      taskPage,
      'zoom threshold task',
    );

    // Tag field — the control all three issues named.
    await page.locator('tag-edit input').waitFor({ state: 'visible' });
    expect(await getFontSizePx(page, 'tag-edit input')).toBeGreaterThanOrEqual(
      IOS_ZOOM_THRESHOLD_PX,
    );

    // Add-subtask field — same panel, same gesture, same defect.
    await openSubTaskDraft(page, task);
    expect(await getFontSizePx(page, '.e2e-add-subtask-input')).toBeGreaterThanOrEqual(
      IOS_ZOOM_THRESHOLD_PX,
    );

    // The panel title is not asserted. `.task-title` is 17px below 600px, so
    // phones already clear the threshold; its >=600px rule stays at 15px, so a
    // touch tablet can still trip the zoom there. Knowingly left — raising it
    // would change desktop for a case nobody has reported. Reading it here
    // would also need a viewport resize mid-test, which reports transitional
    // values before the layout settles.
  });

  // Controls with a non-focusable display counterpart (rendered markdown, the
  // static title) are raised only under `isTouchPrimary`, so both layers move
  // together and desktop keeps its 14px. Forcing the class is what a phone
  // would set via InputIntentService.
  test('should raise editor/display pairs above the threshold on touch', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await openTaskDetailPanel(page, workViewPage, taskPage, 'touch zoom task');

    await page.locator('inline-markdown .markdown-parsed').first().waitFor();
    await page.evaluate(() => {
      document.body.classList.remove('isMousePrimary');
      document.body.classList.add('isTouchPrimary');
    });

    // Polled rather than read once: these elements carry a font-size
    // transition, so an immediate read catches an intermediate value. A real
    // phone sets isTouchPrimary at startup, long before any field is focused,
    // so the transition only exists in this test.
    //
    // Task description. Asserted on the rendered half, not the textarea: both
    // are raised by a single `.markdown-unparsed, .markdown-parsed` declaration
    // in inline-markdown.component.scss, so this covers the focusable half too,
    // and opening the editor needs a click sequence through an animating
    // expansion panel that proved flaky. Keep the two selectors in one
    // declaration or this stops covering the textarea.
    await expect
      .poll(() => getFontSizePx(page, 'inline-markdown .markdown-parsed'))
      .toBeGreaterThanOrEqual(IOS_ZOOM_THRESHOLD_PX);

    // Task title in a list row — the most frequent inline edit on mobile.
    await expect
      .poll(() => getFontSizePx(page, 'task task-title'))
      .toBeGreaterThanOrEqual(IOS_ZOOM_THRESHOLD_PX);
  });
});
