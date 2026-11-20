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

test('confirming an IME candidate with Enter keeps editing the task title', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('IME original');
  const [original] = await readTitles(page);
  await page.locator('task task-title .display-value').click();
  const input = page.locator('task task-title textarea');
  await input.fill('');

  // Chromium's IME emulation: the Enter that confirms the candidate is a
  // keydown with isComposing set, as with a real Japanese or Chinese IME.
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', {
    text: '日本',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect.poll(() => readTitles(page)).toEqual([original]);

  await input.press('End');
  await page.keyboard.insertText('の予定');
  await input.press('Enter');
  await session.detach();
  await expect.poll(() => readTitles(page)).toEqual(['日本の予定']);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect.poll(() => readTitles(page)).toEqual(['日本の予定']);
});
