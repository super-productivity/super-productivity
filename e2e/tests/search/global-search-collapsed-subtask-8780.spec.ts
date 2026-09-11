import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * REPRODUCTION of #8780 — the case the reporter's debug trace actually shows.
 *
 * The trace (2026-08-11) has `parentId` set, a correct `routeChange`, a rendered
 * container, and then `hasDirectMatch: false` on all 21 focus attempts. So
 * navigation resolved fine and the reveal step polled for a row that could never
 * appear: a collapsed parent renders no `<task>` host for its subtasks
 * (`filterDoneTasks` returns `[]` when `isHideAll`), and `_hideSubTasksMode` is
 * persisted (#8781), so the result stayed permanently unreachable.
 *
 * Different failure from `global-search-orphan-8780.spec.ts`, which guards the
 * resolver (#8801/#9052) and passes on every shipped build.
 */

const openGlobalSearch = async (page: Page): Promise<void> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await expect(page.locator('search-page')).toBeVisible();
};

/**
 * Turns on "Group By: Project" and collapses every resulting group, entirely
 * through the real UI. Driving the menu rather than seeding localStorage keeps
 * the collapse state in the exact shape the app writes, so the fixture cannot
 * drift from production.
 */
const groupByProjectAndCollapseAll = async (page: Page): Promise<void> => {
  await page.locator('.task-filter-btn').click();
  const groupByItem = page.locator('.mat-mdc-menu-item', { hasText: 'Group By' });
  await expect(groupByItem).toBeVisible();
  await groupByItem.click();
  const projectOption = page.locator('.mat-mdc-menu-item', { hasText: 'Project' }).last();
  await expect(projectOption).toBeVisible();
  await projectOption.click();
  await page.keyboard.press('Escape');

  const groupHeaders = page.locator('work-view collapsible .collapsible-header');
  await expect(groupHeaders.first()).toBeVisible();
  for (let i = 0, count = await groupHeaders.count(); i < count; i++) {
    await groupHeaders.nth(i).click();
  }
};

test.describe('Global Search — collapsed parent (#8780)', () => {
  test('reveals and focuses a subtask whose parent is collapsed', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const parentName = `${testPrefix}-CollapsedParent`;
    const subTaskName = `${testPrefix}-HiddenSubTask`;

    await workViewPage.addTask(parentName);
    const parentEl = taskPage.getTaskByText(parentName);
    await expect(parentEl).toBeVisible();
    await workViewPage.addSubTask(parentEl, subTaskName);

    // Scope to the nested list: a `task` filtered by the subtask's title also
    // matches the PARENT row, which renders that title inside itself.
    const subTaskEl = parentEl.locator('.sub-tasks task').filter({
      hasText: subTaskName,
    });
    await expect(subTaskEl).toBeVisible();
    const subTaskId = await subTaskEl.getAttribute('data-task-id');
    expect(subTaskId).toBeTruthy();
    // Nanoid ids may start with `-` or a digit, so `#t-<id>` is not always a
    // valid CSS selector — match the data attribute instead.
    const subTaskRow = page.locator(`task[data-task-id="${subTaskId}"]`);

    // Collapse through the real UI. With no done subtasks the toggle steps
    // straight from "shown" to HideAll (see getNextHideSubTasksMode).
    await parentEl.locator('.toggle-sub-tasks-btn').first().click();

    // Precondition: the row is gone from the DOM entirely — not merely scrolled
    // out of view. If this fails the rest of the test proves nothing.
    await expect(subTaskRow).toHaveCount(0);

    await openGlobalSearch(page);
    await page.locator('search-page .search-field input').fill(subTaskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: subTaskName });
    await expect(result).toHaveCount(1);
    await result.click();

    // The bug: navigation lands on the right list, but the collapsed parent was
    // never expanded, so the row never rendered and focus silently gave up.
    await expect(subTaskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${subTaskId}`);
  });

  /**
   * The second container the reporter described: a collapsed customizer group
   * unmounts its whole task-list (`collapsible` renders its panel behind
   * `@if (isExpanded)`), so the row can never appear no matter how long the
   * reveal loop retries.
   */
  test('reveals and focuses a task inside a collapsed customizer group', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-GroupedTask`;
    await workViewPage.addTask(taskName);

    const taskEl = taskPage.getTaskByText(taskName);
    await expect(taskEl).toBeVisible();
    const taskId = await taskEl.getAttribute('data-task-id');
    expect(taskId).toBeTruthy();
    const taskRow = page.locator(`task[data-task-id="${taskId}"]`);

    await groupByProjectAndCollapseAll(page);

    // Precondition: the collapsed group unmounted the row entirely.
    await expect(taskRow).toHaveCount(0);

    await openGlobalSearch(page);
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
});
