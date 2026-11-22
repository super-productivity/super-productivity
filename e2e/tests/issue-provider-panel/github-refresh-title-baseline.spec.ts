import type { Page } from '@playwright/test';
import type { Task } from '../../../src/app/features/tasks/task.model';
import { expect, test } from '../../fixtures/test.fixture';

const readTasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              next: (s: { tasks: { entities: Record<string, Task> } }) => void,
            ) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers;
    let result: Task[] = [];
    helpers.store
      .subscribe((s) => (result = Object.values(s.tasks.entities)))
      .unsubscribe();
    return result;
  });

const updateTask = (
  page: Page,
  taskId: string,
  taskChanges: Partial<Task>,
): Promise<void> =>
  page.evaluate(
    async ({ id, changes }) => {
      const helpers = (
        window as unknown as {
          __e2eTestHelpers: {
            store: { dispatch: (action: unknown) => void };
            flushPendingWrites: () => Promise<void>;
          };
        }
      ).__e2eTestHelpers;
      helpers.store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id, changes },
        isIgnoreShortSyntax: true,
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
      });
      await helpers.flushPendingWrites();
    },
    { id: taskId, changes: taskChanges },
  );

const flush = (page: Page): Promise<void> =>
  page.evaluate(() =>
    (
      window as unknown as {
        __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
      }
    ).__e2eTestHelpers.flushPendingWrites(),
  );

const importGithubTask = async (page: Page): Promise<string> => {
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/audit');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('Audit issue');
  await page
    .locator('issue-preview-item', { hasText: 'Audit issue' })
    .getByRole('button')
    .first()
    .click();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  const task = page.locator('task', { hasText: '#42 Audit issue' });
  await expect(task).toBeVisible();
  return (await task.getAttribute('data-task-id'))!;
};

const refresh = async (page: Page, id: string): Promise<void> => {
  await page
    .locator(`task[data-task-id="${id}"]`)
    .first()
    .locator('task-title')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Update issue data' }).click();
};

test.describe('GitHub refresh preserves local work', () => {
  test.setTimeout(90000);
  test('unrelated remote edits preserve local title, notes, estimates, time and schedule', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    let version = 0;
    await page.route('https://api.github.com/**', async (route) => {
      const issue = {
        id: 42,
        number: 42,
        title: 'Audit issue',
        body: version ? 'Updated remote body' : 'Remote body',
        state: version === 1 ? 'closed' : 'open',
        html_url: 'https://github.com/e2e/audit/issues/42',
        created_at: '2026-09-01T12:00:00Z',
        updated_at: `2026-09-0${version + 1}T12:00:00Z`,
        comments: 0,
        labels: [],
      };
      await route.fulfill({
        json: route.request().url().includes('/search/issues')
          ? { items: [issue] }
          : issue,
      });
    });
    const id = await importGithubTask(page);
    const local = {
      title: 'Local plan',
      notes: 'Local research',
      timeEstimate: 3600000,
      timeSpent: 600000,
      timeSpentOnDay: { ['2026-10-23']: 600000 },
      dueDay: '2030-06-12',
      dueWithTime: undefined,
    };
    await updateTask(page, id, local);
    await expect
      .poll(async () => (await readTasks(page)).find((t) => t.id === id)?.title)
      .toBe(local.title);
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    version = 1;
    await refresh(page, id);
    await expect
      .poll(async () => (await readTasks(page)).find((t) => t.id === id)?.isDone)
      .toBe(true);
    let current = (await readTasks(page)).find((t) => t.id === id)!;
    for (const key of [
      'title',
      'notes',
      'timeEstimate',
      'timeSpent',
      'timeSpentOnDay',
      'dueDay',
    ] as const) {
      expect(current[key]).toEqual(local[key]);
    }
    version = 2;
    await refresh(page, id);
    await expect
      .poll(async () => (await readTasks(page)).find((t) => t.id === id)?.isDone)
      .toBe(false);
    await flush(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    current = (await readTasks(page)).find((t) => t.id === id)!;
    for (const key of [
      'title',
      'notes',
      'timeEstimate',
      'timeSpent',
      'timeSpentOnDay',
      'dueDay',
    ] as const) {
      expect(current[key]).toEqual(local[key]);
    }
  });
});
