import { type Page, expect } from '@playwright/test';

/**
 * Fills a time input field with the specified time.
 * Handles both mat-form-field wrapped inputs and plain time inputs.
 * Uses retry logic to ensure the value is properly set.
 *
 * @param page - Playwright page object
 * @param scheduleTime - Date object or timestamp for the desired time
 */
export const fillTimeInput = async (
  page: Page,
  scheduleTime: Date | number,
): Promise<void> => {
  const d = new Date(scheduleTime);
  const timeValue = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

  // Try multiple selectors for the time input
  const timeInput = page
    .locator('mat-dialog-container input[type="time"]')
    .or(page.locator('mat-form-field input[type="time"]'))
    .or(page.locator('input[type="time"]'))
    .first();
  await timeInput.waitFor({ state: 'visible', timeout: 10000 });

  // Click and focus the input
  await timeInput.click();

  // Clear and fill with small delays for stability
  await timeInput.clear();
  await timeInput.fill(timeValue);

  // Verify with retry - if fill() didn't work, use evaluate fallback
  const inputValue = await timeInput.inputValue();
  if (inputValue !== timeValue) {
    await page.evaluate(
      ({ value }: { value: string }) => {
        const timeInputEl = document.querySelector(
          'mat-form-field input[type="time"]',
        ) as HTMLInputElement;
        if (timeInputEl) {
          timeInputEl.value = value;
          timeInputEl.dispatchEvent(new Event('input', { bubbles: true }));
          timeInputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      { value: timeValue },
    );
  }

  // Verify the value was set
  await expect(async () => {
    const value = await timeInput.inputValue();
    expect(value).toBe(timeValue);
  }).toPass({ timeout: 5000 });

  // Tab out to commit the value
  await page.keyboard.press('Tab');
};
