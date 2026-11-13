import { expect, test } from '../../fixtures/test.fixture';

// The panel can open while plugins are still loading. Once the GitHub plugin
// registers, the configured provider must stop showing as not installed.
test('a GitHub provider recovers when its plugin registers after the panel opened', async ({
  page,
  workViewPage,
}) => {
  test.setTimeout(90000);
  await workViewPage.waitForTaskList();
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/panel');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.evaluate(() =>
    (
      window as unknown as {
        __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
      }
    ).__e2eTestHelpers.flushPendingWrites(),
  );

  // Plugins are activated only after every bundled manifest is discovered,
  // so holding this one keeps the GitHub plugin unregistered while the saved
  // provider loads.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let isManifestRequested = false;
  await page.route(
    '**/assets/bundled-plugins/ai-productivity-prompts/manifest.json',
    async (route) => {
      isManifestRequested = true;
      await held;
      await route.continue();
    },
  );
  try {
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect.poll(() => isManifestRequested).toBe(true);
    await page.locator('.e2e-toggle-issue-provider-panel').click();
    await page.locator('issue-panel .mat-mdc-tab').first().click();
    await expect(page.locator('issue-panel')).toContainText('is not installed');

    release();
    await expect(page.locator('issue-provider-tab input[name="search"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('issue-panel')).not.toContainText('is not installed');
  } finally {
    release();
  }
});
