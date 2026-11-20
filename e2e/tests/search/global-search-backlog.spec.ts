import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * A search jump must land ON the task, not merely in its project: with a long
 * list the highlighted row is otherwise off-screen and the user has to hunt for
 * it (2026-11 user survey).
 *
 * Both lists are long on purpose — the target only proves anything if it sits
 * below the fold of its own scroll container.
 *
 * Tasks and sections are seeded via dispatch: ~60 tasks through the add-task
 * bar would dominate the run, and section membership has no UI path other than
 * drag-and-drop. Same `__e2eTestHelpers.store` mechanism as
 * `global-search-collapsed-section-8780.spec.ts`; the seed actions carry no
 * `meta`, so they prove the reducers and the render path, not the sync path.
 * Everything after the seed (searching, clicking) is real UI.
 */
const LIST_LENGTH = 30;

type SeedTask = { id: string; title: string; isBacklog: boolean };

const getActiveProjectId = (page: Page): string => {
  const match = page.url().match(/\/project\/([^/?]+)/);
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[1];
};

const seedProjectTasks = async (
  page: Page,
  opts: { projectId: string; tasks: SeedTask[] },
): Promise<void> => {
  await page.evaluate(({ projectId, tasks }) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;

    store.dispatch({
      type: '[Project] Update Project',
      project: { id: projectId, changes: { isEnableBacklog: true } },
    });
    for (const { id, title, isBacklog } of tasks) {
      store.dispatch({
        type: '[Task Shared] addTask',
        task: {
          id,
          title,
          projectId,
          subTaskIds: [],
          timeSpentOnDay: {},
          timeSpent: 0,
          timeEstimate: 0,
          isDone: false,
          tagIds: [],
          created: Date.now(),
          attachments: [],
        },
        workContextId: projectId,
        workContextType: 'PROJECT',
        isAddToBacklog: isBacklog,
        isAddToBottom: true,
      });
    }
  }, opts);
};

const buildList = (prefix: string, kind: string, isBacklog: boolean): SeedTask[] =>
  Array.from({ length: LIST_LENGTH }, (_, i) => {
    const nr = String(i).padStart(2, '0');
    return { id: `${prefix}-${kind}-${nr}`, title: `${prefix}-${kind}-${nr}`, isBacklog };
  });

// The URL switches to /search once the page's DOM exists, but before its first change
// detection binds `[formControl]`; a fill in that gap is wiped by the control's initial
// `writeValue('')`. The page focuses the input only after init, so wait for that.
const searchAndOpen = async (page: Page, term: string): Promise<void> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  const input = page.locator('search-page .search-field input');
  await expect(input).toBeFocused();
  await input.fill(term);
  const result = page.locator('search-page mat-list-item').filter({ hasText: term });
  await expect(result).toHaveCount(1);
  await result.click();
};

const expectRevealedAndFocused = async (page: Page, taskId: string): Promise<void> => {
  const taskRow = page.locator(`task[data-task-id="${taskId}"]`);
  await expect(taskRow).toBeVisible();
  // `toBeVisible` is true for a row scrolled out of its container; only the
  // viewport check says the user can actually see it.
  await expect(taskRow).toBeInViewport({ ratio: 0.9 });
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
    .toBe(`t-${taskId}`);
};

test.describe('Global Search — long project lists', () => {
  test('scrolls to and focuses a task in the project backlog', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    const projectId = getActiveProjectId(page);

    const backlog = buildList(testPrefix, 'Backlog', true);
    await seedProjectTasks(page, {
      projectId,
      tasks: [...buildList(testPrefix, 'Main', false), ...backlog],
    });
    // Near the end of the backlog: far below the fold of the half-height pane.
    const target = backlog[LIST_LENGTH - 4];
    await expect(page.locator(`task[data-task-id="${backlog[0].id}"]`)).toHaveCount(0);

    await searchAndOpen(page, target.title);

    await expect(page).toHaveURL(new RegExp(`/project/${projectId}/tasks`));
    await expectRevealedAndFocused(page, target.id);
  });

  test('scrolls to and focuses a task in a collapsed project section', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    const projectId = getActiveProjectId(page);

    const main = buildList(testPrefix, 'Main', false);
    await seedProjectTasks(page, { projectId, tasks: main });
    // Sections render below the unsectioned tasks, so this one starts off-screen.
    const target = main[LIST_LENGTH - 1];
    const sectionId = `${testPrefix}-section-id`;
    await page.evaluate(
      ({ contextId, id, taskId, title }) => {
        const store = (
          window as unknown as {
            __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
          }
        ).__e2eTestHelpers.store;
        store.dispatch({
          type: '[Section] Add Section',
          section: {
            id,
            contextId,
            contextType: 'PROJECT',
            title,
            taskIds: [],
            isExpanded: false,
          },
        });
        store.dispatch({
          type: '[Section] Add Task to Section',
          sectionId: id,
          taskId,
          afterTaskId: null,
          sourceSectionId: null,
        });
      },
      {
        contextId: projectId,
        id: sectionId,
        taskId: target.id,
        title: `${testPrefix}-Section`,
      },
    );
    // Premise: a collapsed section leaves the task with no DOM node at all.
    await expect(page.locator(`task[data-task-id="${main[0].id}"]`)).toBeVisible();
    await expect(page.locator(`task[data-task-id="${target.id}"]`)).toHaveCount(0);

    await searchAndOpen(page, target.title);

    await expect(page).toHaveURL(new RegExp(`/project/${projectId}/tasks`));
    await expectRevealedAndFocused(page, target.id);
  });
});
