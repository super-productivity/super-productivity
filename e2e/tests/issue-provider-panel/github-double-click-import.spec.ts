import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import type { RootState } from '../../../src/app/root-store/root-state';
import type { Task } from '../../../src/app/features/tasks/task.model';

const state = (page: Page): Promise<RootState> =>
  page.evaluate(() => {
    const h = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (s: RootState) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    let result!: RootState;
    h.store
      .subscribe((s) => {
        result = s;
      })
      .unsubscribe();
    return result;
  });
const linked = async (page: Page): Promise<Task[]> =>
  Object.values((await state(page)).tasks.entities).filter(
    (t): t is Task => !!t && t.issueId === '43',
  );
const flush = (page: Page): Promise<void> =>
  page.evaluate(() =>
    (
      window as unknown as {
        __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
      }
    ).__e2eTestHelpers.flushPendingWrites(),
  );

const setup = async (page: Page): Promise<void> => {
  await page.route('https://api.github.com/**', async (route) => {
    const issue = {
      id: 43,
      number: 43,
      title: 'Synthetic import issue',
      body: 'Synthetic remote body',
      state: 'open',
      html_url: 'https://github.com/e2e/import/issues/43',
      created_at: '2026-09-01T12:00:00Z',
      updated_at: '2026-09-01T12:00:00Z',
      comments: 0,
      labels: [],
    };
    await route.fulfill({
      json: route.request().url().includes('/search/issues') ? { items: [issue] } : issue,
    });
  });
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/import');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('Synthetic import');
  await expect(page.locator('issue-preview-item')).toHaveCount(1);
};

test('double-clicking an issue add button creates one linked task', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await setup(page);
  // The optimized E2E build has no ng.getComponent. Locate the instantiated
  // service through the existing store helper; keep this probe local to this test.
  const imports = await page.evaluateHandle(() => {
    type ImportService = {
      addTaskFromIssue: (...args: unknown[]) => Promise<unknown>;
      _taskService: { _taskArchiveService: { load: () => Promise<unknown> } };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { injector: { records: Map<unknown, { value: unknown } | null> } };
        };
      }
    ).__e2eTestHelpers.store;
    const service = [...store.injector.records.values()]
      .map((record) => record?.value)
      .find(
        (value): value is ImportService =>
          !!value && typeof (value as ImportService).addTaskFromIssue === 'function',
      );
    if (!service) throw new Error('IssueService instance not found');
    const pending: Promise<unknown>[] = [];
    let settled = 0;
    let archiveLoads = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const archive = service._taskService._taskArchiveService;
    const originalLoad = archive.load;
    archive.load = async () => {
      archiveLoads++;
      const result = await originalLoad.call(archive);
      await gate;
      return result;
    };
    const originalImport = service.addTaskFromIssue;
    service.addTaskFromIssue = (...args) => {
      const promise = originalImport.apply(service, args).finally(() => {
        settled++;
      });
      pending.push(promise);
      maxActive = Math.max(maxActive, pending.length - settled);
      return promise;
    };
    return {
      status: () => ({ calls: pending.length, ready: settled + archiveLoads, maxActive }),
      finish: () => {
        release();
        return Promise.allSettled(pending);
      },
      restore: () => {
        release();
        archive.load = originalLoad;
        service.addTaskFromIssue = originalImport;
      },
    };
  });
  try {
    await page.locator('issue-preview-item').getByRole('button').first().dblclick();
    // Each call must either reach the held archive read or settle (the guard's
    // early return). Holding the first read guarantees the clicks overlap.
    await expect
      .poll(() => imports.evaluate((probe) => probe.status()))
      .toEqual({
        calls: 2,
        ready: 2,
        maxActive: 2,
      });
    const results = await imports.evaluate((probe) => probe.finish());
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
  } finally {
    await imports.evaluate((probe) => probe.restore());
    await imports.dispose();
  }
  expect((await linked(page)).length).toBe(1);
  await flush(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  expect((await linked(page)).length).toBe(1);
});
