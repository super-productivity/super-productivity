import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_IFRAME = 'plugin-index iframe';
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
});
