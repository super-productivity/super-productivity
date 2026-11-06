import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForAngularStability } from '../../utils/waits';
import { touchPan } from '../../utils/touch-pan';

// The swipe pager also renders the neighbouring days (inert) once touched.
const CURRENT_PAGE = '.page:not([inert])';

const openDayPanelInBottomSheet = async (page: Page): Promise<Locator> => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/tag/TODAY/tasks');
  await waitForAngularStability(page);

  await page.getByRole('button', { name: 'Side Panel Menu' }).click();
  await page.locator('.e2e-toggle-schedule-day-panel').click();

  const dayPanel = page.locator('bottom-panel-container schedule-day-panel');
  await expect(dayPanel).toBeVisible();
  return dayPanel;
};

const dayStr = (deltaDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
};

// Below 600px the right panel is replaced by a bottom sheet; the schedule day
// panel must render there too (it used to open an empty sheet).
test.describe('Schedule day panel on mobile', () => {
  test('renders today inside the bottom sheet, scrolled to now', async ({ page }) => {
    const dayPanel = await openDayPanelInBottomSheet(page);
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

  test('keeps the date visible and pages days by swipe and buttons', async ({ page }) => {
    const dayPanel = await openDayPanelInBottomSheet(page);
    const currentPage = dayPanel.locator(CURRENT_PAGE);
    const header = currentPage.locator('.week-header');
    const col = currentPage.locator('.grid-container .col').first();
    const dayPage = (day: string): Locator =>
      dayPanel.locator(`.page:has(.col[data-day="${day}"])`);
    const prevBtn = currentPage.getByRole('button', { name: 'Previous Day' });
    const nextBtn = currentPage.getByRole('button', { name: 'Next Day' });

    // The panel opens scrolled to now; the sticky date must stay in view.
    await expect(currentPage.locator('.current-time')).toBeInViewport();
    await expect(header).toBeInViewport();
    await expect(col).toHaveAttribute('data-day', dayStr(0));
    await expect(prevBtn).toBeDisabled();

    // Mid-pan, tomorrow follows the finger in from the right.
    await touchPan(page, dayPanel, -220, {
      beforeRelease: async () => {
        await expect(dayPage(dayStr(1))).toBeInViewport();
        await expect(dayPage(dayStr(0))).toBeInViewport();
      },
    });
    await expect(col).toHaveAttribute('data-day', dayStr(1));
    await expect(currentPage.locator('.current-time')).toHaveCount(0);
    await expect(header).toBeInViewport();

    await touchPan(page, dayPanel, -220);
    await expect(col).toHaveAttribute('data-day', dayStr(2));

    // A mostly vertical move scrolls instead of paging.
    await touchPan(page, dayPanel, -40, { deltaY: -200 });
    await expect(col).toHaveAttribute('data-day', dayStr(2));

    await touchPan(page, dayPanel, 220);
    await expect(col).toHaveAttribute('data-day', dayStr(1));
    await prevBtn.click();
    await expect(col).toHaveAttribute('data-day', dayStr(0));
    await nextBtn.click();
    await expect(col).toHaveAttribute('data-day', dayStr(1));
    await prevBtn.click();
    await expect(col).toHaveAttribute('data-day', dayStr(0));

    // Never pages into the past: the pan springs back.
    await touchPan(page, dayPanel, 220);
    await expect(col).toHaveAttribute('data-day', dayStr(0));
    await expect(header).toBeInViewport();
  });
});
