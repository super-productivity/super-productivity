import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #9829: a long task title or tag could extend beyond its task card and
 * the phone viewport in portrait mode.
 *
 * Run: npm run e2e:file e2e/tests/mobile/task-title-portrait-overflow.spec.ts -- --retries=0
 */

const PORTRAIT = { width: 390, height: 844 };
const TASK_TITLE = 'Planning template for resource tracking and implementation review';
const LONG_TAG = '2026_05_Valiant_Project_Support_Implementation_LiQV_FINMA_EKE';

test.describe('Task title portrait overflow (Issue #9829)', () => {
  test('keeps a long title and tag inside the task card in portrait mode', async ({
    page,
    workViewPage,
    taskPage,
    tagPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(TASK_TITLE);

    const task = taskPage.getTaskByText(TASK_TITLE);
    await expect(task).toBeVisible();
    await tagPage.assignTagToTask(task, LONG_TAG);
    await page.setViewportSize(PORTRAIT);

    const taskTitle = task.locator('task-title .display-value');
    const tagTitle = task.locator('tag .tag-title').filter({ hasText: LONG_TAG });
    await expect(taskTitle).toBeVisible();
    await expect(tagTitle).toBeVisible();

    const geometry = await task.evaluate((taskEl, longTag) => {
      const rect = (selector: string): { left: number; right: number } => {
        const element = taskEl.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const { left, right } = element.getBoundingClientRect();
        return { left, right };
      };

      const longTagTitle = Array.from(taskEl.querySelectorAll('tag .tag-title')).find(
        (element) => element.textContent?.trim() === longTag,
      );
      if (!longTagTitle) throw new Error('Missing long tag title');
      const { left: tagLeft, right: tagRight } = longTagTitle.getBoundingClientRect();

      const { left: cardLeft, right: cardRight } = taskEl.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        card: { left: cardLeft, right: cardRight },
        titleWrapper: rect('.title-and-tags-wrapper'),
        taskTitle: rect('task-title .display-value'),
        tagTitle: { left: tagLeft, right: tagRight },
      };
    }, LONG_TAG);

    for (const content of [
      geometry.titleWrapper,
      geometry.taskTitle,
      geometry.tagTitle,
    ]) {
      expect(content.left).toBeGreaterThanOrEqual(geometry.card.left);
      expect(content.right).toBeLessThanOrEqual(geometry.card.right);
      expect(content.right).toBeLessThanOrEqual(geometry.viewportWidth);
    }
  });
});
