import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';
import { createView } from '../../utils/view-helpers';
import { flushPendingWrites } from '../../utils/waits';

interface CarriedTask {
  id: string;
  projectId: string;
  repeatCfgId?: string;
  subTaskIds: string[];
  // Owner of the task's repeat config; null when the config is gone.
  repeatCfgProjectId: string | null;
  subTasks: { id: string; projectId: string; timeSpent: number }[];
}

const readCarriedTask = (page: Page, title: string): Promise<CarriedTask> =>
  page.evaluate((taskTitle) => {
    interface StoredTask {
      id: string;
      title: string;
      projectId: string;
      repeatCfgId?: string;
      subTaskIds: string[];
      timeSpent: number;
    }
    interface Root {
      tasks: { entities: Record<string, StoredTask> };
      taskRepeatCfg: { entities: Record<string, { projectId: string | null }> };
    }
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (f: (root: Root) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let root!: Root;
    store.subscribe((value) => (root = value)).unsubscribe();
    const task = Object.values(root.tasks.entities).find((t) =>
      t.title.endsWith(taskTitle),
    )!;
    const cfg = task.repeatCfgId
      ? root.taskRepeatCfg.entities[task.repeatCfgId]
      : undefined;
    return {
      id: task.id,
      projectId: task.projectId,
      repeatCfgId: task.repeatCfgId,
      subTaskIds: task.subTaskIds,
      repeatCfgProjectId: cfg ? cfg.projectId : null,
      subTasks: task.subTaskIds.map((id) => ({
        id,
        projectId: root.tasks.entities[id].projectId,
        timeSpent: root.tasks.entities[id].timeSpent,
      })),
    };
  }, title);

test.describe('Completing a project with recurring work', () => {
  test('keeps recurrence owned by another project after a board move', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Project A');
    await projectPage.createProject('Project B');
    await projectPage.navigateToProjectByName('Project B');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Borrowed routine');
    await taskPage.getTaskByText('Borrowed routine').focus();
    await page.keyboard.press('i');
    await openRecurDialog(page);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');
    const before = await readCarriedTask(page, 'Borrowed routine');
    expect(before.repeatCfgId).toBeTruthy();
    expect(before.repeatCfgProjectId).toBe(before.projectId);

    await expect(page.locator('task-detail-panel')).toBeHidden();

    // The board moves only the instance; its recurrence continues to belong to B.
    await createView(page, {
      title: `${testPrefix}-Project handoff`,
      layout: 'board',
      sections: ['Project B', 'Project A'].map((project) => ({
        title: project,
        rules: [{ rule: 'Project', projects: [`${testPrefix}-${project}`] }],
      })),
    });
    const panels = page.locator('board-panel');
    const source = panels.nth(0).locator('planner-task');
    const target = panels.nth(1).locator('planner-task');
    await expect(source).toContainText('Borrowed routine');
    await expect(target).toHaveCount(0);
    await source.focus();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(target).toContainText('Borrowed routine');
    await expect(source).toHaveCount(0);
    const moved = await readCarriedTask(page, 'Borrowed routine');
    expect(moved.projectId).not.toBe(before.projectId);
    expect(moved.repeatCfgProjectId).toBe(before.projectId);

    await projectPage.navigateToProjectByName('Project A');
    await workViewPage.waitForTaskList();
    await projectPage.openProjectContextMenu('Project A');
    await page
      .locator('.mat-mdc-menu-content button')
      .filter({ hasText: /complete project/i })
      .click();
    await page
      .locator('dialog-complete-resolve-tasks')
      .getByRole('button', { name: /move to inbox/i })
      .click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: /complete project/i })
      .click();
    const celebration = page.locator('dialog-project-complete');
    await expect(celebration).toBeVisible();
    await celebration.locator('.actions button').click();
    const after = await readCarriedTask(page, 'Borrowed routine');
    expect(after.projectId).toBe('INBOX_PROJECT');
    expect(after.repeatCfgProjectId).toBe(before.projectId);

    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    expect(await readCarriedTask(page, 'Borrowed routine')).toEqual({
      ...before,
      projectId: 'INBOX_PROJECT',
    });
  });

  test('moves the recurrence to the Inbox with the work, so deleting the project keeps it', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Completed source');
    await projectPage.navigateToProjectByName('Completed source');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Carry routine');
    const row = taskPage.getTaskByText('Carry routine');
    await workViewPage.addSubTask(row, 'Carry child 10m/1h');

    // Make it recurring.
    await row.focus();
    await page.keyboard.press('i');
    await openRecurDialog(page);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');
    const before = await readCarriedTask(page, 'Carry routine');
    expect(before.repeatCfgId).toBeTruthy();
    expect(before.repeatCfgProjectId).toBe(before.projectId);
    expect(before.subTasks[0].timeSpent).toBeGreaterThan(0);

    // Complete the project, moving unfinished work to the Inbox.
    await projectPage.openProjectContextMenu('Completed source');
    await page
      .locator('.mat-mdc-menu-content button')
      .filter({ hasText: /complete project/i })
      .click();
    await page
      .locator('dialog-complete-resolve-tasks')
      .getByRole('button', { name: /move to inbox/i })
      .click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: /complete project/i })
      .click();
    const celebration = page.locator('dialog-project-complete');
    await expect(celebration).toBeVisible();
    await celebration.locator('.actions button').click();
    await expect
      .poll(async () => (await readCarriedTask(page, 'Carry routine')).projectId)
      .toBe('INBOX_PROJECT');
    // A completed project's repeat configs make no new instances.
    expect((await readCarriedTask(page, 'Carry routine')).repeatCfgProjectId).toBe(
      'INBOX_PROJECT',
    );

    // Deleting the completed project deletes its repeat configs.
    await projectPage.archivedProjectsLink.click();
    await projectPage.reopenArchivedProject('Completed source');
    await projectPage.deleteProject('Completed source');
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();

    const after = await readCarriedTask(page, 'Carry routine');
    expect(after).toEqual({
      ...before,
      projectId: 'INBOX_PROJECT',
      repeatCfgProjectId: 'INBOX_PROJECT',
      subTasks: before.subTasks.map((subTask) => ({
        ...subTask,
        projectId: 'INBOX_PROJECT',
      })),
    });
  });
});
