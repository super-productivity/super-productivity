import { expect, test } from '../../fixtures/test.fixture';
import type { Locator } from '@playwright/test';

test.describe('Short Syntax', () => {
  const tagTitlesOf = (task: Locator): Locator => task.locator('tag-list tag .tag-title');

  test('should add task with project via short syntax', async ({
    page,
    workViewPage,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task with project short syntax
    await workViewPage.addTask('0 test task koko +i');

    // Verify task is visible
    const task = page.locator('task').first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Verify the task has the Inbox tag
    const taskTags = task.locator('tag');
    await expect(taskTags).toContainText('Inbox', { timeout: 5000 });
  });

  // A tag typed into an existing task's title must be added to the tags the
  // task already has. Parsed tags are stripped from the title, so the title
  // can never name them, and treating it as the task's full tag list dropped
  // every tag on each `#tag` typed.
  test('should keep a tag the title does not name when a title edit adds one', async ({
    page,
    workViewPage,
    taskPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Pre-create the typed tag so short syntax attaches it without the
    // "create new tag?" confirm dialog.
    await tagPage.createTag('addedTag');

    await workViewPage.addTask('TagKeeper');
    const task = page.locator('task').filter({ hasText: 'TagKeeper' }).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // A tag added the way a user adds one, which the title never mentions.
    await tagPage.assignTagToTask(task, 'keepTag');
    await expect(tagTitlesOf(task).filter({ hasText: 'keepTag' })).toHaveCount(1);

    await taskPage.editTaskTitle(task, `${testPrefix}-TagKeeper #addedTag`);

    await expect(tagTitlesOf(task).filter({ hasText: 'addedTag' })).toHaveCount(1);
    await expect(tagTitlesOf(task).filter({ hasText: 'keepTag' })).toHaveCount(1);
    // The syntax is consumed, so the title is left clean.
    await expect(taskPage.getTaskTitle(task)).not.toContainText('#addedTag');
  });
});
