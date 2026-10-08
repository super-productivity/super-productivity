import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  dispatch,
  editListed,
  fullStateOps,
  type ListName,
  pending,
  removeNote,
  renderedOrder,
  reorder,
  rows,
  seeds,
  snapshot,
  type Snapshot,
  withoutModified,
} from '../../utils/reorder-crossing';
import { waitForAppReady } from '../../utils/waits';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * #10420: a device holds a pending note or habit order and also edits one of
 * the listed entities, while another device edits that entity too. The edits
 * conflict; the order commutes with both. The order used to join the edit's
 * conflict, and sync stopped on every attempt
 * (SYNC_MULTI_ENTITY_UNSUPPORTED side=local) until someone picked a side in
 * the whole-dataset dialog. The same stop came from a resolution row of the
 * other device (an LWW Update) meeting the pending habit order.
 *
 * Every action is real UI; only the baseline is seeded through the store.
 * The strict sync helper fails on the whole-dataset dialog and on any error.
 * The edit conflict resolves as it does without an order (the later edit
 * wins), the order survives everywhere, unrelated work of both devices
 * survives, nothing stays pending and no full-state repair is needed, also
 * after a restart and on a fresh device.
 */

/** Strict: a real successful download, then no dialog/error and nothing pending. */
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

type SyncConfig = ReturnType<typeof getSuperSyncConfig>;
interface Harness {
  clients: SimulatedE2EClient[];
  logs: string[];
}

const joinClient = async (
  harness: Harness,
  config: SyncConfig,
  create: () => Promise<SimulatedE2EClient>,
  clientName: string,
): Promise<SimulatedE2EClient> => {
  const client = await create();
  harness.clients.push(client);
  client.page.on('console', (m) => harness.logs.push(`${clientName}: ${m.text()}`));
  await client.sync.setupSuperSync(config);
  await client.page.addInitScript(() => {
    const flags = window as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });
  return client;
};

const syncStrict = async (
  client: SimulatedE2EClient,
  harness: Harness,
): Promise<void> => {
  const outcome = await syncOutcome(client);
  const stops = harness.logs.filter((l) => l.includes('SYNC_MULTI_ENTITY_UNSUPPORTED'));
  expect(outcome, `must sync without the safety stop: ${JSON.stringify(stops)}`).toBe(
    'in-sync',
  );
};

const shot = async (
  client: SimulatedE2EClient,
  list: ListName,
  ids: string[],
): Promise<Snapshot> => withoutModified(await snapshot(client.page, list, ids));

/** The edited field of a listed entity. */
const valueOf = (state: Snapshot, list: ListName, id: string): unknown =>
  state.entities[id]?.[list === 'habits' ? 'title' : 'content'];

/** Deletes a habit (titled by its id) in the real settings dialog. */
const deleteHabit = async (page: Page, title: string): Promise<void> => {
  await renderedOrder(page, 'habits');
  await page
    .locator('.habit-row .habit-title')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  const dialog = page.locator('dialog-simple-counter-edit-settings');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Delete/ }).click();
  await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(title, { exact: true })).toBeHidden();
};

/**
 * - `reorderer resolves`: A holds its order and its edit; B's edit uploads first.
 * - `other device resolves`: A uploads its order and edit first; B resolves.
 * - `reorderer receives the resolution`: A's edit uploaded before its order;
 *   B resolves against it and uploads the resolution row, which meets A's
 *   pending order (habits: an LWW row of a habit commutes with a habit order).
 */
type Direction =
  | 'reorderer resolves'
  | 'other device resolves'
  | 'reorderer receives the resolution';

const cases: { list: ListName; direction: Direction }[] = [
  { list: 'habits', direction: 'reorderer resolves' },
  { list: 'habits', direction: 'other device resolves' },
  { list: 'habits', direction: 'reorderer receives the resolution' },
  { list: 'project notes', direction: 'reorderer resolves' },
  { list: 'project notes', direction: 'other device resolves' },
  // Every Today and tag order writes note.todayOrder.
  { list: 'Today notes', direction: 'reorderer resolves' },
];

for (const { list, direction } of cases) {
  for (const bNewer of [true, false]) {
    test(`@supersync reorder beside a conflict: ${list} / ${direction} / ${bNewer ? 'B' : 'A'} edits last`, async ({
      browser,
      baseURL,
      testRunId,
    }, testInfo) => {
      test.setTimeout(300000);
      const harness: Harness = { clients: [], logs: [] };
      const evidence: Record<string, unknown> = { list, direction, bNewer };
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const join = (name: string): Promise<SimulatedE2EClient> =>
        joinClient(
          harness,
          config,
          () => createSimulatedClient(browser, baseURL!, name, testRunId),
          name,
        );
      const sync = (client: SimulatedE2EClient): Promise<void> =>
        syncStrict(client, harness);
      try {
        const ids = ['first', 'second', 'third', 'fourth'].map(
          (id) => `${id}-${testRunId}`,
        );
        // Listed by the habit order too (ids[2] is a disabled habit).
        const target = ids[0];
        const a = await join('A');
        await dispatch(a.page, seeds(list, ids));
        await sync(a);
        const b = await join('B');
        await sync(b);
        await sync(a);
        const before = await shot(a, list, ids);
        expect(await shot(b, list, ids)).toEqual(before);
        const fullStateBefore = new Set([
          ...fullStateOps(await rows(a.page)),
          ...fullStateOps(await rows(b.page)),
        ]);
        await a.workView.addTask(`A witness ${testRunId}`);
        await b.workView.addTask(`B witness ${testRunId}`);

        const valueA = `Edited on A ${testRunId}`;
        const valueB = `Edited on B ${testRunId}`;
        const editA = (): Promise<void> => editListed(a.page, list, target, valueA);
        const editB = (): Promise<void> => editListed(b.page, list, target, valueB);
        // Real UI action order decides the timestamps.
        if (direction === 'reorderer receives the resolution') {
          if (!bNewer) await editB();
          await editA();
          await sync(a);
          if (bNewer) await editB();
          await reorder(a.page, list, 0);
        } else {
          const actA = async (): Promise<void> => {
            await reorder(a.page, list, 0);
            await editA();
          };
          for (const act of bNewer ? [actA, editB] : [editB, actA]) await act();
        }
        const reordered = (await shot(a, list, ids)).order;
        expect(reordered).not.toEqual(before.order);
        evidence.reordered = reordered;
        expect(pending(await rows(a.page)).length).toBeGreaterThan(0);
        expect(pending(await rows(b.page)).length).toBeGreaterThan(0);

        if (direction === 'other device resolves') {
          await sync(a);
          await sync(b);
          await sync(a);
          await sync(b);
        } else {
          await sync(b);
          await sync(a);
          await sync(b);
          await sync(a);
          await sync(b);
        }

        const final = await shot(a, list, ids);
        evidence.final = final;
        expect(await shot(b, list, ids)).toEqual(final);
        expect(final.order).toEqual(reordered);
        expect(valueOf(final, list, target)).toBe(bNewer ? valueB : valueA);
        expect(final.tasks).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`A witness ${testRunId}`),
            expect.stringContaining(`B witness ${testRunId}`),
          ]),
        );
        for (const client of [a, b]) {
          const entries = await rows(client.page);
          expect(pending(entries)).toEqual([]);
          expect(fullStateOps(entries).every((id) => fullStateBefore.has(id))).toBe(true);
          await client.page.reload();
          await waitForAppReady(client.page, { ensureRoute: false });
          expect(await shot(client, list, ids)).toEqual(final);
          await sync(client);
          expect(await shot(client, list, ids)).toEqual(final);
        }
        const fresh = await join('Fresh');
        await sync(fresh);
        expect(await shot(fresh, list, ids)).toEqual(final);
      } finally {
        evidence.stops = harness.logs.filter((l) =>
          l.includes('SYNC_MULTI_ENTITY_UNSUPPORTED'),
        );
        await writeFile(
          testInfo.outputPath('evidence.json'),
          JSON.stringify(evidence, null, 2),
        );
        for (const client of harness.clients) await closeClient(client);
      }
    });
  }
}

/**
 * A pending local delete of a listed habit keeps the order in the conflict, so
 * sync stops as before #10420. A remote win would recreate the habit at the end
 * of this device's list while a kept order placed it elsewhere on the other
 * device: a permanent order difference with nothing pending (review of #10443).
 */
test('@supersync reorder beside a conflict: habits / a pending delete beside the order keeps the stop, nothing lost', async ({
  browser,
  baseURL,
  testRunId,
}) => {
  test.setTimeout(300000);
  const harness: Harness = { clients: [], logs: [] };
  const config = getSuperSyncConfig(await createTestUser(testRunId));
  const join = (name: string): Promise<SimulatedE2EClient> =>
    joinClient(
      harness,
      config,
      () => createSimulatedClient(browser, baseURL!, name, testRunId),
      name,
    );
  try {
    const list: ListName = 'habits';
    const ids = ['first', 'second', 'third', 'fourth'].map((id) => `${id}-${testRunId}`);
    const target = ids[0];
    const a = await join('A');
    await dispatch(a.page, seeds(list, ids));
    await syncStrict(a, harness);
    const b = await join('B');
    await syncStrict(b, harness);
    await syncStrict(a, harness);

    await reorder(a.page, list, 0);
    await deleteHabit(a.page, target);
    const renamed = `Edited on B ${testRunId}`;
    await editListed(b.page, list, target, renamed);
    const aBefore = await shot(a, list, ids);
    const aPending = pending(await rows(a.page)).map((r) => r.op.id);
    expect(aPending).toHaveLength(2);

    await syncStrict(b, harness);
    expect(await syncOutcome(a)).not.toBe('in-sync');
    expect(harness.logs.filter((l) => l.startsWith('A: '))).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'side=local actionType=[SimpleCounter] Update SimpleCounter Order',
        ),
      ]),
    );
    // Nothing is lost: A keeps its order and delete pending, B its rename.
    expect(pending(await rows(a.page)).map((r) => r.op.id)).toEqual(aPending);
    expect(await shot(a, list, ids)).toEqual(aBefore);
    expect(valueOf(await shot(b, list, ids), list, target)).toBe(renamed);
    expect(pending(await rows(b.page))).toEqual([]);
  } finally {
    for (const client of harness.clients) await closeClient(client);
  }
});

/**
 * A habit LWW row that recreates a habit missing on the device holding a habit
 * order that lists it (#10443 review). The admission covers an existing habit
 * only: both ways the habit can be missing there end at a stop with nothing
 * lost, as on master.
 * - `pending delete`: the device deleted the habit itself, and the row of the
 *   other device's later rename meets the order beside that pending delete.
 * - `remote delete`: a third device deleted it; another device's later rename
 *   wins over that delete and uploads the recreating row. The delete crosses
 *   the pending order first: the kept habit-delete stop (#10407).
 */
for (const missing of ['pending delete', 'remote delete'] as const) {
  test(`@supersync reorder beside a conflict: habits / a row recreating a habit missing beside the order (${missing}) keeps the stop`, async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const harness: Harness = { clients: [], logs: [] };
    const config = getSuperSyncConfig(await createTestUser(testRunId));
    const join = (name: string): Promise<SimulatedE2EClient> =>
      joinClient(
        harness,
        config,
        () => createSimulatedClient(browser, baseURL!, name, testRunId),
        name,
      );
    try {
      const list: ListName = 'habits';
      const ids = ['first', 'second', 'third', 'fourth'].map(
        (id) => `${id}-${testRunId}`,
      );
      const target = ids[0];
      const a = await join('A');
      await dispatch(a.page, seeds(list, ids));
      await syncStrict(a, harness);
      const b = await join('B');
      await syncStrict(b, harness);
      const c = await join('C');
      await syncStrict(c, harness);
      await syncStrict(a, harness);

      const renamed = `Edited on B ${testRunId}`;
      if (missing === 'pending delete') {
        // C's rename uploads first; B's later rename beats it and uploads the
        // row while A holds its order and its delete.
        await editListed(c.page, list, target, `Edited on C ${testRunId}`);
        await syncStrict(c, harness);
        await reorder(a.page, list, 0);
        await deleteHabit(a.page, target);
        await editListed(b.page, list, target, renamed);
        await syncStrict(b, harness);
      } else {
        // C deletes; B's later rename beats the delete and uploads the row.
        await reorder(a.page, list, 0);
        await deleteHabit(c.page, target);
        await syncStrict(c, harness);
        await editListed(b.page, list, target, renamed);
        await syncStrict(b, harness);
      }
      // B really resolved with a habit LWW row, synced to the server.
      expect(
        (await rows(b.page)).some(
          (r) =>
            r.source === 'local' &&
            !!r.syncedAt &&
            r.op.a === '[SIMPLE_COUNTER] LWW Update' &&
            r.op.d === target,
        ),
      ).toBe(true);
      const aBefore = await shot(a, list, ids);
      const aPending = pending(await rows(a.page)).map((r) => r.op.id);

      expect(await syncOutcome(a)).not.toBe('in-sync');
      expect(harness.logs.filter((l) => l.startsWith('A: '))).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'side=local actionType=[SimpleCounter] Update SimpleCounter Order',
          ),
        ]),
      );
      // Nothing is lost: A keeps its pending ops and state, B its rename.
      expect(pending(await rows(a.page)).map((r) => r.op.id)).toEqual(aPending);
      expect(await shot(a, list, ids)).toEqual(aBefore);
      expect(valueOf(await shot(b, list, ids), list, target)).toBe(renamed);
      expect(pending(await rows(b.page))).toEqual([]);
    } finally {
      for (const client of harness.clients) await closeClient(client);
    }
  });
}

/**
 * A released (v19.1.0) device on the other side: it renames the habit first and
 * consumes the current device's moved order, or it resolves the rename conflict
 * itself and uploads a whole-habit resolution row that meets the current
 * device's pending order, then consumes the order the current device reissues.
 */
test.describe('@supersync released reorder beside a conflict (#10420)', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const releasedResolves of [false, true]) {
    test(
      releasedResolves
        ? 'released resolves the rename, current pending habit order receives its row'
        : 'released rename first, current resolves beside its pending habit order',
      async ({ browser, baseURL, testRunId }) => {
        test.setTimeout(300000);
        const harness: Harness = { clients: [], logs: [] };
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const sync = (client: SimulatedE2EClient): Promise<void> =>
          syncStrict(client, harness);
        try {
          const list: ListName = 'habits';
          const ids = ['first', 'second', 'third', 'fourth'].map(
            (id) => `${id}-${testRunId}`,
          );
          const target = ids[0];
          const current = await joinClient(
            harness,
            config,
            () => createSimulatedClient(browser, baseURL!, 'A', testRunId),
            'A',
          );
          await dispatch(current.page, seeds(list, ids));
          await sync(current);
          const released = await joinClient(
            harness,
            config,
            () =>
              createSimulatedClient(browser, assets.url, 'Released', testRunId, {
                serviceWorkers: 'block',
              }),
            'Released',
          );
          await sync(released);
          await sync(current);
          const versions: (string | null)[] = [];
          released.page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('/api/sync/ops?'))
              versions.push(new URL(request.url()).searchParams.get('appVersion'));
          });

          const currentValue = `Edited on current ${testRunId}`;
          const releasedValue = `Edited on released ${testRunId}`;
          if (releasedResolves) {
            // The released rename is the later one, so its resolution row wins.
            await editListed(current.page, list, target, currentValue);
            await sync(current);
            await editListed(released.page, list, target, releasedValue);
            await reorder(current.page, list, 0);
          } else {
            await editListed(released.page, list, target, releasedValue);
            await reorder(current.page, list, 0);
            await editListed(current.page, list, target, currentValue);
          }
          const reordered = (await shot(current, list, ids)).order;

          await sync(released);
          await sync(current);
          await sync(released);
          await sync(current);
          await sync(released);

          const final = await shot(current, list, ids);
          expect(final.order).toEqual(reordered);
          expect(valueOf(final, list, target)).toBe(
            releasedResolves ? releasedValue : currentValue,
          );
          // The habit view renders only enabled habits (ids[2] is disabled),
          // by title.
          const rendered = (): string[] =>
            final.order
              .filter((id) => id !== ids[2])
              .map((id) => (id === target ? (valueOf(final, list, id) as string) : id));
          for (const reload of [false, true]) {
            if (reload) {
              await released.page.reload();
              await waitForAppReady(released.page, { ensureRoute: false });
              await sync(released);
            }
            expect(await renderedOrder(released.page, list)).toEqual(rendered());
          }
          expect(versions).toContain('19.1.0');
          for (const client of harness.clients)
            expect(pending(await rows(client.page))).toEqual([]);
        } finally {
          for (const client of harness.clients) await closeClient(client);
        }
      },
    );
  }

  /**
   * The current device edits a note and holds a project note order; the
   * released device deletes a listed note later. The order stays out of the
   * edit conflict, so it must be reissued from current state (#10377), not
   * moved past the conflict with its stale list: released reducers write a
   * note order's ids as given, so the deleted id would dangle in the released
   * device's project.
   * - `edited note`: the delete wins the edit conflict.
   * - `other note`: the released device deletes another listed note, then
   *   edits the note too; that edit wins and its clock dominates the delete,
   *   which applies beside the conflict.
   */
  for (const deleted of ['edited note', 'other note'] as const) {
    test(`released deletes the ${deleted} beside the current device's pending note order and edit`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      const harness: Harness = { clients: [], logs: [] };
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const sync = (client: SimulatedE2EClient): Promise<void> =>
        syncStrict(client, harness);
      try {
        const list: ListName = 'project notes';
        const ids = ['first', 'second', 'third', 'fourth'].map(
          (id) => `${id}-${testRunId}`,
        );
        const target = ids[0];
        const removed = deleted === 'edited note' ? target : ids[1];
        const current = await joinClient(
          harness,
          config,
          () => createSimulatedClient(browser, baseURL!, 'A', testRunId),
          'A',
        );
        await dispatch(current.page, seeds(list, ids));
        await sync(current);
        const released = await joinClient(
          harness,
          config,
          () =>
            createSimulatedClient(browser, assets.url, 'Released', testRunId, {
              serviceWorkers: 'block',
            }),
          'Released',
        );
        const releasedErrors: string[] = [];
        released.page.on('pageerror', (e) => releasedErrors.push(e.message));
        await sync(released);
        await sync(current);

        await editListed(current.page, list, target, `Edited on current ${testRunId}`);
        await reorder(current.page, list, 0);
        // Later than the current edit: the released side wins.
        await removeNote(released.page, removed);
        const releasedValue = `Edited on released ${testRunId}`;
        if (removed !== target)
          await editListed(released.page, list, target, releasedValue);

        await sync(released);
        await sync(current);
        await sync(released);
        await sync(current);

        const final = await shot(current, list, ids);
        expect(final.order).not.toContain(removed);
        expect(final.entities[removed]).toBeUndefined();
        if (removed !== target) expect(valueOf(final, list, target)).toBe(releasedValue);
        // The released device's project lists no dangling id and renders the
        // current device's order.
        // Every note order the released device received.
        const receivedOrders = (await rows(released.page))
          .filter((r) => r.source === 'remote' && r.op.e === 'NOTE' && r.op.o === 'MOV')
          .map((r) => JSON.stringify(r.op.p));
        expect(receivedOrders.length).toBeGreaterThan(0);
        for (const payload of receivedOrders) expect(payload).not.toContain(removed);
        expect(await renderedOrder(released.page, list)).toEqual(
          await renderedOrder(current.page, list),
        );
        expect(releasedErrors).toEqual([]);
        for (const client of harness.clients)
          expect(pending(await rows(client.page))).toEqual([]);
      } finally {
        for (const client of harness.clients) await closeClient(client);
      }
    });
  }
});
