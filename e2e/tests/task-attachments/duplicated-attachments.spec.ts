import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

const saveAttachment = async (page: Page, path: string): Promise<void> => {
  const dialog = page.locator('dialog-edit-task-attachment');
  const pathInput = dialog.locator('input[name="path"]');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  // A fill that lands while the dialog is still opening can be cleared again,
  // so fill until the value sticks and the form accepts it.
  await expect(async () => {
    await pathInput.fill(path);
    await expect(pathInput).toHaveValue(path, { timeout: 1000 });
    await expect(save).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await save.click();
  await expect(dialog).toHaveCount(0);
};

const attachmentPath = (page: Page, domId: string | null): Promise<string | undefined> =>
  page.evaluate((id) => {
    let state: RootState | undefined;
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return state?.tasks.entities[id!.slice(2)]?.attachments[0]?.path;
  }, domId);

test('duplicate attachment edits and deletion stay scoped to the copied task', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('attachment-original');
  const original = taskPage.getTaskByText('attachment-original');
  const originalId = await original.getAttribute('id');
  await original.focus();
  await page.keyboard.press('i');
  const panel = page.locator('task-detail-panel');
  await panel.locator('task-detail-item').filter({ hasText: 'Links & Files' }).click();
  await page
    .locator('dialog-edit-task-attachment input[name="title"]')
    .fill('Synthetic original link');
  await saveAttachment(page, 'https://attachment.example.test/original');
  await expect
    .poll(() => attachmentPath(page, originalId))
    .toBe('https://attachment.example.test/original');
  await page.keyboard.press('Escape');
  await page.locator(`[id="${originalId}"]`).focus();
  await page.keyboard.press('Control+d');
  const copy = page.locator('task').filter({ hasText: '(copy)' });
  await expect(copy).toHaveCount(1);
  const copyId = await copy.getAttribute('id');
  await expect
    .poll(() => attachmentPath(page, copyId))
    .toBe('https://attachment.example.test/original');
  await copy.focus();
  if (!(await panel.isVisible())) await page.keyboard.press('i');
  await panel.locator('.attachment').hover();
  await panel.locator('.edit-btn').click();
  await saveAttachment(page, 'https://attachment.example.test/copied');
  await expect
    .poll(() => attachmentPath(page, copyId))
    .toBe('https://attachment.example.test/copied');
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await page.locator(`[id="${originalId}"]`).focus();
  if (!(await panel.isVisible())) await page.keyboard.press('i');
  await expect
    .poll(() => attachmentPath(page, originalId))
    .toBe('https://attachment.example.test/original');
  await page.keyboard.press('Escape');
  await page.locator(`[id="${copyId}"]`).focus();
  if (!(await panel.isVisible())) await page.keyboard.press('i');
  await expect
    .poll(() => attachmentPath(page, copyId))
    .toBe('https://attachment.example.test/copied');
  await panel.locator('.attachment').hover();
  await panel.locator('.trash-btn').click();
  const confirm = page.locator('[e2e="confirmBtn"]');
  if (await confirm.isVisible()) await confirm.click();
  await expect(panel.locator('a.attachment-link')).toHaveCount(0);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await page.locator(`[id="${originalId}"]`).focus();
  if (!(await panel.isVisible())) await page.keyboard.press('i');
  await expect
    .poll(() => attachmentPath(page, originalId))
    .toBe('https://attachment.example.test/original');
  const copiedAttachments = await page.evaluate((domId) => {
    let state: RootState | undefined;
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return state?.tasks.entities[domId!.slice(2)]?.attachments;
  }, copyId);
  expect(copiedAttachments).toEqual([]);
});

test('duplicating a family preserves parent and child attachments after reload', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('linked-family');
  const parent = taskPage.getTaskByText('linked-family').first();
  await workViewPage.addSubTask(parent, 'linked-child');
  for (const [row, path] of [
    [parent, 'parent'],
    [parent.locator('.sub-tasks task'), 'child'],
  ] as const) {
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('l');
    await saveAttachment(page, `https://attachment.example.test/${path}`);
  }
  await parent.press('Control+d');
  await expect(page.locator('task').filter({ hasText: '(copy)' })).toHaveCount(1);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  const attachments = await page.evaluate(() => {
    let state: RootState | undefined;
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    const roots = Object.values(state!.tasks.entities).filter((t) => t && !t.parentId);
    const original = roots.find((t) => !t!.title.includes('(copy)'))!;
    const copy = roots.find((t) => t!.title.includes('(copy)'))!;
    return {
      original: original.attachments,
      copy: copy.attachments,
      child: state!.tasks.entities[original.subTaskIds[0]]!.attachments,
      copiedChild: state!.tasks.entities[copy.subTaskIds[0]]!.attachments,
      count: state!.tasks.ids.length,
    };
  });
  expect(attachments.count).toBe(4);
  expect(attachments.original).toHaveLength(1);
  expect(attachments.child).toHaveLength(1);
  expect(attachments.copy).toEqual(attachments.original);
  expect(attachments.copiedChild).toEqual(attachments.child);
});
