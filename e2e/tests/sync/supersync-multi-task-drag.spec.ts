import type { Locator } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';
import {
  selectDragTasks,
  startTaskDrag,
  dropTaskDrag,
  createDragSection,
} from '../../utils/task-multi-drag';

test.describe('@supersync Multi-task drag', () => {
  test('multi-task section and project drag converges across clients and reloads', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let a: SimulatedE2EClient | undefined;
    let b: SimulatedE2EClient | undefined;
    try {
      const user = await createTestUser(testRunId);
      const config = getSuperSyncConfig(user);
      a = await createSimulatedClient(
        browser,
        baseURL || 'http://localhost:4242',
        'A',
        testRunId,
      );
      await a.workView.waitForTaskList();
      await a.sync.setupSuperSync(config);
      const projectA = new ProjectPage(a.page);
      await projectA.createProject('Drag target');
      await projectA.createProject('Drag source');
      await projectA.navigateToProjectByName('Drag source');
      const names = ['Group A', 'Group B'];
      for (const name of [...names, 'Keep']) await a.workView.addTask(name);
      await createDragSection(a.page, 'Left');
      await createDragSection(a.page, 'Right');
      const sourceUrl = a.page.url();
      await a.sync.syncAndWait();
      b = await createSimulatedClient(
        browser,
        baseURL || 'http://localhost:4242',
        'B',
        testRunId,
      );
      await b.workView.waitForTaskList();
      await b.sync.setupSuperSync(config);
      await b.sync.syncAndWait();
      await b.page.goto(sourceUrl);
      await b.workView.waitForTaskList();
      const section = (client: SimulatedE2EClient, title: string): Locator =>
        client.page
          .locator('.section-container')
          .filter({ has: client.page.locator('.collapsible-title', { hasText: title }) });
      const dragInto = async (title: string): Promise<void> => {
        await selectDragTasks(a!.page, names);
        await startTaskDrag(
          a!.page,
          a!.page.locator('task.isMultiSelected').first().locator('done-toggle'),
        );
        await dropTaskDrag(a!.page, section(a!, title).locator('task-list').first());
        await expect(section(a!, title).locator('task')).toHaveCount(2);
        await a!.sync.syncAndWait();
        await b!.sync.syncAndWait();
        await expect(section(b!, title).locator('task .task-title')).toHaveText(
          await section(a!, title).locator('task .task-title').allTextContents(),
        );
      };
      await dragInto('Left');
      await dragInto('Right');
      await expect(section(b, 'Left').locator('task')).toHaveCount(0);
      await selectDragTasks(a.page, names);
      await startTaskDrag(
        a.page,
        a.page.locator('task.isMultiSelected').first().locator('done-toggle'),
      );
      await dropTaskDrag(a.page, a.page.locator('.no-section task-list').first(), true);
      await expect(a.page.locator('.no-section task')).toHaveCount(3);
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();
      await expect(b.page.locator('.no-section task .task-title')).toHaveText(
        await a.page.locator('.no-section task .task-title').allTextContents(),
      );
      const rootTitles = await a.page
        .locator('.no-section task .task-title')
        .allTextContents();
      const keptTitle = rootTitles[2];
      const movedTitles = rootTitles.slice(0, 2);
      const target = a.page
        .locator('nav-item[data-project-id]')
        .filter({ hasText: 'Drag target' })
        .first();
      if (!(await target.isVisible()))
        await a.page
          .locator('nav-list-tree')
          .filter({ hasText: 'Projects' })
          .locator('nav-item button')
          .first()
          .click();
      await selectDragTasks(a.page, names);
      await startTaskDrag(
        a.page,
        a.page.locator('task.isMultiSelected').first().locator('done-toggle'),
      );
      await dropTaskDrag(a.page, target);
      await expect(a.page.locator('.no-section task .task-title')).toHaveText([
        keptTitle,
      ]);
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();
      await expect(b.page.locator('.no-section task .task-title')).toHaveText([
        keptTitle,
      ]);
      for (const client of [a, b]) {
        await new ProjectPage(client.page).navigateToProjectByName('Drag target');
        await expect(client.page.locator('task .task-title')).toHaveText(movedTitles);
        await client.page.reload();
        await client.workView.waitForTaskList();
        await expect(client.page.locator('task .task-title')).toHaveText(movedTitles);
      }
    } finally {
      if (a) await closeClient(a);
      if (b) await closeClient(b);
    }
  });
});
