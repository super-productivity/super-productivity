import { expect, test } from '../../fixtures/test.fixture';
import type { Locator } from '@playwright/test';
import {
  selectDragTasks as select,
  startTaskDrag as startDrag,
  dropTaskDrag as drop,
  createDragSection as createSection,
} from '../../utils/task-multi-drag';

test.describe('Multi-task drag', () => {
  test('moves a group into a section, between sections, and back to root in order', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Drag source');
    await projectPage.navigateToProjectByName('Drag source');
    const names = ['A', 'B', 'Keep'].map((n) => testPrefix + '-' + n);
    for (const name of names) await workViewPage.addTask(name);
    await createSection(page, 'Left');
    await createSection(page, 'Right');
    const section = (name: string): Locator =>
      page
        .locator('.section-container')
        .filter({ has: page.locator('.collapsible-title', { hasText: name }) });
    const row = (name: string): Locator =>
      page
        .locator('task:not(.cdk-drag-preview)')
        .filter({ has: page.locator('task-title', { hasText: name }) })
        .first();
    await select(page, [names[0], names[1]]);
    const order = await page
      .locator('task.isMultiSelected .task-title')
      .allTextContents();
    await startDrag(page, row(names[0]).locator('done-toggle'));
    await expect(page.locator('.multi-task-drag-preview')).toContainText('2 selected');
    await expect(page.locator('.multi-task-drag-preview-row')).toHaveText(order);
    const testInfo = test.info();
    await testInfo.attach('group-drag-preview', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect(row(names[1])).toHaveCSS('opacity', '0');
    await expect(page.locator('.cdk-drag-placeholder .task-title')).toHaveCSS(
      'visibility',
      'hidden',
    );
    await drop(page, section('Left').locator('task-list').first());
    await expect(section('Left').locator('task .task-title')).toHaveText(order);
    await expect(row(names[1])).toHaveCSS('opacity', '1');
    await select(page, [names[0], names[1]]);
    await startDrag(page, row(names[0]).locator('done-toggle'));
    await drop(page, section('Right').locator('task-list').first());
    await expect(section('Left').locator('task')).toHaveCount(0);
    await expect(section('Right').locator('task .task-title')).toHaveText(order);
    await select(page, [names[0], names[1]]);
    await startDrag(page, row(names[0]).locator('done-toggle'));
    await drop(page, page.locator('.no-section task-list').first(), true);
    await expect(section('Right').locator('task')).toHaveCount(0);
    await expect(page.locator('.no-section task .task-title')).toHaveText([
      ...order,
      names[2],
    ]);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(page.locator('.no-section task .task-title')).toHaveText([
      ...order,
      names[2],
    ]);
  });

  test('moves a cross-section selection into the dragged leader existing section', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Leader section');
    await projectPage.navigateToProjectByName('Leader section');
    const names = ['A', 'B'].map((name) => testPrefix + '-' + name);
    for (const name of names) await workViewPage.addTask(name);
    await createSection(page, 'Left');
    await createSection(page, 'Right');
    const section = (name: string): Locator =>
      page.locator('.section-container').filter({
        has: page.locator('.collapsible-title', { hasText: name }),
      });
    const row = (name: string): Locator =>
      page
        .locator('task:not(.cdk-drag-preview)')
        .filter({ has: page.locator('task-title', { hasText: name }) })
        .first();

    await startDrag(page, row(names[0]).locator('done-toggle'));
    await drop(page, section('Left').locator('task-list').first());
    await startDrag(page, row(names[1]).locator('done-toggle'));
    await drop(page, section('Right').locator('task-list').first());
    await expect(section('Left').locator('task .task-title')).toHaveText([names[0]]);
    await expect(section('Right').locator('task .task-title')).toHaveText([names[1]]);

    await select(page, names);
    const order = await page
      .locator('task.isMultiSelected .task-title')
      .allTextContents();
    await startDrag(page, row(names[1]).locator('done-toggle'));
    await drop(page, section('Right').locator('task-list').first());

    await expect(section('Left').locator('task')).toHaveCount(0);
    await expect(section('Right').locator('task .task-title')).toHaveText(order);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(section('Right').locator('task .task-title')).toHaveText(order);
  });

  test('Shift-click selects across sections and drags the displayed range together', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Section range');
    await projectPage.navigateToProjectByName('Section range');
    const names = ['A', 'B', 'C'].map((name) => testPrefix + '-' + name);
    for (const name of [...names].reverse()) await workViewPage.addTask(name);
    for (const name of ['Left', 'Right', 'Destination']) await createSection(page, name);
    const section = (name: string): Locator =>
      page.locator('.section-container').filter({
        has: page.locator('.collapsible-title', { hasText: name }),
      });
    const row = (name: string): Locator =>
      page
        .locator('task')
        .filter({
          has: page.locator('task-title', { hasText: name }),
        })
        .first();
    for (const [taskName, sectionName] of [
      [names[1], 'Left'],
      [names[2], 'Right'],
    ]) {
      await startDrag(page, row(taskName).locator('done-toggle'));
      await drop(page, section(sectionName).locator('task-list'));
      await expect(section(sectionName).locator('task .task-title')).toHaveText([
        taskName,
      ]);
    }
    await row(names[0])
      .locator('.task-title')
      .click({ modifiers: ['Control'] });
    await row(names[2])
      .locator('.task-title')
      .click({ modifiers: ['Shift'] });
    await expect(page.locator('task.isMultiSelected .task-title')).toHaveText(names);
    await expect(page.locator('task-multi-select-bar .bar')).toContainText('3 selected');
    const sourceBox = await row(names[1]).boundingBox();
    if (!sourceBox) throw new Error('Missing selected source');
    await startDrag(page, row(names[1]).locator('done-toggle'));
    const targetBox = await section('Destination')
      .locator('.task-list-inner')
      .boundingBox();
    if (!targetBox) throw new Error('Missing destination section');
    const halfWidth = targetBox.width / 2;
    const halfHeight = targetBox.height / 2;
    // Enter the intended section directly without traversing other drop lists,
    // whose temporary placeholders would move the destination during the gesture.
    const sourceHalfHeight = sourceBox.height / 2;
    await page.mouse.move(targetBox.x - 10, sourceBox.y + sourceHalfHeight);
    await page.mouse.move(targetBox.x - 10, targetBox.y + halfHeight, { steps: 10 });
    await page.mouse.move(targetBox.x + halfWidth, targetBox.y + halfHeight, {
      steps: 25,
    });
    await page.mouse.up();
    await expect(section('Destination').locator('task .task-title')).toHaveText(names);
    await expect(page.locator('.no-section task')).toHaveCount(0);
    await expect(section('Left').locator('task')).toHaveCount(0);
    await expect(section('Right').locator('task')).toHaveCount(0);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(section('Destination').locator('task .task-title')).toHaveText(names);
  });

  test('drops three selected tasks into an empty section without re-aiming', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Natural drop');
    await projectPage.navigateToProjectByName('Natural drop');
    const names = ['Keep', 'A', 'B', 'C'].map((name) => testPrefix + '-' + name);
    for (const name of [...names].reverse()) await workViewPage.addTask(name);
    await createSection(page, 'another section');
    await select(page, names.slice(1));
    const order = await page
      .locator('task.isMultiSelected .task-title')
      .allTextContents();
    await startDrag(
      page,
      page.locator('task.isMultiSelected').first().locator('done-toggle'),
    );
    const target = page.locator('.section-container .task-list-inner');
    const box = await target.boundingBox();
    if (!box) throw new Error('Missing section');
    const centerX = box.width / 2;
    const centerY = box.height / 2;
    // A normal gesture aims once. It must not need the test helper's second aim.
    await page.mouse.move(box.x + centerX, box.y + centerY, { steps: 25 });
    await page.mouse.up();
    await expect(page.locator('.section-container task .task-title')).toHaveText(order);
    await expect(page.locator('.no-section task .task-title')).toHaveText([names[0]]);
  });

  test('moves selected parents with their subtasks to a sidebar project', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Drag target');
    await projectPage.createProject('Drag source');
    await projectPage.navigateToProjectByName('Drag source');
    const names = ['Parent', 'Other', 'Keep'].map((n) => testPrefix + '-' + n);
    for (const name of names) await workViewPage.addTask(name);
    const row = page
      .locator('task')
      .filter({ has: page.locator('task-title', { hasText: names[0] }) })
      .first();
    await workViewPage.addSubTask(row, testPrefix + '-Child');
    const target = page
      .locator('nav-item[data-project-id]')
      .filter({ hasText: 'Drag target' })
      .first();
    if (!(await target.isVisible()))
      await page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .locator('nav-item button')
        .first()
        .click();
    await select(page, [names[0], names[1]]);
    await startDrag(page, row.locator('done-toggle').first());
    await expect(page.locator('.multi-task-drag-preview')).toContainText('2 selected');
    await drop(page, target);
    await expect(page.locator('task').filter({ hasText: names[1] })).toHaveCount(0);
    await expect(page.locator('task').filter({ hasText: names[2] })).toHaveCount(1);
    await projectPage.navigateToProjectByName('Drag target');
    await expect(page.locator('task')).toHaveCount(3);
    await expect(
      page
        .locator('task')
        .filter({ hasText: testPrefix + '-Child' })
        .last(),
    ).toBeVisible();
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(page.locator('task')).toHaveCount(3);
  });

  test('keeps single-task dragging and plain-click clearing intact on 500 rendered tasks', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    test.setTimeout(180000);
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Large drag');
    await projectPage.navigateToProjectByName('Large drag');
    await workViewPage.addTask(testPrefix + '-Seed');
    await page.evaluate(async (seedTitle) => {
      type TaskLike = { id: string; projectId: string; title: string };
      type State = { tasks: { entities: Record<string, TaskLike> } };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (next: (s: State) => void) => { unsubscribe: () => void };
              dispatch: (a: unknown) => void;
            };
          };
        }
      ).__e2eTestHelpers.store;
      let seed!: TaskLike;
      const subscription = store.subscribe((state) => {
        seed = Object.values(state.tasks.entities).find(
          (task) => task.title === seedTitle,
        )!;
      });
      subscription.unsubscribe();
      for (let i = 0; i < 499; i++) {
        const id = 'large-drag-' + i;
        store.dispatch({
          type: '[Task Shared] addTask',
          task: { ...seed, id, title: 'Large ' + i },
          workContextId: seed.projectId,
          workContextType: 'PROJECT',
          isAddToBacklog: false,
          isAddToBottom: true,
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'CRT' },
        });
        // Allow normal operation persistence and rendering between setup batches.
        if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }, testPrefix + '-Seed');
    await expect(page.locator('task')).toHaveCount(500);
    await createSection(page, 'Target');
    await select(page, ['Large 470']);
    await page
      .locator('task')
      .filter({ has: page.locator('task-title').getByText('Large 498', { exact: true }) })
      .locator('.task-title')
      .click({ modifiers: ['Shift'] });
    await expect(page.locator('task-multi-select-bar .bar')).toContainText('29 selected');
    await startDrag(
      page,
      page
        .locator('task')
        .filter({
          has: page.locator('task-title').getByText('Large 498', { exact: true }),
        })
        .locator('done-toggle'),
    );
    await expect(page.locator('.multi-task-drag-preview-row')).toHaveCount(29);
    await expect(page.locator('.multi-task-drag-preview-count')).toContainText(
      '29 selected',
    );
    const previewBox = await page.locator('.multi-task-drag-preview').boundingBox();
    const titlesBox = await page.locator('.multi-task-drag-preview-tasks').boundingBox();
    expect(titlesBox!.height).toBeLessThanOrEqual(360);
    expect(previewBox!.height - titlesBox!.height).toBeLessThan(100);
    await page.keyboard.press('Escape');
    await drop(page, page.locator('.section-container task-list').first());
    await expect(page.locator('.no-section task')).toHaveCount(500);
    await select(page, ['Large 496', 'Large 497']);
    await page
      .locator('task')
      .filter({ has: page.locator('task-title').getByText('Large 496', { exact: true }) })
      .locator('done-toggle')
      .click();
    await expect(page.locator('task-multi-select-bar .bar')).toHaveCount(0);
    // Restore the task, then dragging an unselected row must remain a single drag.
    const row496 = page.locator('task').filter({
      has: page.locator('task-title').getByText('Large 496', { exact: true }),
    });
    // The done animation keeps the old row while the done-list row renders.
    await expect(row496.locator('done-toggle[aria-checked="true"]')).toBeVisible();
    await expect(row496).toHaveCount(1);
    await row496.locator('done-toggle').click();
    await select(page, ['Large 496', 'Large 497']);
    await startDrag(
      page,
      page
        .locator('task')
        .filter({
          has: page.locator('task-title').getByText('Large 498', { exact: true }),
        })
        .locator('done-toggle'),
    );
    await expect(page.locator('.multi-task-drag-preview')).toHaveCount(0);
    await drop(page, page.locator('.section-container task-list').first());
    await expect(page.locator('.section-container task .task-title')).toHaveText([
      'Large 498',
    ]);
    await select(page, ['Large 496', 'Large 497']);
    await startDrag(
      page,
      page.locator('task.isMultiSelected').first().locator('done-toggle'),
    );
    await expect(page.locator('.multi-task-drag-preview')).toContainText('2 selected');
    await drop(page, page.locator('.section-container task-list').first());
    await expect(page.locator('.section-container task')).toHaveCount(3);
    await expect(page.locator('.no-section task')).toHaveCount(497);
  });

  test('Escape cancels a group drop without moving one task', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Cancel drag');
    await projectPage.navigateToProjectByName('Cancel drag');
    const names = ['A', 'B'].map((n) => testPrefix + '-' + n);
    for (const name of names) await workViewPage.addTask(name);
    await createSection(page, 'Target');
    await select(page, names);
    await startDrag(
      page,
      page.locator('task.isMultiSelected').first().locator('done-toggle'),
    );
    await page.keyboard.press('Escape');
    await drop(page, page.locator('.section-container task-list').first());
    await expect(page.locator('.no-section task')).toHaveCount(2);
    await expect(page.locator('.section-container task')).toHaveCount(0);
    await expect(page.locator('.no-section task').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('.no-section task').last()).toHaveCSS('opacity', '1');
    await expect(page.locator('.multi-task-drag-preview')).toHaveCount(0);
  });
});
