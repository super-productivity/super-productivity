import type { Store } from '@ngrx/store';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

for (const field of ['spent', 'estimate']) {
  test(`typing the previous ${field} value after moving the dial saves the typed value`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Dial input probe');
    await page.locator('task').focus();
    await page.keyboard.press('t');
    const dialog = page.locator('dialog-time-estimate');
    const slider = dialog.locator('input-duration-slider').nth(field === 'spent' ? 0 : 1);
    const input = slider.locator('input');
    await input.fill('1h');
    await input.press('Tab');
    await expect(input).toHaveValue('1h');
    // The real dial's three-o'clock position adds 15 minutes to this hour.
    const circle = slider.locator('.circle');
    const box = await circle.boundingBox();
    if (!box) throw new Error('Duration dial has no bounds');
    await circle.click({ position: { x: box.width - 4, y: box.height / 2 } });
    await expect(input).not.toHaveValue('1h');
    // Replace/paste the earlier value (a single native input event).
    await input.fill('1h');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden();
    const readValue = (): Promise<number> =>
      page.evaluate((name) => {
        const store = (
          window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
        ).__e2eTestHelpers.store;
        let state: RootState | undefined;
        store.subscribe((s) => (state = s)).unsubscribe();
        const task = Object.values(state!.tasks.entities)[0]!;
        return name === 'spent' ? task.timeSpent : task.timeEstimate;
      }, field);
    await expect.soft.poll(readValue, { timeout: 1000 }).toBe(3600000);
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect.poll(readValue, { timeout: 1000 }).toBe(3600000);
  });
}
