import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';

// Move to top/bottom for subtasks via keyboard and context menu (#9460, #6650),
// and via context menu for top-level tasks in the project backlog.

const seedParentWithSubTasks = async (
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
  parentTitle: string,
): Promise<{ parent: Locator; subTasks: Locator }> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(parentTitle);
  const parent = taskPage.getTaskByText(parentTitle);

  await workViewPage.addSubTask(parent, 'Sub A');
  await workViewPage.addSubTask(parent, 'Sub B');
  await workViewPage.addSubTask(parent, 'Sub C');

  const subTasks = taskPage.getSubTasks(parent);
  await expect(subTasks).toHaveCount(3);
  await expect(subTasks.locator('task-title')).toHaveText([/Sub A/, /Sub B/, /Sub C/]);
  return { parent, subTasks };
};

const clickContextMenuItem = async (page: Page, name: RegExp): Promise<void> => {
  const menu = page.locator('.mat-mdc-menu-panel');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name }).click();
};

test.describe('Subtask move to top/bottom', () => {
  test('moves focused subtask to top and bottom of siblings via keyboard', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const { subTasks } = await seedParentWithSubTasks(
      workViewPage,
      taskPage,
      `${testPrefix}-Parent`,
    );

    const subC = subTasks.filter({ hasText: 'Sub C' });
    await subC.focus();
    await expect(subC).toBeFocused();

    await page.keyboard.press('Control+Alt+ArrowUp');
    await expect(subTasks.locator('task-title')).toHaveText([/Sub C/, /Sub A/, /Sub B/]);

    // the component re-focuses the moved task asynchronously
    await expect(subC).toBeFocused();
    await page.keyboard.press('Control+Alt+ArrowDown');
    await expect(subTasks.locator('task-title')).toHaveText([/Sub A/, /Sub B/, /Sub C/]);
  });

  test('moves a subtask to top and bottom of siblings via the context menu', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const { subTasks } = await seedParentWithSubTasks(
      workViewPage,
      taskPage,
      `${testPrefix}-Parent`,
    );

    const subC = subTasks.filter({ hasText: 'Sub C' });
    await subC.locator('task-title').click({ button: 'right' });
    await clickContextMenuItem(page, /move to top/i);
    await expect(subTasks.locator('task-title')).toHaveText([/Sub C/, /Sub A/, /Sub B/]);

    await subC.locator('task-title').click({ button: 'right' });
    await clickContextMenuItem(page, /move to bottom/i);
    await expect(subTasks.locator('task-title')).toHaveText([/Sub A/, /Sub B/, /Sub C/]);
  });

  test('moves a backlog task to the bottom of the backlog via the context menu', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    // tasks land in the default Inbox project
    await workViewPage.addTask('BL One');
    await workViewPage.addTask('BL Two');
    await workViewPage.addTask('BL Three');

    // Enable the backlog and move the just-created tasks into it via the store
    // (there is no UI shortcut for bulk-seeding backlog state).
    await page.evaluate(() => {
      type EntityState = {
        ids: string[];
        entities: Record<string, { taskIds: string[] }>;
      };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              dispatch: (a: unknown) => void;
              subscribe: (fn: (v: unknown) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store;
      let rootState!: Record<string, EntityState>;
      store
        .subscribe((v) => {
          rootState = v as Record<string, EntityState>;
        })
        .unsubscribe();

      for (const pid of rootState.projects.ids) {
        const project = rootState.projects.entities[pid];
        if (!project.taskIds.length) {
          continue;
        }
        store.dispatch({
          type: '[Project] Update Project',
          project: {
            id: pid,
            changes: {
              isEnableBacklog: true,
              backlogTaskIds: project.taskIds,
              taskIds: [],
            },
          },
        });
      }
    });

    // hash-only navigation to the Inbox project page (no full page reload, so
    // the dispatched state stays live); backlogPos=50 opens the backlog split
    await page.goto('/#/project/INBOX_PROJECT/tasks?backlogPos=50');

    const backlog = page.locator('.backlog');
    await expect(backlog).toBeVisible();

    const backlogTasks = backlog.locator('task');
    await expect(backlogTasks).toHaveCount(3);

    const firstTitle = await backlogTasks.first().locator('task-title').innerText();
    await backlogTasks.first().locator('task-title').click({ button: 'right' });
    await clickContextMenuItem(page, /move to bottom/i);

    await expect(backlogTasks.last().locator('task-title')).toHaveText(firstTitle);
    await expect(backlogTasks.first().locator('task-title')).not.toHaveText(firstTitle);
  });
});
