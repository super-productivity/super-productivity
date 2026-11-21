import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';
import { cssSelectors } from '../../constants/selectors';

const readNotes = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((s) => (state = s)).unsubscribe();
    return Object.values(state!.tasks.entities).find((t) =>
      t?.title.endsWith('Audit checklist'),
    )?.notes;
  });

const NOTES =
  'Intro\n\n```markdown\n- [x] example source\n- [ ] second source\n```\n\n- [x] completed item\n- [ ] real item\n\nTrailing prose';

test('clear completed checklist items preserves fenced source examples', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Audit checklist');
  await taskPage.openTaskDetail(taskPage.getTaskByText('Audit checklist'));
  const notes = page
    .locator(cssSelectors.DETAIL_PANEL)
    .locator('inline-markdown')
    .first();
  const editor = notes.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(NOTES);
  await editor.blur();
  await expect.poll(() => readNotes(page)).toBe(NOTES);
  await notes.hover();
  await notes
    .locator('button')
    .filter({ has: page.locator('mat-icon', { hasText: 'playlist_add_check' }) })
    .click();
  await page.getByRole('menuitem', { name: /clear completed/i }).click();
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  expect(await readNotes(page)).toBe(NOTES.replace('- [x] completed item\n', ''));
});
