import { expect, test } from '../../fixtures/test.fixture';
import { waitForAngularStability } from '../../utils/waits';

// Below 600px the right panel is replaced by a bottom sheet; the schedule day
// panel must render there too (it used to open an empty sheet).
test.describe('Schedule day panel on mobile', () => {
  test('renders today inside the bottom sheet, scrolled to now', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/tag/TODAY/tasks');
    await waitForAngularStability(page);

    await page.getByRole('button', { name: 'Side Panel Menu' }).click();
    await page.locator('.e2e-toggle-schedule-day-panel').click();

    const dayPanel = page.locator('bottom-panel-container schedule-day-panel');
    await expect(dayPanel).toBeVisible();
    await expect(dayPanel.locator('schedule-week .grid-container')).toBeVisible();

    const currentTime = dayPanel.locator('.current-time');
    await expect(currentTime).toBeAttached();
    await expect
      .poll(async () => {
        const panelBox = await dayPanel.boundingBox();
        const nowBox = await currentTime.boundingBox();
        if (!panelBox || !nowBox) return false;
        return nowBox.y >= panelBox.y && nowBox.y <= panelBox.y + panelBox.height;
      })
      .toBe(true);
  });
});
