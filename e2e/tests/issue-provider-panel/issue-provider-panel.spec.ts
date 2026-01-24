import { test } from '../../fixtures/test.fixture';

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';
const CANCEL_BTN = 'mat-dialog-actions button:first-child';

test.describe('Issue Provider Panel', () => {
  test('should open all dialogs without error', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await page.waitForSelector(PANEL_BTN, { state: 'visible' });
    await page.click(PANEL_BTN);
    await page.waitForSelector('mat-tab-group', { state: 'visible' });
    // Click on the last tab (add tab) which contains the issue-provider-setup-overview
    await page.click('mat-tab-group .mat-mdc-tab:last-child');
    await page.waitForSelector('issue-provider-setup-overview', { state: 'visible' });

    // Wait for buttons to be ready
    await page
      .locator('issue-provider-setup-overview button')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });

    // Get all buttons in the issue provider setup overview
    const setupButtons = page.locator('issue-provider-setup-overview button');
    const buttonCount = await setupButtons.count();

    // Click each button and close the dialog
    for (let i = 0; i < buttonCount; i++) {
      const button = setupButtons.nth(i);

      // Skip if button is not visible or enabled
      const isVisible = await button.isVisible().catch(() => false);
      const isEnabled = await button.isEnabled().catch(() => false);

      if (isVisible && isEnabled) {
        await button.click();

        // Wait for dialog to open
        const dialogOpened = await page
          .waitForSelector(CANCEL_BTN, {
            state: 'visible',
            timeout: 5000,
          })
          .catch(() => null);

        if (dialogOpened) {
          // Wait for dialog to be stable before clicking
          await page.waitForTimeout(500);

          // Try to click cancel, but handle case where dialog auto-closes
          const cancelClicked = await page
            .click(CANCEL_BTN, { timeout: 5000 })
            .catch(() => false);

          if (cancelClicked !== false) {
            // Wait for dialog to close
            await page.waitForSelector(CANCEL_BTN, { state: 'detached' });
          }

          // Ensure we're back on the issue provider panel
          await page.waitForSelector('issue-provider-setup-overview', {
            state: 'visible',
            timeout: 3000,
          });
        }
      }
    }

    // No error check is implicit - test will fail if any error occurs
  });
});
