import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * Task multi-select, desktop entry methods: modifier clicks, X, Ctrl+A, Esc,
 * the bulk shortcut allowlist and the bar's Actions menu.
 */

const BAR = 'task-multi-select-bar .bar';
const DONE_TASKS = '.task-list-inner[data-id="DONE"] > task.isDone';

test.describe('Task multi-select (desktop)', () => {
  test('Ctrl+click and Shift+click build a selection that D completes at once', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = ['Multi A', 'Multi B', 'Multi C'].map((t) => `${testPrefix}-${t}`);
    for (const title of titles) {
      await workViewPage.addTask(title);
    }
    const [a, b, c] = titles.map((t) => taskPage.getTaskByText(t));
    const bar = page.locator(BAR);
    await expect(bar).toBeHidden();

    await a.click({ modifiers: ['Control'] });
    await expect(bar).toContainText('1 selected');
    await expect(a).toHaveClass(/isMultiSelected/);

    // Shift+click ranges from the anchor to the target.
    await c.click({ modifiers: ['Shift'] });
    await expect(bar).toContainText('3 selected');
    await expect(b).toHaveClass(/isMultiSelected/);

    // Ctrl+click removes one again.
    await b.click({ modifiers: ['Control'] });
    await expect(bar).toContainText('2 selected');
    await expect(b).not.toHaveClass(/isMultiSelected/);

    // A bulk shortcut on a focused *selected* row acts on the whole selection
    // (a focused unselected row would act alone, so refocus a selected one).
    await expect(b).toBeFocused();
    await c.focus();
    await expect(c).toBeFocused();
    await page.keyboard.press('d');
    await expect(page.locator(DONE_TASKS)).toHaveCount(2);
    await expect(page.locator(DONE_TASKS).filter({ hasText: titles[1] })).toHaveCount(0);
    // The selection survives the move to the done list (rows re-render there).
    await expect(bar).toContainText('2 selected');
    await expect(page.locator(`${DONE_TASKS}.isMultiSelected`)).toHaveCount(2);
    await bar.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar).toBeHidden();
  });

  test('X toggles the focused task, Ctrl+A selects its list and Escape clears', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-Key One`;
    const second = `${testPrefix}-Key Two`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);
    const task = taskPage.getTaskByText(first);
    const bar = page.locator(BAR);

    await task.focus();
    await expect(task).toBeFocused();
    await page.keyboard.press('x');
    await expect(bar).toContainText('1 selected');
    await expect(task).toHaveClass(/isMultiSelected/);

    await page.keyboard.press('x');
    await expect(bar).toBeHidden();

    await page.keyboard.press('Control+a');
    await expect(bar).toContainText('2 selected');

    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(page.locator('task.isMultiSelected')).toHaveCount(0);
  });

  test('a plain click selects that task only and the bar disappears', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-Plain One`;
    const second = `${testPrefix}-Plain Two`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);
    const a = taskPage.getTaskByText(first);
    const b = taskPage.getTaskByText(second);
    const bar = page.locator(BAR);

    await a.click({ modifiers: ['Control'] });
    await b.click({ modifiers: ['Control'] });
    await expect(bar).toContainText('2 selected');

    await a.click();
    await expect(bar).toBeHidden();
    await expect(page.locator('task.isMultiSelected')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('the Actions menu deletes the selection after one confirmation', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const keep = `${testPrefix}-Keep Me`;
    const gone = ['Gone One', 'Gone Two'].map((t) => `${testPrefix}-${t}`);
    await workViewPage.addTask(keep);
    for (const title of gone) {
      await workViewPage.addTask(title);
    }
    const bar = page.locator(BAR);

    await taskPage.getTaskByText(gone[0]).click({ modifiers: ['Control'] });
    await taskPage.getTaskByText(gone[1]).click({ modifiers: ['Control'] });
    await expect(bar).toContainText('2 selected');

    await bar.getByRole('button', { name: 'Actions' }).click();
    await waitForMenuSettled(page);
    await page
      .locator('.mat-mdc-menu-content button', { hasText: 'Delete task' })
      .click();

    await dialogPage.waitForDialog();
    await dialogPage.clickDialogButton('Delete');
    await dialogPage.waitForDialogToClose();

    await expect(taskPage.getTaskByText(gone[0])).toHaveCount(0);
    await expect(taskPage.getTaskByText(gone[1])).toHaveCount(0);
    await expect(taskPage.getTaskByText(keep)).toHaveCount(1);
    await expect(bar).toBeHidden();
  });
});
