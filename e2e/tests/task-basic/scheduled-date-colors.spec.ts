import { expect, test } from '../../fixtures/test.fixture';

test('scheduled badges color only overdue dates in light and dark mode without changing text', async ({
  page,
  workViewPage,
  testPrefix,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );

  const ranges = [
    { days: -1, color: 'overdue' },
    { days: 0, color: '' },
    { days: 1, color: '' },
    { days: 8, color: '' },
    { days: 1, color: '', timed: true },
    { days: 1, color: '', timed: true, reminder: true },
    { days: 0, color: 'overdue', timed: true, elapsed: true },
  ];
  for (const range of ranges) {
    const title =
      testPrefix +
      ' date ' +
      range.days +
      (range.timed ? ' timed' : '') +
      (range.reminder ? ' reminder' : '');
    await workViewPage.addTask(title);
    const row = page
      .locator('task')
      .filter({ has: page.locator('task-title', { hasText: title }) });
    const taskId = await row.getAttribute('data-task-id');
    await page.evaluate(
      ({ id, days, timed, reminder, elapsed }) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const dueDay = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-');
        date.setHours(23, 59, 0, 0);
        const dueWithTime = elapsed ? Date.now() - 60_000 : date.getTime();
        const changes = {
          dueDay,
          ...(timed ? { dueWithTime } : {}),
          ...(reminder ? { remindAt: dueWithTime } : {}),
        };
        const store = (
          window as unknown as {
            __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
          }
        ).__e2eTestHelpers.store;
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id, changes },
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      },
      {
        id: taskId,
        days: range.days,
        timed: !!range.timed,
        reminder: !!range.reminder,
        elapsed: !!range.elapsed,
      },
    );
    await expect(row.locator('.schedule-btn')).toHaveAttribute(
      'data-scheduled-date-color',
      range.color,
    );
  }

  const badges = page.locator('.schedule-btn .time-badge');
  const text = await badges.allTextContents();
  for (const dark of [false, true]) {
    await page.evaluate(
      (isDark) => document.body.classList.toggle('isDarkTheme', isDark),
      dark,
    );
    // Overdue retains the existing warning palette in either mode.
    const overdue = page
      .locator('.schedule-btn[data-scheduled-date-color="overdue"]')
      .first();
    const warningColors = await overdue.evaluate((button) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--c-warn)';
      button.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return {
        expected,
        actual: getComputedStyle(button.querySelector('mat-icon')!).color,
      };
    });
    expect(warningColors.actual).toBe(warningColors.expected);
    const matchingColors = await page.locator('.schedule-btn').evaluateAll((buttons) =>
      buttons.map((button) => {
        const icon = button.querySelector('mat-icon')!;
        const badge = button.querySelector('.time-badge')!;
        return {
          icon: getComputedStyle(icon).color,
          badge: getComputedStyle(badge).color,
        };
      }),
    );
    for (const colors of matchingColors) expect(colors.icon).toBe(colors.badge);
    expect(await badges.allTextContents()).toEqual(text);
    await page.screenshot({
      path:
        '.tmp/e2e-test-results/scheduled-date-colors-' +
        (dark ? 'dark' : 'light') +
        '.png',
      fullPage: true,
    });
  }
});

test('updates elapsed dates and suppresses color while tracking', async ({
  page,
  workViewPage,
  testPrefix,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );
  const title = testPrefix + ' live schedule';
  await workViewPage.addTask(title);
  const row = page
    .locator('task')
    .filter({ has: page.locator('task-title', { hasText: title }) });
  const taskId = await row.getAttribute('data-task-id');
  const button = row.locator('.schedule-btn');
  const icon = button.locator('mat-icon');
  const badge = button.locator('.time-badge');
  const schedule = async (delayMs: number): Promise<void> => {
    await page.evaluate(
      ({ id, delay }) => {
        const store = (
          window as unknown as {
            __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
          }
        ).__e2eTestHelpers.store;
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id, changes: { dueWithTime: Date.now() + delay, dueDay: null } },
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      },
      { id: taskId, delay: delayMs },
    );
  };
  await schedule(3_000);
  await expect(button).toHaveAttribute('data-scheduled-date-color', '');
  const textBefore = await badge.textContent();
  await expect(button).toHaveAttribute('data-scheduled-date-color', 'overdue');
  expect(await badge.textContent()).toBe(textBefore);
  const red = await icon.evaluate((element) => getComputedStyle(element).color);
  await expect(badge).toHaveCSS('color', red);

  // Cover both today's elapsed time and yesterday's existing overdue host state.
  for (const delayMs of [-60_000, -24 * 60 * 60 * 1000]) {
    await schedule(delayMs);
    await expect(button).toHaveAttribute('data-scheduled-date-color', 'overdue');
    await row.hover();
    await row.locator('.start-task-btn').click();
    await expect(row).toHaveClass(/isCurrent/);
    await expect(button).toHaveAttribute('data-scheduled-date-color', '');
    await expect(icon).not.toHaveCSS('color', red);
    await expect(badge).not.toHaveCSS('color', red);
    await row.hover();
    await row
      .locator('task-hover-controls button')
      .filter({
        has: page.locator('mat-icon', { hasText: /^pause$/ }),
      })
      .click();
    await expect(row).not.toHaveClass(/isCurrent/);
    await expect(button).toHaveAttribute('data-scheduled-date-color', 'overdue');
    await expect(icon).toHaveCSS('color', red);
    await expect(badge).toHaveCSS('color', red);
  }
});

test('colors overdue Board cards like task rows', async ({
  page,
  workViewPage,
  testPrefix,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );

  const title = testPrefix + ' Board overdue color';
  await workViewPage.addTask(title);
  const inboxRow = page
    .locator('task')
    .filter({ has: page.locator('task-title', { hasText: title }) });
  const taskId = await inboxRow.getAttribute('data-task-id');
  await page.evaluate((id) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDay = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('-');
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { dueDay, dueWithTime: null } },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  }, taskId);
  await expect(inboxRow.locator('.schedule-btn')).toHaveAttribute(
    'data-scheduled-date-color',
    'overdue',
  );

  await page.goto('/#/boards');
  await page
    .getByRole('tab')
    .filter({ hasText: /kanban/i })
    .click();
  const kanban = page.getByRole('tabpanel', { name: 'Kanban', exact: true });
  await expect(kanban).toBeVisible();
  await expect(kanban).not.toHaveClass(/mat-tab-body-animating/);
  const createTag = kanban.getByRole('button', { name: 'Create Tag', exact: true });
  await createTag.click();

  const card = page
    .locator('[data-board-selection-scope="TODO"] planner-task')
    .filter({ hasText: title });
  await expect(card).toBeVisible();
  const button = card.locator('.schedule-btn');
  await expect(button).toHaveAttribute('data-scheduled-date-color', 'overdue');

  for (const dark of [false, true]) {
    await page.evaluate(
      (value) => document.body.classList.toggle('isDarkTheme', value),
      dark,
    );
    const colors = await button.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--c-warn)';
      element.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return {
        expected,
        icon: getComputedStyle(element.querySelector('mat-icon')!).color,
        badge: getComputedStyle(element.querySelector('.time-badge')!).color,
      };
    });
    expect(colors.icon).toBe(colors.expected);
    expect(colors.badge).toBe(colors.expected);
  }
});
