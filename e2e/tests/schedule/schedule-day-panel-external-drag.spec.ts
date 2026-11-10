import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { touchPan } from '../../utils/touch-pan';

// The panel's own preview of a task dragged in from a list, at the time under
// the pointer. CDK's preview is hidden over the panel, so if this one is not on
// screen the task seems to vanish as soon as it reaches the panel.
const PANEL_PREVIEW = 'schedule-day-panel schedule-event.custom-drag-preview';

const centerOf = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } => {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  return { x: box.x + halfWidth, y: box.y + halfHeight };
};

const openPanelWithTask = async (
  page: Page,
  workViewPage: {
    waitForTaskList: () => Promise<void>;
    addTask: (title: string) => Promise<void>;
  },
): Promise<{ task: Locator; panel: Locator }> => {
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Drag into schedule 1h');
  await page.locator('.e2e-toggle-schedule-day-panel').first().click();
  const panel = page.locator('right-panel .side');
  await expect(page.locator('schedule-day-panel schedule-week')).toBeVisible();
  const task = page.locator('task').filter({ hasText: 'Drag into schedule' }).first();
  return { task, panel };
};

test.describe('Schedule day panel: dragging a task in from a list', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test('shows the preview at the finger for a quick touch drag', async ({
    page,
    workViewPage,
  }) => {
    const { task, panel } = await openPanelWithTask(page, workViewPage);
    const taskBox = (await task.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    const start = { x: taskBox.x + 60, y: centerOf(taskBox).y };
    const target = { x: centerOf(panelBox).x, y: 400 };

    // No long press: after mouse input the app drags without a touch delay, so
    // the finger reaches the panel before any boundary event on it.
    await touchPan(page, task, target.x - start.x, {
      deltaY: target.y - start.y,
      start,
      steps: 25,
      beforeRelease: async () => {
        await expect(page.locator(PANEL_PREVIEW)).toBeInViewport();
      },
    });
  });

  test('shows the preview at the pointer for a mouse drag', async ({
    page,
    workViewPage,
  }) => {
    const { task, panel } = await openPanelWithTask(page, workViewPage);
    const taskBox = (await task.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    await page.mouse.move(taskBox.x + 60, centerOf(taskBox).y);
    await page.mouse.down();
    await page.mouse.move(centerOf(panelBox).x, 400, { steps: 25 });

    await expect(page.locator(PANEL_PREVIEW)).toBeInViewport();
    await page.mouse.up();
  });
});
