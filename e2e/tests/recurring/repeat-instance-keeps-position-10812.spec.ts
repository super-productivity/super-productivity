import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import type { ProjectPage } from '../../pages/project.page';
import type { TaskPage } from '../../pages/task.page';
import type { WorkViewPage } from '../../pages/work-view.page';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/10812
 *
 * A new repeat instance went to the top of the project, outside the section
 * that held the previous instance. It now takes the previous instance's place
 * in the project's lists and sections.
 *
 * Same clock strategy as #6230: `setSystemTime` (not `setFixedTime`) so the
 * day-change effect's `debounceTime` keeps working after the jump past midnight.
 */
const getTaskId = (task: Locator): Promise<string> =>
  task.evaluate((el: HTMLElement) => {
    const host = el.closest('task') ?? el;
    return (host as HTMLElement).dataset.taskId ?? '';
  });

/**
 * Section membership is seeded via dispatch because the only UI path to it is
 * drag-and-drop (same reasoning as `global-search-collapsed-section-8780.spec.ts`).
 */
const seedProjectSectionContaining = async (
  page: Page,
  opts: { projectId: string; taskId: string; sectionId: string; title: string },
): Promise<void> => {
  await page.evaluate(({ projectId, taskId, sectionId, title }) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Section] Add Section',
      section: {
        id: sectionId,
        contextId: projectId,
        contextType: 'PROJECT',
        title,
        taskIds: [],
        isExpanded: true,
      },
    });
    store.dispatch({
      type: '[Section] Add Task to Section',
      sectionId,
      taskId,
      afterTaskId: null,
      sourceSectionId: null,
    });
  }, opts);
};

/** Starts at 23:55 the day before, in a new project. Returns the project id. */
const startInProjectOnDayBefore = async (
  page: Page,
  workViewPage: WorkViewPage,
  projectPage: ProjectPage,
  projectName: string,
): Promise<string> => {
  await page.clock.setSystemTime(new Date('2026-06-15T23:55:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await projectPage.createProject(projectName);
  await projectPage.navigateToProjectByName(projectName);
  await expect(page).toHaveURL(/#\/project\/[^/]+\/tasks/);
  return page.url().match(/#\/project\/([^/]+)\/tasks/)?.[1] ?? '';
};

const addTasks = async (
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
  titles: string[],
): Promise<void> => {
  // New tasks go to the top, so add them bottom first
  for (const title of [...titles].reverse()) {
    await workViewPage.addTask(title);
    await expect(taskPage.getTaskByText(title).first()).toBeVisible();
  }
};

const makeDailyAndComplete = async (
  page: Page,
  taskPage: TaskPage,
  title: string,
): Promise<void> => {
  await taskPage.openTaskDetail(taskPage.getTaskByText(title).first());
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');

  await taskPage.markTaskAsDone(
    taskPage.getUndoneTasks().filter({ hasText: title }).first(),
  );
  await expect(taskPage.getDoneTasks().filter({ hasText: title }).first()).toBeVisible({
    timeout: 5000,
  });
};

const moveToNextDay = async (page: Page): Promise<void> => {
  await page.clock.setSystemTime(new Date('2026-06-16T00:05:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
};

test.describe('Repeat instance keeps the previous instance position (#10812)', () => {
  test('goes into the project section that held the previous instance', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    const other = `${testPrefix}-Other`;
    const daily = `${testPrefix}-Daily`;
    const sectionTitle = `${testPrefix}-Routine`;

    const projectId = await startInProjectOnDayBefore(
      page,
      workViewPage,
      projectPage,
      `${testPrefix}-Project`,
    );
    await addTasks(workViewPage, taskPage, [other, daily]);
    await seedProjectSectionContaining(page, {
      projectId,
      taskId: await getTaskId(taskPage.getTaskByText(daily).first()),
      sectionId: `${testPrefix}-section-id`,
      title: sectionTitle,
    });
    const section = page.locator('collapsible').filter({ hasText: sectionTitle });
    await expect(section.locator('task').filter({ hasText: daily })).toHaveCount(1);

    await makeDailyAndComplete(page, taskPage, daily);
    await moveToNextDay(page);

    await expect(taskPage.getUndoneTasks().filter({ hasText: daily })).toHaveCount(1, {
      timeout: 60000,
    });
    await expect(
      section.locator('task:not(.isDone)').filter({ hasText: daily }),
    ).toHaveCount(1);
  });

  test('keeps the project order of daily tasks', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    const titles = ['First', 'Second', 'Third'].map((t) => `${testPrefix}-${t}`);
    const inOrder = titles.map((t) => new RegExp(t));

    await startInProjectOnDayBefore(
      page,
      workViewPage,
      projectPage,
      `${testPrefix}-Project`,
    );
    await addTasks(workViewPage, taskPage, titles);
    await expect(taskPage.getUndoneTasks()).toHaveText(inOrder);

    for (const title of titles) {
      await makeDailyAndComplete(page, taskPage, title);
    }
    await moveToNextDay(page);

    await expect(taskPage.getUndoneTasks()).toHaveCount(titles.length, {
      timeout: 60000,
    });
    await expect(taskPage.getUndoneTasks()).toHaveText(inOrder);
  });
});
