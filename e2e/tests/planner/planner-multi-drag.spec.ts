import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';
import {
  dropTaskDrag as drop,
  startTaskDrag as startDrag,
} from '../../utils/task-multi-drag';
import { flushPendingWrites } from '../../utils/waits';

const cardWithTitle = (page: Page, title: string): Locator =>
  page.locator('planner-task[data-task-selectable="true"]').filter({ hasText: title });

const dayOf = (card: Locator): Promise<string | null> =>
  card.locator('xpath=ancestor::planner-day').getAttribute('data-day');

const openPlanner = async (page: Page): Promise<void> => {
  const plannerPage = new PlannerPage(page);
  await plannerPage.navigateToPlanner();
  await plannerPage.waitForPlannerView();
  await expect(page.locator('planner-task').first()).toBeVisible();
};

const dayList = (page: Page, day: string): Locator =>
  page.locator(`planner-day[data-day="${day}"] .normal-tasks-items`);

test.describe('Planner multi-task drag', () => {
  test('moves a selected group to another day in order and keeps it there', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const [first, stay, second] = ['First', 'Stay', 'Second'].map(
      (title) => `${testPrefix}-${title}`,
    );
    const tomorrowTitle = `${testPrefix}-Tomorrow`;
    for (const title of [second, stay, first]) await workViewPage.addTask(title);
    await workViewPage.addTask(`${tomorrowTitle} @tomorrow`, false, null);
    await openPlanner(page);

    const today = await dayOf(cardWithTitle(page, first));
    const tomorrow = await dayOf(cardWithTitle(page, tomorrowTitle));
    if (!today || !tomorrow) throw new Error('Missing planner days');
    expect(tomorrow).not.toBe(today);
    const todayTitles = dayList(page, today).locator('planner-task');
    await expect(todayTitles).toHaveText([
      new RegExp(first),
      new RegExp(stay),
      new RegExp(second),
    ]);

    await cardWithTitle(page, first).click({ modifiers: ['Control'] });
    await cardWithTitle(page, second).click({ modifiers: ['Control'] });
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');

    await startDrag(page, cardWithTitle(page, second));
    await expect(page.locator('.multi-task-drag-preview')).toContainText('2 selected');
    await drop(page, dayList(page, tomorrow), true);
    await expect(page.locator('.cdk-drag-preview')).toBeHidden();

    const expected = [new RegExp(first), new RegExp(second), new RegExp(tomorrowTitle)];
    const tomorrowCards = dayList(page, tomorrow).locator('planner-task');
    await expect(tomorrowCards).toHaveText(expected);
    await expect(todayTitles).toHaveText([new RegExp(stay)]);

    await flushPendingWrites(page);
    await page.reload();
    await openPlanner(page);
    await expect(tomorrowCards).toHaveText(expected);
    await expect(todayTitles).toHaveText([new RegExp(stay)]);
  });

  test('brings an overdue card along when a group is dropped on a day', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const overdueTitle = `${testPrefix}-Overdue`;
    const todayTitle = `${testPrefix}-Today`;
    const tomorrowTitle = `${testPrefix}-Tomorrow`;
    await workViewPage.addTask(todayTitle);
    await workViewPage.addTask(overdueTitle);
    await workViewPage.addTask(`${tomorrowTitle} @tomorrow`, false, null);
    await openPlanner(page);

    const overdueCard = cardWithTitle(page, overdueTitle);
    await overdueCard.focus();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(page.locator('planner-day-overdue').locator(overdueCard)).toBeVisible();
    const tomorrow = await dayOf(cardWithTitle(page, tomorrowTitle));
    if (!tomorrow) throw new Error('Missing tomorrow');

    await overdueCard.click({ modifiers: ['Control'] });
    await cardWithTitle(page, todayTitle).click({ modifiers: ['Control'] });
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');

    await startDrag(page, cardWithTitle(page, todayTitle));
    await drop(page, dayList(page, tomorrow), true);
    await expect(page.locator('.cdk-drag-preview')).toBeHidden();

    await expect(dayList(page, tomorrow).locator('planner-task')).toHaveText([
      new RegExp(overdueTitle),
      new RegExp(todayTitle),
      new RegExp(tomorrowTitle),
    ]);
    await expect(page.locator('planner-day-overdue planner-task')).toHaveCount(0);
  });

  test('moves an overdue-led group to a sidebar project without eating the next drop', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Group target');
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const overdueTitle = `${testPrefix}-Overdue`;
    const todayTitle = `${testPrefix}-Today`;
    const nextTitle = `${testPrefix}-Next`;
    const tomorrowTitle = `${testPrefix}-Tomorrow`;
    await workViewPage.addTask(nextTitle);
    await workViewPage.addTask(todayTitle);
    await workViewPage.addTask(overdueTitle);
    await workViewPage.addTask(`${tomorrowTitle} @tomorrow`, false, null);
    await openPlanner(page);

    const overdueCard = cardWithTitle(page, overdueTitle);
    await overdueCard.focus();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(page.locator('planner-day-overdue').locator(overdueCard)).toBeVisible();
    const tomorrow = await dayOf(cardWithTitle(page, tomorrowTitle));
    if (!tomorrow) throw new Error('Missing tomorrow');
    const target = page
      .locator('nav-item[data-project-id]')
      .filter({ hasText: 'Group target' })
      .first();
    if (!(await target.isVisible()))
      await page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .locator('nav-item button')
        .first()
        .click();

    await overdueCard.click({ modifiers: ['Control'] });
    await cardWithTitle(page, todayTitle).click({ modifiers: ['Control'] });
    await expect(page.locator('task-multi-select-bar')).toContainText('2 selected');
    // The Overdue card leads, so the drag returns to the Overdue list.
    await startDrag(page, overdueCard);
    await expect(page.locator('.multi-task-drag-preview')).toContainText('2 selected');
    await drop(page, target);
    await expect(page.locator('.cdk-drag-preview')).toBeHidden();

    // A plain drag right after must still move its card.
    await page
      .locator('task-multi-select-bar')
      .getByRole('button', { name: 'Clear selection' })
      .click();
    await expect(page.locator('task-multi-select-bar')).toBeHidden();
    await startDrag(page, cardWithTitle(page, nextTitle));
    await drop(page, dayList(page, tomorrow), true);
    await expect(page.locator('.cdk-drag-preview')).toBeHidden();
    await expect(
      cardWithTitle(page, nextTitle).locator('xpath=ancestor::planner-day'),
    ).toHaveAttribute('data-day', tomorrow);

    await projectPage.navigateToProjectByName('Group target');
    for (const title of [overdueTitle, todayTitle])
      await expect(page.locator('task').filter({ hasText: title })).toHaveCount(1);
  });
});
