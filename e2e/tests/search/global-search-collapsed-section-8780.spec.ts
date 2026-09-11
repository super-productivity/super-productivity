import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * Companion to `global-search-collapsed-subtask-8780.spec.ts` for the OTHER
 * container that removes a task from the DOM: a collapsed section.
 *
 * Sections render through the same `collapsible` (`@if (isExpanded)`), so a task
 * inside a collapsed one has no `#t-<id>` node and the reveal can only expire —
 * the reported symptom, in the default (non-customized) view.
 *
 * This one matters more than the parent case does: expanding a section is a
 * PERSISTED, op-log-synced write (`updateSection`), so it must be proven against
 * the real reducers and the real render path rather than a spy. Hence a live
 * test even though the fixture needs store seeding.
 *
 * Section membership is seeded via dispatch because there is no UI path to it
 * other than drag-and-drop — same reasoning, and same `__e2eTestHelpers.store`
 * mechanism, as `global-search-orphan-8780.spec.ts`. Everything after the seed
 * (collapsing, searching, clicking) is real UI.
 *
 * The seed actions carry no `meta`, so op-log capture skips them: the seed proves
 * the reducer and the render path, not the sync path. That is fine here, because
 * the write under test — `updateSection` from the reveal — is dispatched by the
 * app itself and does carry real meta.
 */
const seedSectionContaining = async (
  page: Page,
  opts: { taskId: string; sectionId: string; title: string },
): Promise<void> => {
  await page.evaluate(({ taskId, sectionId, title }) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;

    // Sections are valid for projects and the singleton TODAY tag; the work
    // view starts on TODAY, so that is the context this must belong to.
    store.dispatch({
      type: '[Section] Add Section',
      section: {
        id: sectionId,
        contextId: 'TODAY',
        contextType: 'TAG',
        title,
        taskIds: [],
        isExpanded: true,
      },
    });
    store.dispatch({
      type: '[Section] Add Task to Section',
      sectionId,
      taskId,
      afterTaskId: null,
      sourceSectionId: null,
    });
  }, opts);
};

test.describe('Global Search — collapsed section (#8780)', () => {
  test('reveals a task inside a collapsed section', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-TaskInSection`;
    const sectionTitle = `${testPrefix}-Section`;
    await workViewPage.addTask(taskName);

    const taskEl = taskPage.getTaskByText(taskName);
    await expect(taskEl).toBeVisible();
    const taskId = await taskEl.evaluate((el: HTMLElement) => {
      const host = el.closest('task') ?? el;
      return (host as HTMLElement).dataset.taskId ?? '';
    });
    expect(taskId).toBeTruthy();

    await seedSectionContaining(page, {
      taskId,
      sectionId: `${testPrefix}-section-id`,
      title: sectionTitle,
    });

    const section = page.locator('collapsible').filter({ hasText: sectionTitle });
    const taskRow = page.locator(`task[data-task-id="${taskId}"]`);
    await expect(taskRow).toBeVisible();

    // Collapse it through the real UI, then confirm the premise: the row is not
    // merely hidden, it is gone from the DOM.
    await section.locator('.collapsible-header').first().click();
    await expect(taskRow).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(taskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(taskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${taskId}`);
  });

  /**
   * The two reveals that write SYNCED ops live in different components and run at
   * different times — `showSubTasks` in NavigateToTaskService before the route
   * change, `updateSection` in WorkViewComponent on a retry tick afterwards. Each
   * is covered alone; this is the only check that one navigation drives BOTH, and
   * that neither undoes or blocks the other.
   *
   * Stacking them is not contrived: sections group top-level tasks, and a task
   * with subtasks is exactly what ends up in one.
   */
  test('reveals a subtask whose parent is collapsed inside a collapsed section', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const parentName = `${testPrefix}-SectionedParent`;
    const subTaskName = `${testPrefix}-DoublyHidden`;
    const sectionTitle = `${testPrefix}-OuterSection`;
    await workViewPage.addTask(parentName);

    const parentTask = taskPage.getTaskByText(parentName);
    await expect(parentTask).toBeVisible();
    const parentId = await parentTask.evaluate((el: HTMLElement) => {
      const host = el.closest('task') ?? el;
      return (host as HTMLElement).dataset.taskId ?? '';
    });
    expect(parentId).toBeTruthy();

    await parentTask.focus();
    await page.keyboard.press('a');
    const draftInput = parentTask.locator('.e2e-add-subtask-input');
    await expect(draftInput).toBeFocused();
    await draftInput.fill(subTaskName);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const subTask = parentTask.locator('.sub-tasks task').first();
    await expect(subTask).toBeVisible();
    const subTaskId = await subTask.evaluate(
      (el: HTMLElement) => el.dataset.taskId ?? '',
    );
    expect(subTaskId).toBeTruthy();
    const subTaskRow = page.locator(`task[data-task-id="${subTaskId}"]`);

    // Hide #1: collapse the parent.
    await parentTask.locator('.toggle-sub-tasks-btn').click();
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(0);

    // Hide #2: put the parent in a section and collapse that too, so even the
    // parent row is gone and expanding only the parent would not be enough.
    await seedSectionContaining(page, {
      taskId: parentId,
      sectionId: `${testPrefix}-outer-section-id`,
      title: sectionTitle,
    });
    const section = page.locator('collapsible').filter({ hasText: sectionTitle });
    await section.locator('.collapsible-header').first().click();
    await expect(page.locator(`task[data-task-id="${parentId}"]`)).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(subTaskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: subTaskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(subTaskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${subTaskId}`);
  });
});
