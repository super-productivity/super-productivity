import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_IFRAME = 'plugin-index iframe';

type SentTask = { id: string; title: string; selected?: true };
const API_URL = 'https://api.anthropic.com/**';

// The bundled AI Command plugin against the real host, with the Anthropic API
// answered by the test: no key, no network, no cost.
test.describe('AI Command plugin', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    test.setTimeout(60000 * getCITimeoutMultiplier());
    if (!(await waitForPluginAssets(page))) {
      throw new Error('Plugin assets not available — run `npm run prebuild`');
    }
    await workViewPage.waitForTaskList();
    expect(await waitForPluginManagementInit(page)).toBeTruthy();
    expect(await enablePluginWithVerification(page, 'AI Command')).toBeTruthy();
  });

  const reject401 = (page: Page): Promise<void> =>
    page.route(API_URL, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
      }),
    );

  const askWithBadKey = async (panel: FrameLocator): Promise<void> => {
    await panel.locator('input[type="password"]').fill('sk-ant-bad');
    await panel.getByRole('button', { name: 'Turn on' }).click();
    await panel.locator('#input').fill('buy milk');
    await panel.locator('#input').press('Enter');
    await expect(panel.getByText('The API key was not accepted.')).toBeVisible({
      timeout: 10000,
    });
    await expect(panel.getByText('Asking…')).toBeHidden();
  };

  test('a rejected API key shows an error on the plugin page', async ({ page }) => {
    await reject401(page);
    await page.goto('/#/plugins/ai-command/index');
    await askWithBadKey(page.frameLocator(PLUGIN_IFRAME));
  });

  test('a rejected API key shows an error in the side panel', async ({ page }) => {
    await reject401(page);
    await page.goto('/#/tag/TODAY/tasks');
    await page.locator('.plugin-side-panel-btn').first().click();
    await askWithBadKey(page.frameLocator('plugin-panel-container iframe'));
  });

  const contextOf = (postData: string | null): { tasks: SentTask[] } => {
    const content = JSON.parse(postData || '{}').messages[0].content;
    return JSON.parse(/<context>\s*([\s\S]*?)\s*<\/context>/.exec(content)![1]);
  };

  // The model's answer: a list of the tasks whose titles contain these words,
  // plus any further tool calls. Returns the contexts the panel sent.
  const answerWithList = async (
    page: Page,
    words: string[],
    extraCalls: { name: string; input: unknown }[] = [],
  ): Promise<{ tasks: SentTask[] }[]> => {
    const sent: { tasks: SentTask[] }[] = [];
    await page.route(API_URL, (route) => {
      const ctx = contextOf(route.request().postData());
      sent.push(ctx);
      const items = words.map((w) => ({
        id: ctx.tasks.find((t) => t.title.includes(w))!.id,
        reason: `Has ${w}`,
      }));
      const calls = [
        { name: 'show_tasks', input: { title: 'Focus on', items } },
        ...extraCalls,
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stop_reason: 'tool_use',
          content: calls.map((c, i) => ({ type: 'tool_use', id: `call${i}`, ...c })),
        }),
      });
    });
    return sent;
  };

  const openPanelAndAsk = async (page: Page, request: string): Promise<FrameLocator> => {
    await page.locator('.plugin-side-panel-btn').first().click();
    const panel = page.frameLocator('plugin-panel-container iframe');
    await panel.locator('input[type="password"]').fill('sk-ant-test');
    await panel.getByRole('button', { name: 'Turn on' }).click();
    await panel.locator('#input').fill(request);
    await panel.locator('#input').press('Enter');
    return panel;
  };

  test('a listed task can be added to today, alone or picked, and the list survives a reopen', async ({
    page,
    workViewPage,
  }) => {
    await answerWithList(page, ['Alpha', 'Bravo']);
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Alpha task');
    await workViewPage.addTask('Bravo task');
    const sidePanelBtn = page.locator('.plugin-side-panel-btn').first();
    const panel = await openPanelAndAsk(page, 'alpha bravo');

    const rows = panel.locator('li.row');
    const alpha = rows.filter({ hasText: 'Alpha task' });
    const bravo = rows.filter({ hasText: 'Bravo task' });
    await expect(panel.getByRole('button', { name: 'Add to today' })).toHaveCount(2);

    await alpha.getByRole('button', { name: 'Add to today' }).click();
    await expect(alpha.getByRole('button', { name: 'Add to today' })).toHaveCount(0);

    await bravo.getByRole('checkbox').check();
    await expect(panel.getByText('1 picked')).toBeVisible();
    await panel.getByRole('button', { name: 'Add 1 to today' }).click();
    await expect(panel.getByRole('button', { name: 'Add to today' })).toHaveCount(0);
    await expect(panel.getByText('1 picked')).toBeHidden();

    // Esc closes only the menu, not the list.
    await alpha.getByRole('button', { name: 'More' }).click();
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('menuitem', { name: 'Open' })).toBeHidden();
    await expect(alpha).toBeVisible();
    await alpha.getByRole('button', { name: 'More' }).click();
    await panel.getByRole('menuitem', { name: 'Mark done' }).click();
    await expect(alpha).toHaveClass(/off/);

    // Closing the panel drops its iframe; reopening shows the same list.
    await sidePanelBtn.click();
    await expect(page.locator('plugin-panel-container iframe')).toHaveCount(0);
    await sidePanelBtn.click();
    await expect(bravo).toBeVisible();
    await expect(alpha).toHaveClass(/off/);

    await page.goto('/#/tag/TODAY/tasks');
    // toHaveCount, not toBeVisible: during the page transition both views render it.
    await expect(page.locator('task').filter({ hasText: 'Bravo task' })).toHaveCount(1);
  });

  test('picked tasks narrow the next request, are marked done together, and block a hidden Apply', async ({
    page,
    workViewPage,
  }) => {
    const sent = await answerWithList(
      page,
      ['Alpha', 'Bravo'],
      [{ name: 'add_task', input: { ref: 'n1', title: 'Charlie task' } }],
    );
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Alpha task');
    await workViewPage.addTask('Bravo task');
    const panel = await openPanelAndAsk(page, 'alpha bravo');
    const alpha = panel.locator('li.row').filter({ hasText: 'Alpha task' });
    const bravo = panel.locator('li.row').filter({ hasText: 'Bravo task' });

    // Picks replace the Apply footer, so Ctrl+Enter must not apply the hidden add.
    await expect(alpha).toBeVisible();
    await alpha.getByRole('checkbox').check();
    await expect(panel.getByRole('button', { name: 'Apply' })).toBeHidden();
    await panel.locator('#input').press('Control+Enter');
    await alpha.getByRole('checkbox').uncheck();
    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect(panel.getByText('Applied: 1 of 1')).toBeVisible();

    // A follow-up with picks sends only the picked tasks as "these".
    await panel.locator('#input').fill('alpha bravo');
    await panel.locator('#input').press('Enter');
    await bravo.getByRole('checkbox').check();
    await panel.locator('#input').fill('alpha bravo again');
    await panel.locator('#input').press('Enter');
    await expect(bravo).toBeVisible();
    const selected = sent[2].tasks.filter((t) => t.selected).map((t) => t.title);
    expect(selected).toEqual([expect.stringContaining('Bravo task')]);

    await alpha.getByRole('checkbox').check();
    await bravo.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Mark 2 done' }).click();
    await expect(alpha).toHaveClass(/off/);
    await expect(bravo).toHaveClass(/off/);
    await expect(panel.getByText('2 picked')).toBeHidden();
  });
});
