import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import { type TaskPage } from '../../pages/task.page';
import { type WorkViewPage } from '../../pages/work-view.page';

const { DETAIL_PANEL, DETAIL_PANEL_BTN } = cssSelectors;

/**
 * Issue #10405: a note edit was lost when switching to another task straight
 * from the note editor. CodeMirror reports blur 10ms late, and the save rides
 * on that blur — a quick click on another task re-pointed the detail panel at
 * that task first, so the editor's document was replaced before it committed.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/note-kept-on-task-switch-10405.spec.ts -- --retries=0
 */

const EDITED_NOTE = 'edited note of task A';

const notesEditor = (page: Page): Locator =>
  page.locator(DETAIL_PANEL).locator('inline-markdown').first().locator('.cm-content');

// TaskPage.openTaskDetail looks the toggle up page-wide, which is ambiguous
// once a second row is hovered or selected; scope it to the row instead.
const selectTask = async (page: Page, task: Locator, title: string): Promise<void> => {
  await task.hover();
  await task.locator(DETAIL_PANEL_BTN).click();
  await expect(page.locator(DETAIL_PANEL)).toContainText(title);
};

const replaceNote = async (page: Page, text: string): Promise<void> => {
  const editor = notesEditor(page);
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  // Fresh tasks hold the stock notes template; replace it.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
};

/** Task B holds a checklist note; task A ends up selected in the detail panel. */
const setUpTasks = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
): Promise<{ taskA: Locator; taskB: Locator }> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Task B 10405');
  await workViewPage.addTask('Task A 10405');
  const taskA = taskPage.getTaskByText('Task A 10405').first();
  const taskB = taskPage.getTaskByText('Task B 10405').first();

  await selectTask(page, taskB, 'Task B 10405');
  await replaceNote(page, '- [ ] checklist item');
  await notesEditor(page).blur();

  await selectTask(page, taskA, 'Task A 10405');
  // Only shown while the row is not selected (the close button takes its place).
  await expect(taskB.locator('.checklist-progress-btn')).toBeVisible();
  return { taskA, taskB };
};

const expectEditKeptOnTaskA = async (page: Page, taskA: Locator): Promise<void> => {
  // Re-select task A and read its note back from the store-driven panel.
  await selectTask(page, taskA, 'Task A 10405');
  await expect(notesEditor(page)).toContainText(EDITED_NOTE);
};

test.describe('Note edit survives a task switch (#10405)', () => {
  test('keeps the edit when clicking another task’s checklist progress button', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const { taskA, taskB } = await setUpTasks(page, workViewPage, taskPage);

    await replaceNote(page, EDITED_NOTE);
    // Straight from the editor, no blur first; a 0ms click is the losing race.
    await taskB.locator('.checklist-progress-btn').click({ delay: 0 });
    await expect(page.locator(DETAIL_PANEL)).toContainText('Task B 10405');
    // ...and the edit must not have been written onto task B either.
    await expect(notesEditor(page)).toContainText('checklist item');
    await expect(notesEditor(page)).not.toContainText(EDITED_NOTE);

    await expectEditKeptOnTaskA(page, taskA);
  });

  test('keeps the edit when clicking another task’s title', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const { taskA, taskB } = await setUpTasks(page, workViewPage, taskPage);

    await replaceNote(page, EDITED_NOTE);
    await taskB.locator('task-title').click({ delay: 0 });
    await expect(page.locator(DETAIL_PANEL)).toContainText('Task B 10405');
    await expect(notesEditor(page)).not.toContainText(EDITED_NOTE);

    await expectEditKeptOnTaskA(page, taskA);
  });
});
