import { expect, test } from '../../fixtures/test.fixture';
import { ensureGlobalAddTaskBarOpen } from '../../utils/element-helpers';

test('pastes image attachments, previews them, removes one and saves the task', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const input = await ensureGlobalAddTaskBarOpen(page);
  await input.fill(`${testPrefix} image task`);
  await input.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#4682b4';
    context.fillRect(0, 0, 32, 24);
    const dataUrl = canvas.toDataURL('image/png');
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    for (const name of ['first.png', 'second.png', 'third.png']) {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], name, { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  const images = page.locator('add-task-bar.global .draft-image img');
  await expect(images).toHaveCount(3);
  await expect(images.first()).toHaveJSProperty('naturalWidth', 32);
  await images.first().click();
  const preview = page.locator('dialog-draft-image');
  await expect(preview).toContainText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(preview).toContainText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(input).toHaveValue(`${testPrefix} image task`);
  await page.locator('add-task-bar.global .draft-image-remove').nth(1).click();
  await expect(images).toHaveCount(2);
  await input.focus();
  await page.keyboard.press('Escape');
  await ensureGlobalAddTaskBarOpen(page);
  await expect(images).toHaveCount(2);
  await expect(input).toHaveValue(`${testPrefix} image task`);
  await page.screenshot({ path: '.tmp/quick-add-images-preview.png' });
  await input.focus();
  await page.keyboard.press('Enter');
  const task = page.locator('task').filter({ hasText: `${testPrefix} image task` });
  await expect(task).toBeVisible();
  // A reload verifies that task creation persisted, rather than just the draft UI.
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(task).toBeVisible();
  await taskPage.openTaskDetail(task);
  const savedImages = page.locator('task-attachment-list img');
  await expect(savedImages).toHaveCount(2);
  await expect(savedImages.first()).toHaveJSProperty('naturalWidth', 32);
});
