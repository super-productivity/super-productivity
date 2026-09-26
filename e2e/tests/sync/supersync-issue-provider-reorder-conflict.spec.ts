import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { IssueProvider } from '../../../src/app/features/issue/issue.model';
import { JiraWorklogExportDefaultTime } from '../../../src/app/features/issue/providers/jira/jira.model';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { readMigratedState } from '../../utils/legacy-migration-helpers';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

// Seeds and witnesses use the established store fixture path. Both conflicted
// operations MUST come from the real panel drag and editor or pinned search.
type Row = CompactOperationLogEntry;
interface Snapshot {
  issueProvider: { ids: string[]; entities: Record<string, IssueProvider> };
  tasks: string[];
  config: { animations: boolean; hideEvaluation: boolean };
}

const dispatch = async (
  page: Page,
  value: Record<string, unknown> | Record<string, unknown>[],
): Promise<void> => {
  await page.evaluate(async (action) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    for (const item of Array.isArray(action) ? action : [action]) store.dispatch(item);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, value);
};
const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    type State = {
      issueProvider: Snapshot['issueProvider'];
      tasks: { entities: Record<string, { title: string }> };
      globalConfig: {
        misc: { isDisableAnimations: boolean };
        evaluation: { isHideEvaluationSheet: boolean };
      };
    };
    let state!: State;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return {
      issueProvider: state.issueProvider,
      tasks: Object.values(state.tasks.entities)
        .map((t) => t.title)
        .sort(),
      config: {
        animations: state.globalConfig.misc.isDisableAnimations,
        hideEvaluation: state.globalConfig.evaluation.isHideEvaluationSheet,
      },
    };
  });
const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Row[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
const pending = (entries: Row[]): Row[] =>
  entries.filter((r) => r.source === 'local' && !r.syncedAt && !r.rejectedAt);
const replacements = (entries: Row[]): string[] =>
  entries
    .filter((r) => ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(r.op.o))
    .map((r) => r.op.id)
    .sort();

// Like the strict S2 helper: never choose a dataset winner or mask a safety stop.
const syncOutcome = async (client: SimulatedE2EClient): Promise<string> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(
      async () => {
        outcome = (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncCheckIcon
                  .filter({ hasText: /^done_all$/ })
                  .isVisible())
              ? 'in-sync'
              : 'pending';
        return outcome;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  return outcome;
};
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  expect(await syncOutcome(client)).toBe('in-sync');
};
const openPanel = async (page: Page): Promise<void> => {
  if (!(await page.locator('issue-panel').isVisible())) {
    await page.locator('.e2e-toggle-issue-provider-panel:visible').click();
  }
  await expect(page.locator('issue-panel [role="tab"]')).toHaveCount(4);
};
const drag = async (page: Page): Promise<void> => {
  await openPanel(page);
  const tabs = page.locator('issue-panel .tab-header-item.cdk-drag');
  await tabs.nth(0).hover();
  const from = await tabs.nth(0).boundingBox();
  const to = await tabs.nth(1).boundingBox();
  if (!from || !to) throw new Error('Provider drag targets missing');
  const halfWidth = from.width / 2;
  const halfHeight = from.height / 2;
  const x = from.x + halfWidth;
  const y = from.y + halfHeight;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y);
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + to.width - 3, y, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
};
const edit = async (page: Page): Promise<void> => {
  await openPanel(page);
  await page.locator('issue-panel [role="tab"]').nth(0).click();
  await page.locator('issue-provider-tab:visible header button').click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await expect(dialog).toBeVisible();
  // changeEnabled submits immediately with the full model. Cancel only closes
  // the already-saved dialog, avoiding a second update from the Save button.
  const enabled = dialog.getByRole('switch', { name: 'Enabled', exact: true });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
};
const pinSearch = async (page: Page): Promise<void> => {
  await openPanel(page);
  await page.locator('issue-panel [role="tab"]').nth(0).click();
  const tab = page.locator('issue-provider-tab:visible');
  await tab
    .getByRole('textbox', { name: 'Search', exact: true })
    .fill('synthetic search');
  await tab.locator('mat-icon', { hasText: /^bookmark_add$/ }).click();
  await expect(tab.locator('mat-icon', { hasText: /^bookmark$/ })).toBeVisible();
};
type ProviderKey = 'GITLAB' | 'JIRA';
const provider = (id: string, index: number, providerKey: ProviderKey): IssueProvider => {
  const common = {
    id,
    isEnabled: index !== 2,
    isAutoPoll: false,
    isAutoAddToBacklog: false,
    isIntegratedAddTaskBar: false,
    defaultProjectId: 'INBOX_PROJECT',
    pinnedSearch: null,
    pollingMode: 'whenProjectOpen' as const,
    defaultTagIds: [],
    defaultNote: `Synthetic note ${index}`,
  };
  // Keep the two siblings on GitLab to exercise mixed provider membership too.
  return providerKey === 'JIRA' && index === 0
    ? {
        ...common,
        issueProviderKey: 'JIRA',
        _isBlockAccess: false,
        host: 'https://jira.example.invalid/',
        userName: 'synthetic-user',
        password: 'synthetic-only-not-a-credential',
        usePAT: false,
        allowFetchFallback: true,
        altPublicLinkHost: null,
        isAllowSelfSignedCertificate: false,
        searchJqlQuery: '',
        autoAddBacklogJqlQuery: '',
        isWorklogEnabled: false,
        isAddWorklogOnSubTaskDone: false,
        worklogDialogDefaultTime: JiraWorklogExportDefaultTime.AllTime,
        isUpdateIssueFromLocal: false,
        isShowComponents: true,
        isCheckToReAssignTicketOnTaskStart: false,
        storyPointFieldId: null,
        isTransitionIssuesEnabled: false,
        transitionConfig: { IN_PROGRESS: 'ALWAYS_ASK', DONE: 'ALWAYS_ASK' },
        availableTransitions: [],
        userToAssignOnDone: null,
      }
    : {
        ...common,
        issueProviderKey: 'GITLAB',
        project: `synthetic/provider-${index}`,
        gitlabBaseUrl: 'https://issues.example.invalid/',
        token: 'synthetic-only-not-a-credential',
        filterUsername: 'synthetic-user',
        scope: 'all',
        filter: 'state=opened',
        isEnableTimeTracking: false,
      };
};
const mockProviderRequests = async (page: Page): Promise<void> => {
  await page.route('https://*.example.invalid/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        new URL(route.request().url()).hostname === 'jira.example.invalid'
          ? { issues: [], total: 0, startAt: 0, maxResults: 50 }
          : [],
      ),
    }),
  );
};
const seedProviders = async (
  page: Page,
  ids: string[],
  providerKey: ProviderKey = 'GITLAB',
): Promise<void> => {
  for (const [index, id] of ids.entries()) {
    await dispatch(page, {
      type: '[IssueProvider/API] Add IssueProvider',
      issueProvider: provider(id, index, providerKey),
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityId: id,
        opType: 'CRT',
      },
    });
  }
};
const configWitness = async (page: Page, side: 'A' | 'B'): Promise<void> => {
  const sectionKey = side === 'A' ? 'misc' : 'evaluation';
  await dispatch(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey,
    sectionCfg:
      side === 'A' ? { isDisableAnimations: true } : { isHideEvaluationSheet: true },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: sectionKey,
      opType: 'UPD',
    },
  });
};

interface Scenario {
  pendingOrder: boolean;
  remoteNewer: boolean;
  interrupted?: boolean;
  compact?: boolean;
  providerKey?: ProviderKey;
  pinnedSearch?: boolean;
}
const scenarios: Scenario[] = [
  { pendingOrder: true, remoteNewer: true },
  { pendingOrder: false, remoteNewer: true },
  { pendingOrder: true, remoteNewer: false },
  { pendingOrder: false, remoteNewer: false },
  { pendingOrder: true, remoteNewer: true, interrupted: true },
  { pendingOrder: false, remoteNewer: true, interrupted: true },
  { pendingOrder: true, remoteNewer: true, interrupted: true, compact: true },
  { pendingOrder: true, remoteNewer: true, providerKey: 'JIRA' },
  { pendingOrder: false, remoteNewer: true, providerKey: 'JIRA' },
  { pendingOrder: true, remoteNewer: false, providerKey: 'JIRA' },
  { pendingOrder: false, remoteNewer: false, providerKey: 'JIRA' },
  { pendingOrder: true, remoteNewer: true, pinnedSearch: true },
  { pendingOrder: false, remoteNewer: false, pinnedSearch: true },
];
for (const scenario of scenarios) {
  test(`@supersync provider ${scenario.pendingOrder ? 'local-order' : 'local-edit'} / ${scenario.remoteNewer ? 'remote-newer' : 'local-newer'}${scenario.providerKey ? ' / ' + scenario.providerKey : ''}${scenario.pinnedSearch ? ' / pinned search' : ''}${scenario.compact ? ' / compacted missing proof' : scenario.interrupted ? ' / interrupted upload retry' : ''}`, async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(scenario.compact ? 240000 : 180000);
    const clients: SimulatedE2EClient[] = [];
    const logs: string[] = [];
    const evidence: Record<string, unknown> = {
      baseline: 'db3549b114ed3954f70add9cf8388af676cb2bfb',
      scenario,
      browser: browser.version(),
    };
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const makeClient = async (name: string): Promise<SimulatedE2EClient> => {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        client.page.on('console', (m) => logs.push(`${name}: ${m.text()}`));
        await mockProviderRequests(client.page);
        await client.workView.waitForTaskList();
        await client.sync.setupSuperSync(config);
        // Keep restart under manual control as well as the current page.
        await client.page.addInitScript(() => {
          (
            window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
          ).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        return client;
      };
      const a = await makeClient('A');
      const ids = ['provider-a', 'provider-b', 'provider-witness'].map(
        (id) => `${id}-${testRunId}`,
      );
      await seedProviders(a.page, ids, scenario.providerKey);
      await a.workView.addTask('baseline witness');
      if (scenario.compact) await a.workView.addTask('Compaction activity');
      await sync(a);
      const b = await makeClient('B');
      await sync(b);
      await sync(a);
      const before = await snapshot(a.page);
      expect((await snapshot(b.page)).issueProvider).toEqual(before.issueProvider);
      expect(before.issueProvider.ids).toEqual(ids);
      const replacementsBefore = await Promise.all(
        clients.map(async (c) => replacements(await rows(c.page))),
      );
      let offline = false;
      let allowUpload = !scenario.interrupted;
      if (scenario.interrupted) {
        await a.page.route('**/api/sync/**', async (route) => {
          if (offline || (!allowUpload && route.request().method() === 'POST'))
            await route.abort();
          else await route.continue();
        });
      }
      // Independent tasks and distinct config sections on both devices must survive.
      await a.workView.addTask('local independent witness');
      await b.workView.addTask('remote independent witness');
      await configWitness(a.page, 'A');
      await configWitness(b.page, 'B');
      const perform = async (client: SimulatedE2EClient): Promise<void> => {
        const isOrder = (client === a) === scenario.pendingOrder;
        await (isOrder
          ? drag(client.page)
          : scenario.pinnedSearch
            ? pinSearch(client.page)
            : edit(client.page));
        await expect
          .poll(
            async () =>
              pending(await rows(client.page)).filter(
                (r) => r.op.a === (isOrder ? 'IS' : 'IU'),
              ).length,
          )
          .toBe(1);
      };
      await perform(scenario.remoteNewer ? a : b);
      await perform(scenario.remoteNewer ? b : a);
      const orderClient = scenario.pendingOrder ? a : b;
      const editClient = scenario.pendingOrder ? b : a;
      const order = pending(await rows(orderClient.page)).find((r) => r.op.a === 'IS')!;
      const update = pending(await rows(editClient.page)).find((r) => r.op.a === 'IU')!;
      const reordered = [ids[1], ids[0], ids[2]];
      expect(order.op).toMatchObject({
        a: 'IS',
        o: 'MOV',
        e: 'ISSUE_PROVIDER',
        d: reordered[0],
        ds: reordered,
      });
      expect(update.op).toMatchObject({
        a: 'IU',
        o: 'UPD',
        e: 'ISSUE_PROVIDER',
        d: ids[0],
        ds: [ids[0]],
      });
      expect(order.op.p).toEqual({
        actionPayload: { ids: reordered },
        entityChanges: [],
      });
      const changes = scenario.pinnedSearch
        ? { pinnedSearch: 'synthetic search' }
        : { ...before.issueProvider.entities[ids[0]], isEnabled: false };
      const expectedProvider = { ...before.issueProvider.entities[ids[0]], ...changes };
      expect(update.op.p).toEqual({
        actionPayload: { issueProvider: { id: ids[0], changes } },
        entityChanges: [],
      });
      const local = scenario.pendingOrder ? order : update;
      const remote = scenario.pendingOrder ? update : order;
      expect(
        scenario.remoteNewer ? remote.op.t > local.op.t : remote.op.t < local.op.t,
      ).toBe(true);
      const clockKeys = new Set([
        ...Object.keys(local.op.v),
        ...Object.keys(remote.op.v),
      ]);
      expect(
        [...clockKeys].some((k) => (local.op.v[k] || 0) > (remote.op.v[k] || 0)),
      ).toBe(true);
      expect(
        [...clockKeys].some((k) => (local.op.v[k] || 0) < (remote.op.v[k] || 0)),
      ).toBe(true);
      const pendingBefore = pending(await rows(a.page));
      const aBefore = await snapshot(a.page);
      const bBefore = await snapshot(b.page);
      evidence.beforeCrossing = {
        order,
        update,
        pendingBefore,
        a: aBefore,
        b: bBefore,
      };
      await sync(b);
      if (scenario.interrupted) {
        const blockedUpload = a.page.waitForRequest(
          (request) =>
            request.url().includes('/api/sync/ops') && request.method() === 'POST',
        );
        await a.sync.clickSyncBtn();
        await blockedUpload;
        await expect(a.sync.syncSpinner).toBeHidden();
        await expect(a.sync.conflictDialog).toBeHidden();
        const interrupted = await snapshot(a.page);
        expect(interrupted.issueProvider).toEqual({
          ...before.issueProvider,
          ids: reordered,
          entities: { ...before.issueProvider.entities, [ids[0]]: expectedProvider },
        });
        expect(interrupted.config).toEqual({ animations: true, hideEvaluation: true });
        const original = (await rows(a.page)).find((r) => r.op.id === local.op.id)!;
        expect(original.rejectedAt).toBeUndefined();
        expect(original.syncedAt).toBeUndefined();
        const retainedRemote = (await rows(a.page)).find(
          (r) => r.op.id === remote.op.id,
        )!;
        expect(retainedRemote.applicationStatus).toBe('applied');
        evidence.interrupted = { original, retainedRemote, state: interrupted };
        if (scenario.compact) {
          offline = true;
          // Age only application metadata. Real task activity triggers the
          // production compactor; no operation payload or clock is fabricated.
          await a.page.evaluate(async (seq) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const r = indexedDB.open('SUP_OPS');
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            try {
              await new Promise<void>((resolve, reject) => {
                const retentionAge = 8 * 24 * 60 * 60 * 1000;
                const tx = db.transaction('ops', 'readwrite');
                const r = tx.objectStore('ops').get(seq);
                r.onsuccess = () =>
                  tx.objectStore('ops').put({
                    ...r.result,
                    appliedAt: Date.now() - retentionAge,
                  });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
              });
            } finally {
              db.close();
            }
          }, retainedRemote.seq);
          const activityTaskId = (await rows(a.page)).find(
            (r) =>
              r.op.e === 'TASK' &&
              r.op.o === 'CRT' &&
              JSON.stringify(r.op.p).includes('Compaction activity'),
          )!.op.d!;
          await dispatch(
            a.page,
            Array.from({ length: 500 }, (_, i) => ({
              type: '[Task Shared] updateTask',
              task: { id: activityTaskId, changes: { title: 'Offline activity ' + i } },
              meta: {
                isPersistent: true,
                entityType: 'TASK',
                entityId: activityTaskId,
                opType: 'UPD',
              },
            })),
          );
          await expect
            .poll(
              async () => (await rows(a.page)).some((r) => r.op.id === remote.op.id),
              { timeout: 60000 },
            )
            .toBe(false);
          const compacted = await snapshot(a.page);
          expect(compacted.issueProvider).toEqual(interrupted.issueProvider);
          expect(compacted.config).toEqual(interrupted.config);
          await a.page.reload();
          await waitForAppReady(a.page);
          expect(await snapshot(a.page)).toEqual(compacted);
          offline = false;
          allowUpload = true;
          // Without retained causal proof the reorder stays pending. A bounded
          // retry must never acknowledge it or replace the entire dataset.
          for (let attempt = 0; attempt < 2; attempt++) {
            const rejected = a.page.waitForResponse(
              (response) =>
                response.url().includes('/api/sync/ops') &&
                response.request().method() === 'POST',
            );
            await a.sync.clickSyncBtn();
            const response = await rejected;
            expect(response.ok()).toBe(true);
            expect((await response.json()).results).toContainEqual(
              expect.objectContaining({
                opId: original.op.id,
                accepted: false,
                errorCode: 'CONFLICT_CONCURRENT',
              }),
            );
            await expect(a.sync.syncSpinner).toBeHidden();
            await expect(a.sync.conflictDialog).toBeVisible();
            await a.sync.conflictDialog
              .getByRole('button', { name: 'Cancel', exact: true })
              .click();
            const retained = (await rows(a.page)).find(
              (r) => r.op.id === original.op.id,
            )!;
            expect(retained.rejectedAt).toBeUndefined();
            expect(retained.syncedAt).toBeUndefined();
            expect(await snapshot(a.page)).toEqual(compacted);
          }
          await a.page.reload();
          await waitForAppReady(a.page);
          expect(await snapshot(a.page)).toEqual(compacted);
          expect(
            pending(await rows(a.page)).some((r) => r.op.id === original.op.id),
          ).toBe(true);
          await sync(b);
          const peer = await snapshot(b.page);
          expect(peer.issueProvider.entities).toEqual(compacted.issueProvider.entities);
          expect(peer.issueProvider.ids).toEqual(ids);
          expect(pending(await rows(b.page))).toEqual([]);
          expect(
            await Promise.all(clients.map(async (c) => replacements(await rows(c.page)))),
          ).toEqual(replacementsBefore);
          evidence.afterCompaction = {
            local: compacted,
            peer,
            pending: pending(await rows(a.page)),
          };
          return;
        }
        allowUpload = true;
        await a.page.reload();
        await waitForAppReady(a.page);
        expect((await snapshot(a.page)).issueProvider).toEqual(interrupted.issueProvider);
        expect(pending(await rows(a.page)).some((r) => r.op.id === local.op.id)).toBe(
          true,
        );
      }
      const outcome = await syncOutcome(a);
      evidence.outcome = outcome;
      evidence.afterCrossing = {
        aRows: await rows(a.page),
        bRows: await rows(b.page),
        a: await snapshot(a.page),
        b: await snapshot(b.page),
        dialog: (await a.sync.conflictDialog.isVisible())
          ? await a.sync.conflictDialog.innerText()
          : null,
      };
      if (outcome !== 'in-sync' && !scenario.interrupted) {
        expect(pending(await rows(a.page))).toEqual(pendingBefore);
        expect(await snapshot(a.page)).toEqual(aBefore);
        expect(await snapshot(b.page)).toEqual(bBefore);
        await a.page.screenshot({ path: testInfo.outputPath('safety-stop.png') });
        if (await a.sync.conflictDialog.isVisible()) {
          await a.sync.conflictDialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
        }
        evidence.pendingAfterCancel = pending(await rows(a.page));
        expect(evidence.pendingAfterCancel).toEqual(pendingBefore);
        await a.page.reload();
        await waitForAppReady(a.page);
        evidence.afterRestart = {
          pending: pending(await rows(a.page)),
          state: await snapshot(a.page),
        };
        expect(pending(await rows(a.page))).toEqual(pendingBefore);
        expect(await snapshot(a.page)).toEqual(aBefore);
      }
      expect(
        await Promise.all(clients.map(async (c) => replacements(await rows(c.page)))),
      ).toEqual(replacementsBefore);
      // Desired regression assertion: a safety dialog is a failure, never a pass.
      expect(
        outcome,
        'provider order/settings must sync without dataset replacement',
      ).toBe('in-sync');
      await sync(b);
      await sync(a);
      const final = await snapshot(a.page);
      expect(await snapshot(b.page)).toEqual(final);
      expect(final.issueProvider.entities).toEqual({
        ...before.issueProvider.entities,
        [ids[0]]: expectedProvider,
      });
      expect(final.issueProvider.ids).toEqual(reordered);
      expect(new Set(final.issueProvider.ids).size).toBe(ids.length);
      expect(final.tasks).toEqual(
        expect.arrayContaining([
          ...before.tasks,
          expect.stringContaining('local independent witness'),
          expect.stringContaining('remote independent witness'),
        ]),
      );
      expect(final.config).toEqual({ animations: true, hideEvaluation: true });
      for (const [index, client] of [a, b].entries()) {
        expect(pending(await rows(client.page))).toEqual([]);
        expect(replacements(await rows(client.page))).toEqual(replacementsBefore[index]);
        await client.page.reload();
        await waitForAppReady(client.page);
        expect(await snapshot(client.page)).toEqual(final);
        expect(pending(await rows(client.page))).toEqual([]);
        expect(replacements(await rows(client.page))).toEqual(replacementsBefore[index]);
      }
      const fresh = await makeClient('Fresh');
      const freshReplacements = replacements(await rows(fresh.page));
      await sync(fresh);
      expect(await snapshot(fresh.page)).toEqual(final);
      expect(pending(await rows(fresh.page))).toEqual([]);
      expect(replacements(await rows(fresh.page))).toEqual(freshReplacements);
    } finally {
      await writeFile(
        testInfo.outputPath('evidence.json'),
        JSON.stringify(evidence, null, 2),
      );
      await writeFile(testInfo.outputPath('browser.log'), logs.join('\n'));
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
}

// Unmodified published bundles have no test store. Read the restart checkpoint
// and also verify the actual panel so persisted state cannot mask a UI failure.
const releasedSnapshot = async (page: Page): Promise<Snapshot> => {
  const state = await readMigratedState<{
    issueProvider: Snapshot['issueProvider'];
    task: { entities: Record<string, { title: string }> };
    globalConfig: {
      misc: { isDisableAnimations: boolean };
      evaluation: { isHideEvaluationSheet: boolean };
    };
  }>(page);
  return {
    issueProvider: state.issueProvider,
    tasks: Object.values(state.task.entities)
      .map((task) => task.title)
      .sort(),
    config: {
      animations: state.globalConfig.misc.isDisableAnimations,
      hideEvaluation: state.globalConfig.evaluation.isHideEvaluationSheet,
    },
  };
};

test.describe('@supersync released provider reorder compatibility', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const { oldReorders, oldResolvesFirst, providerKey } of [
    { oldReorders: false, oldResolvesFirst: false, providerKey: 'GITLAB' as const },
    { oldReorders: true, oldResolvesFirst: false, providerKey: 'GITLAB' as const },
    { oldReorders: false, oldResolvesFirst: true, providerKey: 'GITLAB' as const },
    { oldReorders: true, oldResolvesFirst: true, providerKey: 'GITLAB' as const },
    { oldReorders: false, oldResolvesFirst: false, providerKey: 'JIRA' as const },
    { oldReorders: true, oldResolvesFirst: false, providerKey: 'JIRA' as const },
  ]) {
    test(`${oldResolvesFirst ? 'old resolves first and retains pending work' : 'old uploads first, new resolves, old receives'} / old ${oldReorders ? 'order' : 'update'} / ${providerKey}`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(180000);
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const current = await createSimulatedClient(
          browser,
          baseURL!,
          'Current',
          testRunId,
        );
        clients.push(current);
        await mockProviderRequests(current.page);
        await current.sync.setupSuperSync(config);
        const ids = ['provider-a', 'provider-b', 'provider-witness'].map(
          (id) => id + '-' + testRunId,
        );
        const reordered = [ids[1], ids[0], ids[2]];
        await seedProviders(current.page, ids, providerKey);
        await current.workView.addTask('baseline witness');
        await sync(current);
        const released = await createSimulatedClient(
          browser,
          assets.url,
          'Released',
          testRunId,
          {
            serviceWorkers: 'block',
          },
        );
        clients.push(released);
        await mockProviderRequests(released.page);
        await released.sync.setupSuperSync(config);
        await sync(released);
        await sync(current);
        const before = await snapshot(current.page);
        const expectedProvider = {
          ...before.issueProvider.entities[ids[0]],
          isEnabled: false,
        };
        const replacementsBefore = await Promise.all(
          clients.map(async (client) => replacements(await rows(client.page))),
        );
        const versions: (string | null)[] = [];
        released.page.on('request', (request) => {
          if (request.method() === 'GET' && request.url().includes('/api/sync/ops?'))
            versions.push(new URL(request.url()).searchParams.get('appVersion'));
        });
        expect(await released.page.evaluate(() => '__e2eTestHelpers' in window)).toBe(
          false,
        );
        await current.workView.addTask('local independent witness');
        await released.workView.addTask('released independent witness');
        await configWitness(current.page, 'A');
        // The released producer uses only its actual panel drag/editor.
        await (oldReorders ? edit(current.page) : drag(current.page));
        await (oldReorders ? drag(released.page) : edit(released.page));
        const order = pending(await rows((oldReorders ? released : current).page)).find(
          (row) => row.op.a === 'IS',
        )!;
        const update = pending(await rows((oldReorders ? current : released).page)).find(
          (row) => row.op.a === 'IU',
        )!;
        expect(order.op).toMatchObject({
          a: 'IS',
          o: 'MOV',
          e: 'ISSUE_PROVIDER',
          d: ids[1],
          ds: reordered,
        });
        expect(order.op.p).toEqual({
          actionPayload: { ids: reordered },
          entityChanges: [],
        });
        expect(update.op).toMatchObject({
          a: 'IU',
          o: 'UPD',
          e: 'ISSUE_PROVIDER',
          d: ids[0],
          ds: [ids[0]],
        });
        expect(update.op.p).toEqual({
          actionPayload: { issueProvider: { id: ids[0], changes: expectedProvider } },
          entityChanges: [],
        });
        expect((oldReorders ? order : update).op.t).toBeGreaterThan(
          (oldReorders ? update : order).op.t,
        );
        const clockKeys = new Set([
          ...Object.keys(order.op.v),
          ...Object.keys(update.op.v),
        ]);
        expect(
          [...clockKeys].some((key) => (order.op.v[key] || 0) > (update.op.v[key] || 0)),
        ).toBe(true);
        expect(
          [...clockKeys].some((key) => (order.op.v[key] || 0) < (update.op.v[key] || 0)),
        ).toBe(true);
        if (oldResolvesFirst) {
          const pendingBefore = pending(await rows(released.page));
          await sync(current);
          // A newer peer cannot repair an old client's resolver. It must retain
          // its pending intent when the released safety gate stops this crossing.
          await syncOutcome(released);
          // The error icon can appear before the asynchronous dialog opens.
          await expect(released.sync.conflictDialog).toBeVisible();
          expect(pending(await rows(released.page))).toEqual(pendingBefore);
          await released.sync.conflictDialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
          await released.page.addInitScript(() => {
            (
              window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
            ).__SP_E2E_BLOCK_AUTO_SYNC = true;
          });
          await released.page.reload();
          await waitForAppReady(released.page);
          expect(pending(await rows(released.page))).toEqual(pendingBefore);
          const retained = await releasedSnapshot(released.page);
          expect(retained.issueProvider).toEqual({
            ...before.issueProvider,
            ids: oldReorders ? reordered : ids,
            entities: oldReorders
              ? before.issueProvider.entities
              : { ...before.issueProvider.entities, [ids[0]]: expectedProvider },
          });
          expect(retained.tasks).toEqual(
            expect.arrayContaining([
              ...before.tasks,
              expect.stringContaining('released independent witness'),
            ]),
          );
          await expect(
            released.page
              .locator('task')
              .filter({ hasText: 'released independent witness' }),
          ).toBeVisible();
          await openPanel(released.page);
          const tabs = released.page.locator('issue-panel .tab-header-item.cdk-drag');
          await expect(tabs.locator('.initials')).toHaveText(['P1', 'P0', 'P2']);
          await expect(tabs.nth(0)).not.toHaveClass(/disabled/);
          if (oldReorders) await expect(tabs.nth(1)).not.toHaveClass(/disabled/);
          else await expect(tabs.nth(1)).toHaveClass(/disabled/);
          await expect(tabs.nth(2)).toHaveClass(/disabled/);
          expect(
            await Promise.all(
              clients.map(async (client) => replacements(await rows(client.page))),
            ),
          ).toEqual(replacementsBefore);
          expect(versions).toContain('19.1.0');
          return;
        }
        // Old clients must upload first; the fixed client owns resolution.
        await sync(released);
        await sync(current);
        await sync(released);
        await sync(current);
        const final = await snapshot(current.page);
        expect(final.issueProvider).toEqual({
          ...before.issueProvider,
          ids: reordered,
          entities: { ...before.issueProvider.entities, [ids[0]]: expectedProvider },
        });
        expect(final.tasks).toEqual(
          expect.arrayContaining([
            ...before.tasks,
            expect.stringContaining('local independent witness'),
            expect.stringContaining('released independent witness'),
          ]),
        );
        expect(final.config.animations).toBe(true);
        const original = oldReorders ? update : order;
        const history = await rows(current.page);
        expect(
          history.find((row) => row.op.id === original.op.id)!.rejectedAt,
        ).toBeDefined();
        const accepted = history.filter(
          (row) =>
            row.source === 'local' &&
            row.syncedAt &&
            !row.rejectedAt &&
            row.op.e === 'ISSUE_PROVIDER',
        );
        expect(
          accepted.some(
            (row) =>
              row.op.a === (oldReorders ? 'IU' : 'IS') && row.op.id !== original.op.id,
          ),
        ).toBe(true);
        const replacement = accepted.find(
          (row) =>
            row.op.a === (oldReorders ? 'IU' : 'IS') && row.op.id !== original.op.id,
        )!;
        expect(
          (await rows(released.page)).find((row) => row.op.id === replacement.op.id)
            ?.applicationStatus,
        ).toBe('applied');
        expect(versions).toContain('19.1.0');
        for (const [index, client] of clients.entries()) {
          expect(pending(await rows(client.page))).toEqual([]);
          expect(replacements(await rows(client.page))).toEqual(
            replacementsBefore[index],
          );
          await client.page.addInitScript(() => {
            (
              window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
            ).__SP_E2E_BLOCK_AUTO_SYNC = true;
          });
          await client.page.reload();
          await waitForAppReady(client.page);
          if (client === current) expect(await snapshot(client.page)).toEqual(final);
          else {
            await expect.poll(() => releasedSnapshot(client.page)).toEqual(final);
            await openPanel(client.page);
            const tabs = client.page.locator('issue-panel .tab-header-item.cdk-drag');
            await expect(tabs.locator('.initials')).toHaveText([
              'P1',
              providerKey === 'JIRA' ? 'JI' : 'P0',
              'P2',
            ]);
            await expect(tabs.nth(0)).not.toHaveClass(/disabled/);
            await expect(tabs.nth(1)).toHaveClass(/disabled/);
            await expect(tabs.nth(2)).toHaveClass(/disabled/);
          }
          expect(pending(await rows(client.page))).toEqual([]);
          expect(replacements(await rows(client.page))).toEqual(
            replacementsBefore[index],
          );
        }
        const fresh = await createSimulatedClient(browser, baseURL!, 'Fresh', testRunId);
        clients.push(fresh);
        await fresh.sync.setupSuperSync(config);
        const freshReplacements = replacements(await rows(fresh.page));
        await sync(fresh);
        expect(await snapshot(fresh.page)).toEqual(final);
        expect(pending(await rows(fresh.page))).toEqual([]);
        expect(replacements(await rows(fresh.page))).toEqual(freshReplacements);
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
