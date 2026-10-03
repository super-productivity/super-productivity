import { readFileSync, writeFileSync } from 'node:fs';
import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import { ImportPage } from '../../pages/import.page';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getLocalOpLogSummary,
  waitForTask,
  archiveTask,
  navigateToWorkView,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

type Priority = 'high' | 'medium' | 'low' | 1 | 2 | 3 | null;
interface Backup {
  data: {
    task: { entities: Record<string, TaskData> };
    archiveYoung: { task: { entities: Record<string, TaskData> } };
  };
}
interface TaskData {
  id: string;
  title: string;
  priority?: Priority;
  notes?: string;
}

const tasks = (page: Page): Promise<TaskData[]> =>
  page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              fn: (s: { tasks: { entities: Record<string, TaskData> } }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    return new Promise((resolve) => {
      const sub = store.subscribe((state) => {
        setTimeout(() => sub.unsubscribe());
        resolve(Object.values(state.tasks.entities));
      });
    });
  });

const update = async (
  page: Page,
  id: string,
  changes: Partial<TaskData>,
): Promise<void> => {
  await page.evaluate(
    ({ id: taskId, changes: taskChanges }) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers.store;
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id: taskId, changes: taskChanges },
        meta: { isPersistent: true, entityType: 'TASK', entityId: taskId, opType: 'UPD' },
      });
    },
    { id, changes },
  );
};

const exportBackup = async (page: Page): Promise<Backup> => {
  const imex = new ImportPage(page);
  await imex.navigateToImportPage();
  const download = page.waitForEvent('download');
  await imex.exportBackupBtn.click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
};

for (const [legacy, numeric] of [
  ['high', 3],
  ['medium', 2],
  ['low', 1],
] as const) {
  test(`@supersync restores saved ${legacy} priority filters after reload`, async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
    try {
      for (const [title, priority] of [
        ['Legacy priority', legacy],
        ['Numeric priority', numeric],
        ['Other priority', null],
      ] as const) {
        await a.workView.addTask(title);
        const task = (await tasks(a.page)).find((t) => t.title.endsWith(title))!;
        await update(a.page, task.id, { priority });
      }
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      await a.sync.setupSuperSync(config);
      await b.sync.setupSuperSync(config);
      await waitForTask(b.page, 'Other priority');
      await b.page.evaluate((preset) => {
        localStorage.setItem(
          'SUP_TASK_VIEW_CUSTOMIZER_BY_CONTEXT',
          JSON.stringify({
            ['TAG:TODAY']: { filter: { type: 'priority', preset, label: 'Priority' } },
          }),
        );
      }, legacy);
      await b.page.reload();
      await waitForAppReady(b.page);
      await expect(b.page.locator('task')).toHaveCount(2);
      await expect(
        b.page.locator('task-title', { hasText: 'Legacy priority' }),
      ).toBeVisible();
      await expect(
        b.page.locator('task-title', { hasText: 'Numeric priority' }),
      ).toBeVisible();
      await expect(
        b.page.locator('task-title', { hasText: 'Other priority' }),
      ).not.toBeAttached();
      await b.page
        .getByRole('button', { name: 'Toggle filter/group/sort panel', exact: true })
        .click();
      await b.page.getByRole('menuitem', { name: /Filter By/ }).click();
      await b.page.getByRole('menuitem', { name: 'Priority', exact: true }).click();
      const selected = b.page.getByRole('menuitem', {
        name: new RegExp(legacy, 'i'),
      });
      await expect(selected).toHaveClass(/active/);
      await expect(selected.locator('mat-icon')).toHaveText('check');
    } finally {
      await closeClient(a);
      await closeClient(b);
    }
  });
}

test('@supersync preserves mixed priority encodings through import, both sync directions and restart', async ({
  browser,
  baseURL,
  testRunId,
}, testInfo) => {
  test.slow();
  const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
  const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
  try {
    // Generate a real current backup, then put historical wire values into it.
    const priorities: Priority[] = ['high', 'medium', 'low', 3, 2, 1, null];
    for (let i = 0; i < priorities.length; i++) {
      await a.workView.addTask(`Priority ${i}`);
    }
    const backup = await exportBackup(a.page);
    const ids = priorities.map((priority, i) => {
      const task = Object.values(backup.data.task.entities).find((t) =>
        t.title.endsWith(`Priority ${i}`),
      )!;
      task.priority = priority;
      return task.id;
    });
    const file = testInfo.outputPath('mixed-priorities.json');
    writeFileSync(file, JSON.stringify(backup));
    await new ImportPage(a.page).importBackupFile(file);
    const assertPriorities = async (page: Page): Promise<void> => {
      const current = await tasks(page);
      expect(ids.map((id) => current.find((t) => t.id === id)?.priority)).toEqual(
        priorities,
      );
    };
    // Before the fix the actual import auto-fixer erases 'high'/'medium'/'low'.
    await assertPriorities(a.page);
    const config = getSuperSyncConfig(await createTestUser(testRunId));
    await a.sync.setupSuperSync(config);
    await b.sync.setupSuperSync(config);
    await assertPriorities(b.page);
    // Change each encoding so this cannot pass when a remote update is ignored.
    for (const [sender, receiver, nextPriorities] of [
      [a, b, [3, 2, 1, 'high', 'medium', 'low', null]],
      [b, a, [...priorities]],
    ] as const) {
      priorities.splice(0, priorities.length, ...nextPriorities);
      for (let i = 0; i < priorities.length; i++) {
        await update(sender.page, ids[i], {
          priority: priorities[i],
        });
      }
      await sender.sync.syncAndWait();
      await receiver.sync.syncAndWait();
      await assertPriorities(receiver.page);
      // An unrelated edit must leave every original encoding intact too.
      await update(receiver.page, ids[1], { notes: receiver.clientName });
      await receiver.sync.syncAndWait();
      await sender.sync.syncAndWait();
      await assertPriorities(sender.page);
      expect((await tasks(sender.page)).find((t) => t.id === ids[1])?.notes).toBe(
        receiver.clientName,
      );
    }
    await waitForTask(a.page, 'Priority 0');
    const row = a.page
      .locator('task')
      .filter({ has: a.page.locator('task-title', { hasText: /Priority 0$/ }) });
    await expect(row.locator('task-priority-indicator')).toHaveAttribute(
      'data-priority',
      '3',
    );
    const before = (await getLocalOpLogSummary(a.page)).length;
    await row.click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: /Priority/, exact: false }).click();
    const high = a.page.getByRole('menuitemradio', { name: /High/ });
    await expect(high).toHaveAttribute('aria-checked', 'true');
    await high.click();
    await a.sync.syncAndWait();
    expect((await getLocalOpLogSummary(a.page)).length).toBe(before);
    await assertPriorities(a.page);
    // Archive and restore one task from each encoding, including remote archive
    // storage and the full backup boundary before restoring from the worklog.
    for (const i of [0, 3]) {
      await navigateToWorkView(a);
      await archiveTask(a, `Priority ${i}`);
    }
    await a.sync.syncAndWait();
    await b.sync.syncAndWait();
    for (const client of [a, b]) {
      const archived = await exportBackup(client.page);
      for (const i of [0, 3]) {
        expect(archived.data.archiveYoung.task.entities[ids[i]].priority).toBe(
          priorities[i],
        );
      }
    }
    for (const i of [0, 3]) {
      await a.page.goto('/#/tag/TODAY/history');
      await a.page.locator('history .week-row .day-toggle').first().click();
      await a.page
        .locator('.task-summary-table tr', { hasText: `Priority ${i}` })
        .getByRole('button', { name: 'Restore task from archive' })
        .click();
      await a.page.getByRole('button', { name: 'Do it!' }).click();
      await waitForTask(a.page, `Priority ${i}`);
    }
    await a.sync.syncAndWait();
    await navigateToWorkView(b);
    await b.sync.syncAndWait();
    await assertPriorities(a.page);
    await assertPriorities(b.page);
    await update(b.page, ids[0], { priority: null });
    priorities[0] = null;
    await b.sync.syncAndWait();
    await a.sync.syncAndWait();
    for (const client of [a, b]) {
      await client.page.reload();
      await waitForAppReady(client.page);
      await assertPriorities(client.page);
      const exported = await exportBackup(client.page);
      expect(ids.map((id) => exported.data.task.entities[id].priority)).toEqual(
        priorities,
      );
    }
  } finally {
    await closeClient(a);
    await closeClient(b);
  }
});
