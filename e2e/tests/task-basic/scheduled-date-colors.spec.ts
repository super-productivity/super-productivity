import { expect, test } from '../../fixtures/test.fixture';

test('scheduled badges color date ranges in light and dark mode without changing text', async ({
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
    { days: 0, color: 'today' },
    { days: 1, color: 'tomorrow' },
    { days: 2, color: 'upcoming' },
    { days: 8, color: 'upcoming' },
    { days: 9, color: '' },
    { days: 1, color: 'tomorrow', timed: true },
    { days: 1, color: 'tomorrow', timed: true, reminder: true },
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
    for (const color of ['today', 'tomorrow', 'upcoming']) {
      const badge = page
        .locator('.schedule-btn[data-scheduled-date-color="' + color + '"] .time-badge')
        .first();
      const contrast = await badge.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const luminance = (css: string): number => {
          context.fillStyle = css;
          context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          const red = rgb[0] * 0.2126;
          const green = rgb[1] * 0.7152;
          const blue = rgb[2] * 0.0722;
          return red + green + blue;
        };
        const style = getComputedStyle(element);
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(
        contrast,
        color + ' contrast in ' + (dark ? 'dark' : 'light'),
      ).toBeGreaterThanOrEqual(4.5);
    }
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

test('updates elapsed dates, suppresses tracking colors and follows the Today tag color', async ({
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
  const changeTodayColor = async (color: string | null): Promise<void> => {
    await page.evaluate((value) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers.store;
      store.dispatch({
        type: '[Tag] Update Tag',
        tag: { id: 'TODAY', changes: { color: value } },
        meta: { isPersistent: true, entityType: 'TAG', entityId: 'TODAY', opType: 'UPD' },
      });
    }, color);
  };
  await schedule(120_000);
  await expect(button).toHaveAttribute('data-scheduled-date-color', 'today');
  await changeTodayColor('#008080');
  for (const dark of [false, true]) {
    await page.evaluate(
      (value) => document.body.classList.toggle('isDarkTheme', value),
      dark,
    );
    await expect(icon).toHaveCSS('color', 'rgb(0, 128, 128)');
    await expect(badge).toHaveCSS('color', 'rgb(0, 128, 128)');
  }
  await changeTodayColor(null);
  await expect(icon).not.toHaveCSS('color', 'rgb(0, 128, 128)');

  await schedule(3_000);
  await expect(button).toHaveAttribute('data-scheduled-date-color', 'today');
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
