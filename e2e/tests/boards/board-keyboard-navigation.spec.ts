import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled, waitForStatePersistence } from '../../utils/waits';

const openKanban = async (page: Page): Promise<void> => {
  await page.goto('/#/boards');
  await page
    .getByRole('tab')
    .filter({ hasText: /kanban/i })
    .click();
  await page.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(page.locator('[data-board-selection-scope="TODO"]')).toBeVisible();
};

test.describe('Board keyboard navigation', () => {
  test('keeps task focus while moving up and down within and between vertical panels', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await workViewPage.addTask(`${testPrefix}-${name}`);
    }
    await page.goto('/#/boards');
    await page.getByRole('tab').first().click();
    await page.getByRole('button', { name: /Create.*Tags/i }).click();
    const panels = page.locator('board-panel');
    const source = panels.nth(3).locator('planner-task');
    const target = panels.nth(1).locator('planner-task');
    await expect(source).toHaveCount(3);
    const movingId = await source.nth(1).getAttribute('data-task-id');
    await source.nth(1).click();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(source.first()).toHaveAttribute('data-task-id', movingId!);
    await expect(source.first()).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(target).toHaveCount(1);
    await expect(target).toHaveAttribute('data-task-id', movingId!);
    await expect(target).toBeFocused();
    // No panel above the top row: keep the card and focus in place.
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(target).toHaveCount(1);
    await expect(target).toBeFocused();

    // A group appends to the upper panel without focusing its existing first card.
    await source.last().focus();
    await page.keyboard.press('Shift+ArrowUp');
    const focusedId = await source.first().getAttribute('data-task-id');
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(source).toHaveCount(0);
    await expect(target).toHaveCount(3);
    await expect(target.nth(1)).toHaveAttribute('data-task-id', focusedId!);
    await expect(target.nth(1)).toBeFocused();

    await page.keyboard.press('Escape');
    await target.nth(1).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(target.last()).toHaveAttribute('data-task-id', focusedId!);
    await expect(target.last()).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(source).toHaveCount(1);
    await expect(source).toHaveAttribute('data-task-id', focusedId!);
    await expect(source).toBeFocused();

    // Moving down inserts before the lower panel's existing card.
    const nextId = await target.last().getAttribute('data-task-id');
    await target.last().focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(source).toHaveCount(2);
    await expect(source.first()).toHaveAttribute('data-task-id', nextId!);
    await expect(source.first()).toBeFocused();
    await source.last().focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(source).toHaveCount(2);
    await expect(source.last()).toBeFocused();
  });

  test('focuses on a single click and opens details on double click', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-Click task`);
    await openKanban(page);
    const card = page.locator('[data-board-selection-scope="TODO"] planner-task');
    const details = page.locator('task-detail-panel');
    await card.locator('.title').click();
    await expect(card).toBeFocused();
    await expect(details).toBeHidden();
    await card.locator('.title').dblclick();
    await expect(details).toBeVisible();
  });

  test('follows visual grid neighbors without wrapping, including after resize', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-Grid task`);
    await page.goto('/#/boards');
    await page.getByRole('tab').first().click();
    await page.getByRole('button', { name: /Create.*Tags/i }).click();
    const panels = page.locator('board-panel');
    await expect(panels).toHaveCount(4);
    const card = panels.nth(3).locator('planner-task');
    await expect(card).toHaveCount(1);
    await card.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(panels.nth(2).locator('add-task-inline button')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(panels.nth(2).locator('add-task-inline button')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(card).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    const moved = panels.nth(2).locator('planner-task');
    await expect(moved).toHaveCount(1);
    await expect(moved).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(moved).toHaveCount(1);
    await expect(panels.nth(1).locator('planner-task')).toHaveCount(0);

    await panels.nth(0).locator('add-task-inline button').focus();
    await page.keyboard.press('ArrowRight');
    await expect(panels.nth(1).locator('add-task-inline button')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(panels.nth(1).locator('add-task-inline button')).toBeFocused();

    await page.setViewportSize({ width: 375, height: 900 });
    await moved.focus();
    await page.keyboard.press('ArrowRight');
    await expect(moved).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(moved).toHaveCount(1);
    await expect(panels.nth(3).locator('planner-task')).toHaveCount(0);
  });

  test('does not move or reorder a selection spanning panels', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['First', 'Second', 'Third']) {
      await workViewPage.addTask(`${testPrefix}-${name}`);
    }
    await openKanban(page);
    const todo = page.locator('[data-board-selection-scope="TODO"] planner-task');
    const progress = page.locator(
      '[data-board-selection-scope="IN_PROGRESS"] planner-task',
    );
    const done = page.locator('[data-board-selection-scope="DONE"] planner-task');
    await todo.last().focus();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(progress).toHaveCount(1);
    const original = await todo.allTextContents();
    await progress.click({ modifiers: ['Control'] });
    await todo.first().click({ modifiers: ['Control'] });
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(todo).toHaveText(original);
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(todo).toHaveCount(2);
    await expect(progress).toHaveCount(1);
    await progress.focus();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(progress).toHaveCount(1);
    await expect(done).toHaveCount(0);
  });

  test('cancels or schedules a selected move with one dialog', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await openKanban(page);
    const todo = page.locator('[data-board-selection-scope="TODO"]');
    const progress = page.locator('[data-board-selection-scope="IN_PROGRESS"]');
    await todo.locator('add-task-inline button').click();
    for (const name of ['First', 'Second']) {
      await todo.locator('add-task-bar .main-input').fill(`${testPrefix}-${name}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('Escape');
    await todo.locator('header button').click();
    const editor = page.locator('dialog-board-edit');
    await editor.getByRole('radio', { name: 'Scheduled', exact: true }).nth(1).check();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const cards = todo.locator('planner-task');
    await expect(cards).toHaveCount(2);
    await cards.first().focus();
    await page.keyboard.press('Control+a');
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');
    await page.keyboard.press('Control+Shift+ArrowRight');
    const schedule = page.locator('dialog-schedule-task');
    await expect(schedule).toHaveCount(1);
    await schedule.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');
    await expect(cards).toHaveCount(2);
    await expect(progress.locator('planner-task')).toHaveCount(0);
    await cards.first().focus();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(schedule).toHaveCount(1);
    await schedule.getByRole('button', { name: /Tomorrow/ }).click();
    await expect(progress.locator('planner-task')).toHaveCount(2);
    await expect(cards).toHaveCount(0);
    await expect(schedule).toHaveCount(0);

    const scheduledCard = progress.locator('planner-task').first();
    await expect(scheduledCard.locator('.time-badge')).toBeVisible();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          scheduledCard.evaluate((card) => {
            const content = card.querySelector('swipe-block')!.getBoundingClientRect();
            const button = card.querySelector('.schedule-btn')!.getBoundingClientRect();
            return button.left >= content.right;
          }),
        )
        .toBe(true);
    }
    // The relocated control still opens scheduling rather than task details.
    await scheduledCard.locator('.schedule-btn').click();
    await expect(schedule).toHaveCount(1);
  });
  test('selects the correct duplicate cards and respects sorted panel order', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['Alpha', 'Beta', 'Gamma'])
      await workViewPage.addTask(`${testPrefix}-${name}`);
    await page.goto('/#/boards');
    await page.getByRole('tab').last().click();
    const form = page.locator('board-edit');
    await form
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(`${testPrefix}-Duplicates`);
    const titles = form.getByRole('textbox', { name: 'Title', exact: true });
    for (const [i, name] of ['First panel', 'Second panel'].entries()) {
      await form.getByRole('button', { name: 'Add new Panel' }).click();
      // The new panel row renders asynchronously; without this wait `.last()`
      // can still resolve to the previous row and overwrite its title.
      await expect(titles).toHaveCount(i + 2);
      await titles.last().fill(name);
    }
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    const panels = page.locator('board-panel');
    const first = panels.nth(0).locator('planner-task');
    const second = panels.nth(1).locator('planner-task');
    await expect(second).toHaveCount(3);
    await second.first().click({ modifiers: ['Control'] });
    await second.last().click({ modifiers: ['Shift'] });
    await expect(panels.nth(1).locator('.isMultiSelected')).toHaveCount(3);
    await expect(page.locator('task-multi-select-bar')).toContainText('3 selected');
    await page.keyboard.press('Escape');
    await second.first().focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(second.nth(1)).toContainText('Alpha');
    await expect(first.nth(0)).toContainText('Alpha');

    await panels.nth(1).locator('header button').click();
    const dialog = page.locator('dialog-board-edit');
    await dialog.getByRole('combobox', { name: 'Sort by', exact: true }).last().click();
    await page.getByRole('option', { name: 'Title', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(second.first()).toContainText('Alpha');
    await second.first().focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(second.first()).toContainText('Alpha');
    await expect(second.first()).toBeFocused();
  });
  test('navigates empty panels, moves a selection and persists its destination', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['First', 'Second', 'Third']) {
      await workViewPage.addTask(`${testPrefix}-${name}`);
    }
    await openKanban(page);
    const todo = page.locator('[data-board-selection-scope="TODO"]');
    const progress = page.locator('[data-board-selection-scope="IN_PROGRESS"]');
    const done = page.locator('[data-board-selection-scope="DONE"]');
    const cards = todo.locator('planner-task');
    await expect(cards).toHaveCount(3);
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(progress.locator('add-task-inline button')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(done.locator('add-task-inline button')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(cards.first()).toBeFocused();

    await page.keyboard.press('Shift+ArrowDown');
    await expect(todo.locator('.isMultiSelected')).toHaveCount(2);
    const focusedId = await cards.nth(1).getAttribute('data-task-id');
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(progress.locator('planner-task')).toHaveCount(2);
    await expect(cards).toHaveCount(1);
    await expect(
      progress.locator(`planner-task[data-task-id="${focusedId}"]`),
    ).toBeFocused();
    await expect(progress.locator('.isMultiSelected')).toHaveCount(2);

    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(done.locator('planner-task.isDone')).toHaveCount(2);
    await expect(progress.locator('planner-task')).toHaveCount(0);
    await waitForStatePersistence(page);
    await page.reload();
    await expect(done.locator('planner-task.isDone')).toHaveCount(2);
    await expect(todo.locator('planner-task')).toHaveCount(1);
  });

  test('reorders selected cards and restores focus after bulk deletion', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['First', 'Second', 'Third']) {
      await workViewPage.addTask(`${testPrefix}-${name}`);
    }
    await openKanban(page);
    const todo = page.locator('[data-board-selection-scope="TODO"]');
    const cards = todo.locator('planner-task');
    await expect(cards).toHaveCount(3);
    const original = await cards.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-task-id')),
    );
    await cards.first().focus();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect
      .poll(() =>
        cards.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-task-id'))),
      )
      .toEqual([original[2], original[0], original[1]]);
    await page.keyboard.press('Backspace');
    await page.locator('[e2e="confirmBtn"]').click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('d');
    await expect(cards).toHaveCount(0);
    await expect(todo.locator('add-task-inline button')).toBeFocused();
    await expect(
      page.locator('[data-board-selection-scope="DONE"] planner-task'),
    ).toHaveCount(1);
  });
});

test.describe('Board touch selection', () => {
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('enters selection from the card menu and toggles cards by tapping', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-First`);
    await workViewPage.addTask(`${testPrefix}-Second`);
    await openKanban(page);
    const cards = page.locator('[data-board-selection-scope="TODO"] planner-task');
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
    );
    await cards.first().focus();
    await page.keyboard.press('q');
    await waitForMenuSettled(page);
    await page.getByRole('menuitem', { name: /Select several tasks/ }).tap();
    await expect(page.locator('task-multi-select-bar')).toContainText('1 selected');
    await expect(cards.locator('done-toggle')).toHaveCount(0);
    await cards.last().tap();
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');
    await expect(
      page.locator('[data-board-selection-scope="TODO"] .cdk-drag-disabled'),
    ).toHaveCount(2);
    await cards.first().tap();
    await cards.last().tap();
    await expect(page.locator('task-multi-select-bar')).toBeHidden();
    await expect(cards.locator('done-toggle')).toHaveCount(2);
    await cards.first().tap();
    await expect(page.locator('task-detail-panel')).toBeVisible();
  });
});
