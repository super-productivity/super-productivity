import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

const selectableCards = (page: Page): Locator =>
  page.locator('planner-task[data-task-selectable="true"]');

const cardWithTitle = (page: Page, title: string): Locator =>
  selectableCards(page).filter({ hasText: title });

const openPlanner = async (page: Page): Promise<void> => {
  const plannerPage = new PlannerPage(page);
  await plannerPage.navigateToPlanner();
  await plannerPage.waitForPlannerView();
  await expect(selectableCards(page).first()).toBeVisible();
};

test.describe('Planner keyboard navigation', () => {
  test('navigates through all-day and timed cards and across day boundaries', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const todayFirst = `${testPrefix}-Today first`;
    const todaySecond = `${testPrefix}-Today second`;
    const tomorrowAllDay = `${testPrefix}-Tomorrow all day`;
    const tomorrowTimed = `${testPrefix}-Tomorrow timed`;
    await workViewPage.addTask(todayFirst);
    await workViewPage.addTask(todaySecond);
    await workViewPage.addTask(`${tomorrowAllDay} @tomorrow`, false, null);
    await workViewPage.addTask(`${tomorrowTimed} @tomorrow 12:00`, false, null);

    await openPlanner(page);

    const first = cardWithTitle(page, todaySecond);
    const second = cardWithTitle(page, todayFirst);
    const tomorrowFirst = cardWithTitle(page, tomorrowAllDay);
    const tomorrowSecond = cardWithTitle(page, tomorrowTimed);
    await expect(first).toBeVisible();
    await expect(tomorrowSecond).toBeVisible();

    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tomorrowFirst).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(tomorrowSecond).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(second).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
  });

  test('keeps ranges within a day while modifier click can select across days', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const todayTitles = ['Range one', 'Range two', 'Range three'].map(
      (title) => `${testPrefix}-${title}`,
    );
    const tomorrowTitle = `${testPrefix}-Cross-day task`;
    for (const title of todayTitles) {
      await workViewPage.addTask(title);
    }
    await workViewPage.addTask(`${tomorrowTitle} @tomorrow`, false, null);
    await openPlanner(page);

    const todayCards = todayTitles.map((title) => cardWithTitle(page, title));
    await todayCards[2].click({ modifiers: ['Control'] });
    await todayCards[0].click({ modifiers: ['Shift'] });
    for (const card of todayCards) {
      await expect(card).toHaveClass(/isMultiSelected/);
    }

    const tomorrowCard = cardWithTitle(page, tomorrowTitle);
    await tomorrowCard.click({ modifiers: ['Control'] });
    await expect(tomorrowCard).toHaveClass(/isMultiSelected/);
    await expect(page.locator('task-multi-select-bar')).toContainText('4');

    await page.keyboard.press('Escape');
    await expect(page.locator('task-multi-select-bar')).toBeHidden();
    for (const card of [...todayCards, tomorrowCard]) {
      await expect(card).not.toHaveClass(/isMultiSelected/);
    }
  });

  test('selects a day with Ctrl+A and completes it while preserving card focus', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const firstTitle = `${testPrefix}-Bulk first`;
    const secondTitle = `${testPrefix}-Bulk second`;
    const tomorrowTitle = `${testPrefix}-Bulk tomorrow`;
    await workViewPage.addTask(firstTitle);
    await workViewPage.addTask(secondTitle);
    await workViewPage.addTask(`${tomorrowTitle} @tomorrow`, false, null);
    await openPlanner(page);

    const focusedCard = cardWithTitle(page, secondTitle);
    await focusedCard.focus();
    await page.keyboard.press('Control+a');
    await expect(page.locator('task-multi-select-bar')).toContainText('2');

    await page.keyboard.press('d');
    await expect(cardWithTitle(page, firstTitle)).toHaveClass(/isDone/);
    await expect(focusedCard).toHaveClass(/isDone/);
    await expect(cardWithTitle(page, tomorrowTitle)).not.toHaveClass(/isDone/);
    await expect(focusedCard).toBeFocused();
  });

  test('uses configured J and K navigation and restores focus after deleting a card', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const olderTitle = `${testPrefix}-Delete older`;
    const newerTitle = `${testPrefix}-Delete newer`;
    await workViewPage.addTask(olderTitle);
    await workViewPage.addTask(newerTitle);
    await openPlanner(page);

    const newerCard = cardWithTitle(page, newerTitle);
    const olderCard = cardWithTitle(page, olderTitle);
    await newerCard.focus();
    await page.keyboard.press('j');
    await expect(olderCard).toBeFocused();
    await page.keyboard.press('k');
    await expect(newerCard).toBeFocused();

    await page.keyboard.press('Backspace');
    await expect(page.locator('mat-dialog-container')).toBeVisible();
    await page.locator('[e2e="confirmBtn"]').click();
    await expect(newerCard).toHaveCount(0);
    await expect(olderCard).toBeFocused();
  });

  test('restores focus to the adjacent card after unscheduling the focused task', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const remainingTitle = `${testPrefix}-Unschedule remaining`;
    const removedTitle = `${testPrefix}-Unschedule removed`;
    await workViewPage.addTask(remainingTitle);
    await workViewPage.addTask(removedTitle);
    await openPlanner(page);

    const removedCard = cardWithTitle(page, removedTitle);
    const remainingCard = cardWithTitle(page, remainingTitle);
    await removedCard.focus();
    await page.keyboard.press('u');

    await expect(removedCard).toHaveCount(0);
    await expect(remainingCard).toBeFocused();
  });

  test('reorders all-day cards with the configured move shortcut', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const olderTitle = `${testPrefix}-Reorder older`;
    const newerTitle = `${testPrefix}-Reorder newer`;
    await workViewPage.addTask(olderTitle);
    await workViewPage.addTask(newerTitle);
    await openPlanner(page);

    const cards = selectableCards(page);
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(newerTitle);
    await cards.nth(0).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');

    await expect(cards.nth(0)).toContainText(olderTitle);
    await expect(cards.nth(1)).toContainText(newerTitle);
    await expect(cards.nth(1)).toBeFocused();
  });

  test('restores focus after the completion animation removes an overdue card', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const remainingTitle = `${testPrefix}-Completion remaining`;
    const overdueTitle = `${testPrefix}-Completion overdue`;
    await workViewPage.addTask(remainingTitle);
    await workViewPage.addTask(overdueTitle);
    await openPlanner(page);

    const overdueCard = cardWithTitle(page, overdueTitle);
    const remainingCard = cardWithTitle(page, remainingTitle);
    await overdueCard.click();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(page.locator('planner-day-overdue').locator(overdueCard)).toBeVisible();
    await expect(overdueCard).toBeFocused();

    await page.keyboard.press('d');

    await expect(overdueCard).toHaveCount(0);
    await expect(remainingCard).toBeFocused();
  });

  test('moves a focused all-day task between calendar days and keeps focus', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-Move between days`;
    await workViewPage.addTask(taskTitle);
    await openPlanner(page);

    const card = cardWithTitle(page, taskTitle);
    const dates = await page
      .locator('planner-day[data-day]')
      .evaluateAll((days) =>
        days.map((day) => day.getAttribute('data-day')).filter((day) => day !== null),
      );
    const initialDate = await card
      .locator('xpath=ancestor::planner-day')
      .getAttribute('data-day');
    const initialIndex = dates.indexOf(initialDate ?? '');
    expect(initialIndex).toBeGreaterThanOrEqual(0);
    expect(dates.length).toBeGreaterThan(initialIndex + 2);

    await card.click();
    await expect(card).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(card.locator('xpath=ancestor::planner-day')).toHaveAttribute(
      'data-day',
      dates[initialIndex + 1],
    );
    await expect(card).toBeFocused();

    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(card.locator('xpath=ancestor::planner-day')).toHaveAttribute(
      'data-day',
      dates[initialIndex + 2],
    );
    await expect(card).toBeFocused();

    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(card.locator('xpath=ancestor::planner-day')).toHaveAttribute(
      'data-day',
      dates[initialIndex + 1],
    );
    await expect(card).toBeFocused();
  });
});
