import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';

/**
 * Every bulk action of the multi-select bar, driven through the real menu, so
 * each one is proven against the app (not the dispatched action). Also the
 * bulk-menu entry points on a selected row and the selection lifecycle.
 */

const BAR = 'task-multi-select-bar .bar';
const DONE_TASKS = '.task-list-inner[data-id="DONE"] > task.isDone';
const TODAY_ROUTE = '/#/tag/TODAY/tasks';

const menuItem = (page: Page, text: string | RegExp): Locator =>
  page.locator('.mat-mdc-menu-content button', { hasText: text });

const openActions = async (page: Page): Promise<void> => {
  await page.locator(BAR).getByRole('button', { name: 'Actions' }).click();
  await waitForMenuSettled(page);
};

/** Opens a submenu of the bulk menu (Estimate / Toggle tags / Move to project). */
const openSubmenu = async (page: Page, text: string | RegExp): Promise<void> => {
  await menuItem(page, text).click();
  await page.locator('.mat-mdc-menu-panel').nth(1).waitFor({ state: 'visible' });
  await waitForMenuSettled(page);
};

/** Closes an open bulk menu (and its submenu) without a keypress reaching a row. */
const closeMenus = async (page: Page): Promise<void> => {
  for (let i = 0; i < 3 && (await page.locator('.mat-mdc-menu-panel').count()); i++) {
    await page
      .locator('.cdk-overlay-backdrop')
      .last()
      .click({ position: { x: 4, y: 4 }, force: true });
    await page
      .locator('.mat-mdc-menu-panel')
      .first()
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
  }
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

const addTasks = async (
  workViewPage: WorkViewPage,
  testPrefix: string,
  names: string[],
): Promise<string[]> => {
  const titles = names.map((n) => `${testPrefix}-${n}`);
  for (const title of titles) {
    await workViewPage.addTask(title);
  }
  return titles;
};

const ctrlSelect = async (taskPage: TaskPage, titles: string[]): Promise<void> => {
  for (const title of titles) {
    const task = taskPage.getTaskByText(title);
    // A row leaving another list animates out; wait for the single live one.
    await expect(task).toHaveCount(1);
    await task.click({ modifiers: ['Control'] });
  }
};

test.describe('Task multi-select bulk actions', () => {
  test('marks the selection done and not done again from the menu', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Done A', 'Done B']);
    const bar = page.locator(BAR);
    await ctrlSelect(taskPage, titles);
    await expect(bar).toContainText('2 selected');

    await openActions(page);
    await menuItem(page, 'Mark as completed').click();
    await expect(page.locator(DONE_TASKS)).toHaveCount(2);
    // The selection follows the rows into the done list.
    await expect(bar).toContainText('2 selected');

    await openActions(page);
    await menuItem(page, 'Mark as not completed').click();
    await expect(page.locator(DONE_TASKS)).toHaveCount(0);
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).not.toHaveClass(/isDone/);
    }
  });

  test('marking a parent and its subtask done applies once to the parent', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const [parentTitle] = await addTasks(workViewPage, testPrefix, ['Parent']);
    const parent = taskPage.getTaskByText(parentTitle);
    await workViewPage.addSubTask(parent, `${testPrefix}-Child`);
    const child = parent.locator('.sub-tasks task').filter({ hasText: 'Child' });
    await expect(child).toHaveCount(1);

    await parent
      .locator('task-title')
      .first()
      .click({ modifiers: ['Control'] });
    await child.click({ modifiers: ['Control'] });
    await expect(page.locator(BAR)).toContainText('2 selected');

    await openActions(page);
    await menuItem(page, 'Mark as completed').click();
    await expect(page.locator(DONE_TASKS).filter({ hasText: parentTitle })).toHaveCount(
      1,
    );
    await expect(
      page.locator(`${DONE_TASKS} .sub-tasks task.isDone`).filter({ hasText: 'Child' }),
    ).toHaveCount(1);
  });

  test('schedules the selection for tomorrow through the dialog', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await page.goto(TODAY_ROUTE);
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Sched A', 'Sched B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    // Case-sensitive so that "Unschedule task" does not match.
    await menuItem(page, /Schedule task/).click();
    const dialog = page.locator('dialog-schedule-task');
    await expect(dialog).toBeVisible();
    // Quick-access buttons: today, tomorrow, next week, next month (submit on click).
    await dialog.locator('datetime-picker button').nth(1).click();
    await expect(dialog).toBeHidden();

    // Scheduled for tomorrow, the tasks leave the Today list.
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(0);
    }
    await expect(page.locator(BAR)).toBeHidden();
    await page.goto('/#/planner');
    for (const title of titles) {
      await expect(page.locator('planner-task').filter({ hasText: title })).toHaveCount(
        1,
      );
    }
  });

  test('unschedules the selection out of the Today list', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await page.goto(TODAY_ROUTE);
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Unsched A', 'Unsched B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    await menuItem(page, 'Unschedule task').click();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(0);
    }
    await expect(page.locator(BAR)).toBeHidden();
  });

  test('adds a project selection to Today and clears on navigation', async ({
    page,
    workViewPage,
    taskPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Proj A', 'Proj B']);
    const bar = page.locator(BAR);
    await ctrlSelect(taskPage, titles);
    await expect(bar).toContainText('2 selected');

    await openActions(page);
    await menuItem(page, 'Add to Today').click();
    // Still in the project view; the rows stay, so the selection stays.
    await expect(bar).toContainText('2 selected');

    await page.goto(TODAY_ROUTE);
    await workViewPage.waitForTaskList();
    await expect(bar).toBeHidden();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(1);
    }
  });

  test('sets and removes a deadline on the selection', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Dead A', 'Dead B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    await menuItem(page, 'Deadline').click();
    const dialog = page.locator('dialog-deadline');
    await expect(dialog).toBeVisible();
    await dialog.locator('datetime-picker button').nth(1).click();
    await expect(dialog).toBeHidden();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title).locator('.deadline-btn')).toHaveCount(1);
    }

    await openActions(page);
    await menuItem(page, 'Remove deadline').click();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title).locator('.deadline-btn')).toHaveCount(0);
    }
  });

  test('sets and clears the time estimate of the selection', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Est A', 'Est B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    await openSubmenu(page, 'Estimate');
    await menuItem(page, '1h').click();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title).locator('.time-val')).toContainText(
        '1h',
      );
    }

    await openActions(page);
    await openSubmenu(page, 'Estimate');
    await menuItem(page, 'Clear estimate').click();
    for (const title of titles) {
      await expect(
        taskPage.getTaskByText(title).locator('.time-wrapper.hasNoTimeSpentOrEstimate'),
      ).toHaveCount(1);
    }
  });

  test('toggles a tag on and off for the selection', async ({
    page,
    workViewPage,
    taskPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const tagName = `${testPrefix}-BulkTag`;
    await tagPage.createTag(tagName);
    const titles = await addTasks(workViewPage, testPrefix, ['Tag A', 'Tag B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    await openSubmenu(page, /toggle tags/i);
    await menuItem(page, tagName).click();
    await closeMenus(page);
    for (const title of titles) {
      await expect(
        tagPage.getTagOnTask(taskPage.getTaskByText(title), tagName),
      ).toHaveCount(1);
    }

    await openActions(page);
    await openSubmenu(page, /toggle tags/i);
    await menuItem(page, tagName).click();
    await closeMenus(page);
    for (const title of titles) {
      await expect(
        tagPage.getTagOnTask(taskPage.getTaskByText(title), tagName),
      ).toHaveCount(0);
    }
  });

  test('moves the selection to another project', async ({
    page,
    workViewPage,
    taskPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Move A', 'Move B']);
    await ctrlSelect(taskPage, titles);

    await openActions(page);
    await openSubmenu(page, 'Move to project');
    await menuItem(page, 'Inbox').click();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(0);
    }
    await expect(page.locator(BAR)).toBeHidden();

    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(1);
    }
  });

  test('moves the selection to the backlog and back', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Back A', 'Back B']);

    // Enable the backlog of the Inbox project (no UI shortcut for that).
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers.store;
      store.dispatch({
        type: '[Project] Update Project',
        project: { id: 'INBOX_PROJECT', changes: { isEnableBacklog: true } },
      });
    });
    await page.goto('/#/project/INBOX_PROJECT/tasks?backlogPos=50');
    await workViewPage.waitForTaskList();
    const backlog = page.locator('.backlog');
    await expect(backlog).toBeVisible();
    await expect(backlog.locator('task')).toHaveCount(0);

    await ctrlSelect(taskPage, titles);
    await openActions(page);
    await menuItem(page, 'Move to backlog').click();
    await expect(backlog.locator('task')).toHaveCount(2);

    // The selection follows the rows into the backlog list.
    await expect(page.locator(BAR)).toContainText('2 selected');
    for (const title of titles) {
      await expect(backlog.locator('task').filter({ hasText: title })).toHaveClass(
        /isMultiSelected/,
      );
    }
    await openActions(page);
    await menuItem(page, 'Move to regular list').click();
    await expect(backlog.locator('task')).toHaveCount(0);
    for (const title of titles) {
      await expect(taskPage.getTaskByText(title)).toHaveCount(1);
    }
  });

  test('right-click and Q on a selected row open the bulk menu', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Menu A', 'Menu B']);
    await ctrlSelect(taskPage, titles);
    const menuTitle = page.locator('.mat-mdc-menu-content .menu-title');

    await taskPage.getTaskByText(titles[0]).click({ button: 'right' });
    await expect(menuTitle).toHaveText(/2 tasks/);
    await page.keyboard.press('Escape');
    await expect(menuTitle).toHaveCount(0);

    const second = taskPage.getTaskByText(titles[1]);
    await second.focus();
    await expect(second).toBeFocused();
    await page.keyboard.press('q');
    await expect(menuTitle).toHaveText(/2 tasks/);
    await page.keyboard.press('Escape');
    await expect(page.locator(BAR)).toContainText('2 selected');
  });

  test('Shift+ArrowDown extends the selection from the focused row', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, ['Ext A', 'Ext B', 'Ext C']);
    // Newest first: C is on top.
    const top = taskPage.getTaskByText(titles[2]);
    await top.focus();
    await expect(top).toBeFocused();
    // Extension is throttled to one step per 100ms (key auto-repeat); the
    // key-hold delay keeps successive presses apart like real keystrokes.
    await page.keyboard.press('Shift+ArrowDown', { delay: 150 });
    await expect(page.locator(BAR)).toContainText('2 selected');
    await page.keyboard.press('Shift+ArrowDown', { delay: 150 });
    await expect(page.locator(BAR)).toContainText('3 selected');
    await expect(taskPage.getTaskByText(titles[0])).toBeFocused();
    await page.keyboard.press('Shift+ArrowUp', { delay: 150 });
    await expect(page.locator(BAR)).toContainText('2 selected');
  });

  test('keyboard focus lands on the next row after the selection leaves the list', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, [
      'Focus A',
      'Focus B',
      'Focus C',
    ]);
    // Newest first: C, B, A. Select C and B; the last click leaves focus on B.
    await ctrlSelect(taskPage, [titles[2], titles[1]]);
    await expect(taskPage.getTaskByText(titles[1])).toBeFocused();

    await page.keyboard.press('d');
    await expect(page.locator(DONE_TASKS)).toHaveCount(2);
    // Focus must not fall to <body> once the rows' leave animation ends.
    await expect(taskPage.getTaskByText(titles[0])).toBeFocused();
    await expect(page.locator('body')).not.toBeFocused();
  });

  test('a bulk key on a focused unselected row acts on that row alone', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const titles = await addTasks(workViewPage, testPrefix, [
      'Alone A',
      'Alone B',
      'Alone C',
    ]);
    await ctrlSelect(taskPage, [titles[0], titles[1]]);
    const bar = page.locator(BAR);
    await expect(bar).toContainText('2 selected');

    const other = taskPage.getTaskByText(titles[2]);
    await other.focus();
    await expect(other).toBeFocused();
    await page.keyboard.press('d');
    await expect(page.locator(DONE_TASKS)).toHaveCount(1);
    await expect(page.locator(DONE_TASKS).filter({ hasText: titles[2] })).toHaveCount(1);
    await expect(bar).toBeHidden();
  });
});
