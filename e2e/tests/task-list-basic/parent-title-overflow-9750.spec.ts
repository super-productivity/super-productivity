import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #9750: on a phone "the beginning of the name is cut off on the screen".
 * The reporter narrowed it down themselves — it needs a sub-task shown in the
 * Today view whose parent has no date, so the task row carries the `.parent-title`
 * line with the (long) parent name.
 *
 * Cause: `.parent-title .title` is `white-space: nowrap`, so the min-content width
 * it contributes upwards is the whole untruncated parent name. With
 * `.title-and-left-btns-wrapper` at `min-width: auto` that intrinsic size became a
 * floor the wrapper could not shrink below, so on a narrow screen it outgrew
 * `.first-line` — and since the wrapper centers its content, the overflow was split
 * evenly to both sides, pushing the start of both titles (and the done-toggle) off
 * the left edge. `min-width: 0` lets it shrink so the parent name ellipsizes instead.
 *
 * Run: npm run e2e:file e2e/tests/task-list-basic/parent-title-overflow-9750.spec.ts -- --retries=0
 */

const PHONE = { width: 360, height: 780 };

const LONG_PARENT =
  'Call the insurance company about the damaged roof claim and get the reference number';
const SUB_TASK = 'Find the policy number first';

test.describe('Task title overflow with parent title', () => {
  test('should keep a sub-task row inside the viewport on a narrow screen', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // The parent must stay undated, so create it in the project view rather than
    // in Today (adding from Today would set dueDay and nest the sub-task under it).
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(LONG_PARENT);

    const parentTask = taskPage.getTaskByText(LONG_PARENT).first();
    await parentTask.waitFor({ state: 'visible' });
    await workViewPage.addSubTask(parentTask, SUB_TASK);

    // Shift+T === taskScheduleToday: the sub-task moves into Today on its own,
    // which is what makes it render flat with a `.parent-title` line.
    const subTask = taskPage.getTaskByText(SUB_TASK).last();
    await subTask.focus();
    await subTask.press('Shift+T');

    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await page.setViewportSize(PHONE);

    const parentTitle = page.locator('task .parent-title .title').first();
    await expect(parentTitle).toBeVisible();
    // The move-to-Today animation leaves a transient clone of the row behind;
    // measuring while it is still in flight reads the animated position.
    await expect(page.locator('task')).toHaveCount(1);

    const geometry = await page.evaluate(() => {
      const task = document.querySelector('task') as HTMLElement;
      const rect = (sel: string): { left: number; right: number } | null => {
        const el = task.querySelector(sel);
        if (!el) return null;
        const { left, right } = el.getBoundingClientRect();
        return { left, right };
      };
      const title = task.querySelector('.parent-title .title') as HTMLElement;
      return {
        viewportWidth: window.innerWidth,
        row: rect('.title-and-left-btns-wrapper'),
        parentTitle: rect('.parent-title .title'),
        taskTitle: rect('task-title'),
        // the long parent name should be ellipsized, not spilling out of its box
        isParentTitleTruncated: title.scrollWidth > title.clientWidth,
      };
    });

    expect(geometry.row).not.toBeNull();
    expect(geometry.parentTitle).not.toBeNull();
    expect(geometry.taskTitle).not.toBeNull();

    // Nothing may start left of the viewport — that is the reported symptom.
    expect(geometry.row!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.parentTitle!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.taskTitle!.left).toBeGreaterThanOrEqual(0);

    // ...and the row must fit, so the end is not lost either.
    expect(geometry.row!.right).toBeLessThanOrEqual(geometry.viewportWidth);

    expect(geometry.isParentTitleTruncated).toBe(true);
  });
});
