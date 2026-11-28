import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

const readTitles = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    return Object.values(state?.tasks.entities ?? {}).map((task) => task!.title);
  });

for (const submitWith of ['Enter', 'the send button'] as const) {
  test(`submitting the focus task picker with ${submitWith} right after typing creates the typed title`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('button').filter({ hasText: 'center_focus_strong' }).click();
    await page.locator('focus-mode-main .select-task-cta').click();
    const picker = page.locator('focus-mode-task-selector');
    const input = picker.locator('input');
    await expect(input).toBeFocused();

    await input.fill('Write');
    // The send button enables once the picker has the text.
    await expect(picker.locator('button[mat-mini-fab]')).toBeEnabled();

    // The last keystroke and the submit land before the next change-detection
    // pass, as with fast typing or a paste followed by Enter.
    await input.evaluate((el: HTMLInputElement, via) => {
      el.value = 'Write the report';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (via === 'Enter') {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      } else {
        el.closest('focus-mode-task-selector')!
          .querySelector<HTMLButtonElement>('button[mat-mini-fab]')!
          .click();
      }
    }, submitWith);

    await expect(picker).toBeHidden();
    await expect.poll(() => readTitles(page)).toEqual(['Write the report']);
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect.poll(() => readTitles(page)).toEqual(['Write the report']);
  });
}
