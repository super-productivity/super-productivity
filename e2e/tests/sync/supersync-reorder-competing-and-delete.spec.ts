import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  addNoteInUi,
  dispatch,
  fullStateOps,
  type ListName,
  type OtherName,
  pending,
  removeNote,
  renderedOrder,
  reorder,
  type Row,
  rows,
  seeds,
  snapshot,
} from '../../utils/reorder-crossing';
import { waitForAppReady } from '../../utils/waits';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * #10377: a reorder that crosses a competing reorder of the same list, or the
 * deletion of an entity it lists, used to stop sync on every attempt
 * (SYNC_MULTI_ENTITY_UNSUPPORTED) and hold back every later remote change.
 *
 * Both crossing actions come from the real UI; only the baseline is seeded
 * through the store. The strict sync helper fails on the whole-dataset
 * "Sync: Conflicting Data" dialog and never picks Keep local or Keep remote.
 * Competing orders: either device's order may win, both devices must converge
 * (#10264's decision). A note delete: the note stays deleted everywhere and
 * the reorder's relative order of the other notes survives. Unrelated work of
 * both devices must survive, and no full-state repair may be needed.
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
                (await client.sync.syncConfirmedIcon.isVisible())
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

// ---------------------------------------------------------------------------
// Crossing harness
// ---------------------------------------------------------------------------

interface Crossing {
  list: ListName;
  other: OtherName;
}

// A habit delete keeps the stop: the habit order fills the slots of the
// habits it lists, so it does not commute with a delete (see
// reorder-conflict.util.ts).
const crossings: Crossing[] = [
  { list: 'habits', other: 'order' },
  { list: 'project notes', other: 'order' },
  // Each writes only its own note list.
  { list: 'project notes', other: 'Today order' },
  { list: 'project notes', other: 'delete' },
  { list: 'Today notes', other: 'delete' },
];

for (const crossing of crossings) {
  // For competing orders both sides are the same, so only the timestamp varies.
  for (const pendingOrder of crossing.other === 'order' ? [true] : [true, false]) {
    for (const incomingNewer of [true, false]) {
      const name =
        `@supersync reorder crossing: ${crossing.list} order vs ${crossing.other}` +
        (crossing.other === 'order'
          ? ''
          : ` / local-${pendingOrder ? 'order' : crossing.other}`) +
        ` / incoming-${incomingNewer ? 'newer' : 'older'}`;
      test(name, async ({ browser, baseURL, testRunId }, testInfo) => {
        test.setTimeout(240000);
        const { list, other } = crossing;
        const evidence: Record<string, unknown> = {
          crossing,
          pendingOrder,
          incomingNewer,
        };
        const clients: SimulatedE2EClient[] = [];
        const logs: string[] = [];
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const join = async (clientName: string): Promise<SimulatedE2EClient> => {
          const client = await createSimulatedClient(
            browser,
            baseURL!,
            clientName,
            testRunId,
          );
          clients.push(client);
          client.page.on('console', (m) => logs.push(`${clientName}: ${m.text()}`));
          await client.sync.setupSuperSync(config);
          await client.page.addInitScript(() => {
            const flags = window as unknown as Record<string, unknown>;
            flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
            flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
            flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
          });
          return client;
        };
        try {
          const ids = ['first', 'second', 'third', 'fourth'].map(
            (id) => `${id}-${testRunId}`,
          );
          const a = await join('A');
          await dispatch(a.page, seeds(list, ids));
          await sync(a);
          const b = await join('B');
          await sync(b);
          await sync(a);
          const before = await snapshot(a.page, list, ids);
          expect(before.order).toEqual(ids);
          if (list !== 'habits') expect(before.second).toEqual(ids);
          expect(await snapshot(b.page, list, ids)).toEqual(before);
          const fullStateBefore = new Set([
            ...fullStateOps(await rows(a.page)),
            ...fullStateOps(await rows(b.page)),
          ]);
          // Unrelated work on both devices must survive the crossing.
          await a.workView.addTask(`local witness ${testRunId}`);
          await b.workView.addTask(`remote witness ${testRunId}`);

          // A holds the pending side of the crossing; B uploads first.
          const orderClient = pendingOrder ? a : b;
          const otherClient = pendingOrder ? b : a;
          const deleted = ids[1];
          const act = async (client: SimulatedE2EClient): Promise<Row['op']> => {
            let code = list === 'habits' ? 'SM' : 'NO';
            if (client === orderClient) await reorder(client.page, list, 0);
            else if (other === 'order') await reorder(client.page, list, 1);
            else if (other === 'Today order')
              await reorder(client.page, 'Today notes', 1);
            else {
              await removeNote(client.page, deleted);
              code = 'ND';
            }
            await expect
              .poll(async () =>
                pending(await rows(client.page)).filter((r) => r.op.a === code),
              )
              .toHaveLength(1);
            return pending(await rows(client.page)).find((r) => r.op.a === code)!.op;
          };
          // Change real UI action order, not timestamps or stored rows.
          const ops = new Map<SimulatedE2EClient, Row['op']>();
          for (const client of incomingNewer ? [a, b] : [b, a]) {
            ops.set(client, await act(client));
          }
          const local = ops.get(a)!;
          const remote = ops.get(b)!;
          expect(remote.t > local.t).toBe(incomingNewer);
          const keys = new Set([...Object.keys(local.v), ...Object.keys(remote.v)]);
          expect([...keys].some((k) => (local.v[k] || 0) > (remote.v[k] || 0))).toBe(
            true,
          );
          expect([...keys].some((k) => (local.v[k] || 0) < (remote.v[k] || 0))).toBe(
            true,
          );
          const orderOp = ops.get(orderClient)!;
          expect(orderOp.o).toBe('MOV');
          expect(orderOp.ds).toContain(deleted);
          expect(orderOp.ds!.some((id) => ops.get(otherClient)!.ds?.includes(id))).toBe(
            true,
          );
          const reordered = await snapshot(orderClient.page, list, ids);
          const otherSide = await snapshot(otherClient.page, list, ids);
          evidence.beforeCrossing = { local, remote, reordered, otherSide };

          // B uploads first; A resolves while its own crossing op is pending.
          await sync(b);
          const outcome = await syncOutcome(a);
          evidence.outcome = outcome;
          if (outcome !== 'in-sync') {
            evidence.safetyStop = logs.filter(
              (l) => l.startsWith('A: ') && l.includes('SYNC_MULTI_ENTITY_UNSUPPORTED'),
            );
          }
          expect(
            outcome,
            `must sync without the safety stop: ${JSON.stringify(evidence.safetyStop ?? [])}`,
          ).toBe('in-sync');
          await sync(b);
          await sync(a);

          const final = await snapshot(a.page, list, ids);
          evidence.final = final;
          expect(await snapshot(b.page, list, ids)).toEqual(final);
          expect(new Set(final.order).size).toBe(final.order.length);
          if (other === 'order') {
            // Either device's order, the same everywhere.
            expect([reordered.order, otherSide.order]).toContainEqual(final.order);
            expect(final.entities).toEqual(before.entities);
          } else if (other === 'Today order') {
            // Both orders survive: each device wrote only its own list.
            expect(final.order).toEqual(reordered.order);
            expect(final.second).toEqual(otherSide.second);
            expect(final.order).not.toEqual(before.order);
            expect(final.second).not.toEqual(before.second);
            expect(final.entities).toEqual(before.entities);
          } else {
            // The delete wins and the reorder of the other entities survives.
            const kept = (all: string[]): string[] => all.filter((id) => id !== deleted);
            expect(final.order).toEqual(kept(reordered.order));
            expect(final.second).toEqual(kept(before.second));
            expect(Object.keys(final.entities).sort()).toEqual(kept(ids).sort());
          }
          expect(final.tasks).toEqual(
            expect.arrayContaining([
              expect.stringContaining(`local witness ${testRunId}`),
              expect.stringContaining(`remote witness ${testRunId}`),
            ]),
          );

          for (const client of [a, b]) {
            const entries = await rows(client.page);
            expect(pending(entries)).toEqual([]);
            expect(fullStateOps(entries).every((id) => fullStateBefore.has(id))).toBe(
              true,
            );
            await client.page.reload();
            await waitForAppReady(client.page, { ensureRoute: false });
            expect(await snapshot(client.page, list, ids)).toEqual(final);
            await sync(client);
          }
          const fresh = await join('Fresh');
          await sync(fresh);
          expect(await snapshot(fresh.page, list, ids)).toEqual(final);
          expect(
            fullStateOps(await rows(fresh.page)).every((id) => fullStateBefore.has(id)),
          ).toBe(true);
        } finally {
          await writeFile(
            testInfo.outputPath('evidence.json'),
            JSON.stringify(evidence, null, 2),
          );
          for (const client of clients) await closeClient(client);
        }
      });
    }
  }
}

// The competing order that wins does not list a note the other device added
// before its own order; the note must stay listed everywhere.
for (const adderFirst of [false, true]) {
  test(`@supersync reorder crossing: a note added before a competing project order stays listed / ${adderFirst ? 'adding device uploads first' : 'adding device pending'}`, async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const clients: SimulatedE2EClient[] = [];
    const config = getSuperSyncConfig(await createTestUser(testRunId));
    const join = async (clientName: string): Promise<SimulatedE2EClient> => {
      const client = await createSimulatedClient(
        browser,
        baseURL!,
        clientName,
        testRunId,
      );
      clients.push(client);
      await client.sync.setupSuperSync(config);
      await client.page.addInitScript(() => {
        const flags = window as unknown as Record<string, unknown>;
        flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
        flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
        flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
      });
      return client;
    };
    try {
      const ids = ['first', 'second', 'third'].map((id) => `${id}-${testRunId}`);
      const a = await join('A');
      await dispatch(a.page, seeds('project notes', ids));
      await sync(a);
      const b = await join('B');
      await sync(b);
      await sync(a);

      const added = await addNoteInUi(a.page, `Added on A ${testRunId}`);
      await reorder(a.page, 'project notes', 0);
      await reorder(b.page, 'project notes', 1);
      const [first, second] = adderFirst ? [a, b] : [b, a];
      await sync(first);
      await sync(second);
      await sync(first);
      await sync(second);

      const all = [...ids, added];
      const final = await snapshot(a.page, 'project notes', all);
      expect(final.order).toContain(added);
      expect([...final.order].sort()).toEqual([...all].sort());
      expect(await snapshot(b.page, 'project notes', all)).toEqual(final);
      for (const client of clients) expect(pending(await rows(client.page))).toEqual([]);
      const fresh = await join('Fresh');
      await sync(fresh);
      expect(await snapshot(fresh.page, 'project notes', all)).toEqual(final);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
}

// A released (v19.1.0) device sends the competing order or the delete first and
// consumes the current device's reissue. A released device holding the pending
// side still stops, as before this fix.
test.describe('@supersync released reorder crossing (#10377)', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  const releasedCrossings: { list: ListName; other: OtherName; pendingOrder: boolean }[] =
    [
      { list: 'habits', other: 'order', pendingOrder: true },
      { list: 'project notes', other: 'order', pendingOrder: true },
      { list: 'project notes', other: 'Today order', pendingOrder: true },
      { list: 'project notes', other: 'delete', pendingOrder: true },
      { list: 'project notes', other: 'delete', pendingOrder: false },
    ];
  for (const { list, other, pendingOrder } of releasedCrossings) {
    const name =
      `released ${pendingOrder ? other : 'order'} first, current ` +
      `${pendingOrder ? 'order' : 'delete'} pending: ${list}`;
    test(name, async ({ browser, baseURL, testRunId }) => {
      test.setTimeout(240000);
      const clients: SimulatedE2EClient[] = [];
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const join = async (
        clientName: string,
        url: string,
        released: boolean,
      ): Promise<SimulatedE2EClient> => {
        const client = await createSimulatedClient(
          browser,
          url,
          clientName,
          testRunId,
          released ? { serviceWorkers: 'block' } : {},
        );
        clients.push(client);
        await client.sync.setupSuperSync(config);
        await client.page.addInitScript(() => {
          const flags = window as unknown as Record<string, unknown>;
          flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
          flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
          flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
        });
        return client;
      };
      try {
        const ids = ['first', 'second', 'third', 'fourth'].map(
          (id) => `${id}-${testRunId}`,
        );
        const deleted = ids[1];
        const current = await join('A', baseURL!, false);
        await dispatch(current.page, seeds(list, ids));
        await sync(current);
        const released = await join('Released', assets.url, true);
        await sync(released);
        await sync(current);
        const versions: (string | null)[] = [];
        released.page.on('request', (request) => {
          if (request.method() === 'GET' && request.url().includes('/api/sync/ops?'))
            versions.push(new URL(request.url()).searchParams.get('appVersion'));
        });
        const listed = (all: string[]): string[] => all.filter((id) => ids.includes(id));

        // The current device's pending op first, then the released device's.
        if (pendingOrder) await reorder(current.page, list, 0);
        else await removeNote(current.page, deleted);
        if (!pendingOrder) await reorder(released.page, list, 0);
        else if (other === 'order') await reorder(released.page, list, 1);
        else if (other === 'Today order') await reorder(released.page, 'Today notes', 1);
        else await removeNote(released.page, deleted);
        for (const client of clients) {
          await expect.poll(async () => pending(await rows(client.page))).toHaveLength(1);
        }

        await sync(released);
        await sync(current);
        await sync(released);
        await sync(current);

        const final = await snapshot(current.page, list, ids);
        expect(new Set(final.order).size).toBe(final.order.length);
        if (other === 'delete') {
          expect(final.order).not.toContain(deleted);
          expect(Object.keys(final.entities)).not.toContain(deleted);
        }
        const expectedRendered = (target: ListName, order: string[]): string[] =>
          // The habit view renders only enabled habits (ids[2] is disabled).
          target === 'habits' ? order.filter((id) => id !== ids[2]) : order;
        for (const reload of [false, true]) {
          if (reload) {
            await released.page.reload();
            await waitForAppReady(released.page, { ensureRoute: false });
            await sync(released);
          }
          expect(listed(await renderedOrder(released.page, list))).toEqual(
            expectedRendered(list, final.order),
          );
          if (list !== 'habits') {
            const second = list === 'project notes' ? 'Today notes' : 'project notes';
            expect(listed(await renderedOrder(released.page, second))).toEqual(
              final.second,
            );
          }
        }
        expect(versions).toContain('19.1.0');
        for (const client of clients)
          expect(pending(await rows(client.page))).toEqual([]);
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
