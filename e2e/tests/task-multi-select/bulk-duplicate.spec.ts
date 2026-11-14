import { expect, test } from '../../fixtures/test.fixture';

for (const trigger of ['menu', 'shortcut'] as const) {
  test(`duplicates selected tasks beside their originals through the ${trigger}`, async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    for (const name of ['First', 'Second']) {
      await workViewPage.addTask(`${testPrefix} ${name}`);
    }
    const rows = page.locator('.task-list-inner[data-id="UNDONE"] > task');
    const originalIds = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-task-id')),
    );
    const titles = await rows.locator('task-title').allTextContents();
    for (const title of titles) {
      await taskPage.getTaskByText(title.trim()).click({ modifiers: ['Control'] });
    }
    const bar = page.locator('task-multi-select-bar .bar');
    await expect(bar).toContainText('2 selected');
    if (trigger === 'menu') {
      await bar.getByRole('button', { name: 'Actions' }).click();
      await page.getByRole('menuitem', { name: /Duplicate/ }).click();
    } else {
      await page.keyboard.press('Control+d');
    }
    await expect(rows).toHaveCount(4);
    await expect(rows.locator('task-title')).toHaveText(
      titles.flatMap((title) => [title.trim(), title.trim()]),
    );
    const ids = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-task-id')),
    );
    expect(ids.filter((_, index) => index % 2 === 0)).toEqual(originalIds);
    expect(new Set(ids).size).toBe(4);
    await expect(bar).toContainText('2 selected');
    for (const id of originalIds) {
      await expect(page.locator(`task[data-task-id="${id}"]`)).toHaveClass(
        /isMultiSelected/,
      );
    }
    await page.evaluate(() =>
      (
        window as unknown as {
          __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
        }
      ).__e2eTestHelpers.flushPendingWrites(),
    );
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(rows).toHaveCount(4);
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-task-id')),
      ),
    ).toEqual(ids);
  });
}

test('duplicates a selected parent and child once, then duplicates a standalone child', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const title = `${testPrefix} Parent`;
  await workViewPage.addTask(title);
  const parentId = await taskPage.getTaskByText(title).getAttribute('data-task-id');
  const parent = page.locator(`task[data-task-id="${parentId}"]`);
  await workViewPage.addSubTask(parent, `${testPrefix} Child`);
  const child = parent.locator('.sub-tasks task').first();
  await parent
    .locator('task-title')
    .first()
    .click({ modifiers: ['Control'] });
  await child.click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+d');
  const roots = page.locator('.task-list-inner[data-id="UNDONE"] > task');
  await expect(roots).toHaveCount(2);
  await expect(roots.nth(0).locator('.sub-tasks task')).toHaveCount(1);
  await expect(roots.nth(1).locator('.sub-tasks task')).toHaveCount(1);
  await expect(page.locator('task-multi-select-bar .bar')).toContainText('2 selected');
  await page.keyboard.press('Escape');
  const childId = await child.getAttribute('data-task-id');
  await child.click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+d');
  await expect(parent.locator('.sub-tasks task')).toHaveCount(2);
  await expect(roots.nth(1).locator('.sub-tasks task')).toHaveCount(1);
  expect(
    await parent.locator('.sub-tasks task').first().getAttribute('data-task-id'),
  ).toBe(childId);
  await expect(parent.locator('.sub-tasks task task-title')).toHaveText([
    `${testPrefix} Child`,
    `${testPrefix} Child`,
  ]);
  await expect(child.first()).toHaveClass(/isMultiSelected/);
});

test('keeps duplicate copies in the backlog beside their originals', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Project] Update Project',
      project: { id: 'INBOX_PROJECT', changes: { isEnableBacklog: true } },
    });
  });
  await page.goto('/#/project/INBOX_PROJECT/tasks?backlogPos=50');
  await workViewPage.waitForTaskList();
  for (const name of ['First', 'Second']) {
    await workViewPage.addTask(`${testPrefix} ${name}`);
    await taskPage
      .getTaskByText(`${testPrefix} ${name}`)
      .click({ modifiers: ['Control'] });
  }
  const bar = page.locator('task-multi-select-bar .bar');
  await bar.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Move to backlog/ }).click();
  const rows = page.locator('.backlog .task-list-inner > task');
  await expect(rows).toHaveCount(2);
  const titles = (await rows.locator('task-title').allTextContents()).map((t) =>
    t.trim(),
  );
  await page.keyboard.press('Control+d');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('task-title')).toHaveText(titles.flatMap((t) => [t, t]));
  await expect(page.locator('task').filter({ hasText: testPrefix })).toHaveCount(4);
  await expect(bar).toContainText('2 selected');
});

test('places future Planner copies after each selected original', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  for (const name of ['First', 'Second']) {
    await workViewPage.addTask(`${testPrefix} ${name}`);
    await taskPage
      .getTaskByText(`${testPrefix} ${name}`)
      .click({ modifiers: ['Control'] });
  }
  const bar = page.locator('task-multi-select-bar .bar');
  await bar.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Schedule task/ }).click();
  await page.locator('dialog-schedule-task datetime-picker button').nth(1).click();
  await page.goto('/#/planner');
  const rows = page.locator('planner-task');
  await expect(rows).toHaveCount(2);
  const ids = await rows.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute('data-task-id')),
  );
  for (const row of await rows.all()) await row.click({ modifiers: ['Control'] });
  await expect(bar).toContainText('2 selected');
  await page.keyboard.press('Control+d');
  await expect(rows).toHaveCount(4);
  const copiedIds = await rows.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute('data-task-id')),
  );
  expect(copiedIds.filter((_, index) => index % 2 === 0)).toEqual(ids);
  expect(new Set(copiedIds).size).toBe(4);
  await expect(bar).toContainText('2 selected');
  await page.evaluate(() =>
    (
      window as unknown as {
        __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
      }
    ).__e2eTestHelpers.flushPendingWrites(),
  );
  await page.reload();
  await expect(rows).toHaveCount(4);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-task-id')),
    ),
  ).toEqual(copiedIds);
});

test('keeps section copies adjacent inside their section', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  for (const name of ['First', 'Second'])
    await workViewPage.addTask(`${testPrefix} ${name}`);
  const rootRows = page.locator('.task-list-inner[data-id="UNDONE"] > task');
  const ids = await rootRows.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute('data-task-id')),
  );
  await page.evaluate((taskIds) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Section] Add Section',
      section: {
        id: 'duplicate-section',
        title: 'Duplicate section',
        contextId: 'INBOX_PROJECT',
        contextType: 'PROJECT',
        isExpanded: true,
        taskIds,
      },
    });
  }, ids);
  const rows = page.locator('.section-container task');
  await expect(rows).toHaveCount(2);
  const titles = (await rows.locator('task-title').allTextContents()).map((t) =>
    t.trim(),
  );
  for (const title of titles)
    await taskPage.getTaskByText(title).click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+d');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('task-title')).toHaveText(titles.flatMap((t) => [t, t]));
  await expect(page.locator('.no-section task')).toHaveCount(0);
  await expect(page.locator('task-multi-select-bar .bar')).toContainText('2 selected');
});
