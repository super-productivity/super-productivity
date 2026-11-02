import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_IFRAME = 'plugin-index iframe';

interface PluginTask {
  id: string;
  title: string;
  dueDay?: string | null;
  dueWithTime?: number | null;
}

type PluginApiWindow = Window & {
  PluginAPI: {
    getTasks(): Promise<PluginTask[]>;
    updateTask(taskId: string, updates: Partial<PluginTask>): Promise<void>;
  };
};

const cardWithTitle = (page: Page, title: string): Locator =>
  page.locator('planner-task[data-task-selectable="true"]').filter({ hasText: title });

const dayOfCard = (card: Locator): Locator => card.locator('xpath=ancestor::planner-day');

const openPlanner = async (page: Page): Promise<void> => {
  const plannerPage = new PlannerPage(page);
  await plannerPage.navigateToPlanner();
  await plannerPage.waitForPlannerView();
  // A revisit briefly renders the leaving and the entering planner.
  await expect(page.locator('planner')).toHaveCount(1);
};

const openPluginFrame = async (page: Page): Promise<Locator> => {
  await page.goto('/#/plugins/api-test-plugin/index');
  // A revisit briefly shows the leaving and the entering route's iframe.
  await expect(page.locator(PLUGIN_IFRAME)).toHaveCount(1);
  await page.locator(PLUGIN_IFRAME).waitFor({ state: 'visible' });
  const body = page.frameLocator(PLUGIN_IFRAME).locator('body');
  await body.waitFor({ state: 'visible' });
  return body;
};

const tasksByTitle = async (
  body: Locator,
  titles: string[],
): Promise<Record<string, PluginTask>> =>
  body.evaluate(async (_el, wanted) => {
    const tasks = await (window as unknown as PluginApiWindow).PluginAPI.getTasks();
    return Object.fromEntries(
      tasks.filter((t) => wanted.includes(t.title)).map((t) => [t.title, t]),
    );
  }, titles);

test.describe('Plugin API updateTask with dueDay', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(60000 * timeoutMultiplier);
    if (!(await waitForPluginAssets(page))) {
      throw new Error('Plugin assets not available');
    }
    await workViewPage.waitForTaskList();
    if (!(await waitForPluginManagementInit(page))) {
      throw new Error('Plugin management failed to initialize');
    }
    if (
      !(await enablePluginWithVerification(
        page,
        'API Test Plugin',
        10000 * timeoutMultiplier,
      ))
    ) {
      throw new Error('Failed to enable API Test Plugin');
    }
    if (
      !(await waitForPluginInMenu(page, 'API Test Plugin', 15000 * timeoutMultiplier))
    ) {
      throw new Error('API Test Plugin not found in menu');
    }
  });

  // The Planner's own day move (keyboard here, the same planTaskForDay action
  // as its "plan for day" menu) is the reference: a plugin's dueDay write must
  // put the task in the same Planner day with the same task fields. Plugins
  // plan tasks this way; there is no separate move-to-day method.
  test('plans a task for a day the way the Planner does', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    const plannerTitle = `${testPrefix}-moved in planner`;
    const pluginTitle = `${testPrefix}-moved by plugin`;
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(plannerTitle);
    await workViewPage.addTask(pluginTitle);

    // Reference: move one task two days ahead in the Planner itself.
    await openPlanner(page);
    const plannerCard = cardWithTitle(page, plannerTitle);
    await expect(plannerCard).toBeVisible();
    const dates = await page
      .locator('planner-day[data-day]')
      .evaluateAll((days) => days.map((d) => d.getAttribute('data-day') as string));
    const startIndex = dates.indexOf(
      (await dayOfCard(plannerCard).getAttribute('data-day')) ?? '',
    );
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const targetDay = dates[startIndex + 2];
    await plannerCard.focus();
    await expect(plannerCard).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(dayOfCard(plannerCard)).toHaveAttribute(
      'data-day',
      dates[startIndex + 1],
    );
    // The moved card re-renders in its new day; focus returns asynchronously,
    // and a key pressed before that is lost.
    await expect(plannerCard).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(dayOfCard(plannerCard)).toHaveAttribute('data-day', targetDay);

    // Same move through the plugin API, from inside a plugin iframe.
    const body = await openPluginFrame(page);
    const before = await tasksByTitle(body, [pluginTitle]);
    await body.evaluate(
      async (_el, { id, day }) =>
        (window as unknown as PluginApiWindow).PluginAPI.updateTask(id, { dueDay: day }),
      { id: before[pluginTitle].id, day: targetDay },
    );

    const after = await tasksByTitle(body, [plannerTitle, pluginTitle]);
    expect(after[pluginTitle].dueDay).toBe(targetDay);
    expect(after[pluginTitle].dueDay).toBe(after[plannerTitle].dueDay);
    expect(after[pluginTitle].dueWithTime ?? null).toBe(
      after[plannerTitle].dueWithTime ?? null,
    );

    // The Planner shows both in that day: planner.days follows the dueDay write.
    await openPlanner(page);
    await expect(dayOfCard(cardWithTitle(page, pluginTitle))).toHaveAttribute(
      'data-day',
      targetDay,
    );
    await expect(dayOfCard(cardWithTitle(page, plannerTitle))).toHaveAttribute(
      'data-day',
      targetDay,
    );

    // dueDay: null removes the planned day again.
    const body2 = await openPluginFrame(page);
    await body2.evaluate(
      async (_el, id) =>
        (window as unknown as PluginApiWindow).PluginAPI.updateTask(id, { dueDay: null }),
      before[pluginTitle].id,
    );
    const unplanned = await tasksByTitle(body2, [pluginTitle]);
    expect(unplanned[pluginTitle].dueDay ?? null).toBeNull();
    await openPlanner(page);
    await expect(cardWithTitle(page, plannerTitle)).toBeVisible();
    await expect(cardWithTitle(page, pluginTitle)).toHaveCount(0);
  });
});
