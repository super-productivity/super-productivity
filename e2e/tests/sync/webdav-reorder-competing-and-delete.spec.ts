import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  addNoteInUi,
  dispatch,
  fullStateOps,
  type ListName,
  type OtherName,
  pending,
  removeNote,
  reorder,
  type Row,
  rows,
  seeds,
  snapshot,
} from '../../utils/reorder-crossing';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  type WebDavConfig,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10377 on a file-based provider. A file-based provider never rejects an
 * upload, so the device holding the pending reorder must reissue it from
 * current state while it downloads; if it uploaded the stale original, the
 * other device would apply it over the remote op and the two would diverge.
 * Same crossings and expectations as supersync-reorder-competing-and-delete.
 */
interface Client {
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

const crossings: {
  list: ListName;
  other: OtherName;
  pendingOrder: boolean;
  /** A adds a note before its order; the winning order does not list it. */
  addsNote?: boolean;
}[] = [
  { list: 'project notes', other: 'order', pendingOrder: true, addsNote: true },
  { list: 'habits', other: 'order', pendingOrder: true },
  { list: 'project notes', other: 'order', pendingOrder: true },
  { list: 'project notes', other: 'Today order', pendingOrder: true },
  { list: 'project notes', other: 'delete', pendingOrder: true },
  { list: 'project notes', other: 'delete', pendingOrder: false },
];

test.describe('@webdav reorder crossings (#10377)', () => {
  for (const { list, other, pendingOrder, addsNote } of crossings) {
    const name =
      `${list} order vs ${other}` +
      (other === 'order' ? '' : ` / local-${pendingOrder ? 'order' : other}`) +
      (addsNote ? ' / a note added before the order stays listed' : '');
    test(name, async ({ browser, baseURL, request, webdavServerUp }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(240000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-reorder-crossing');
      await createSyncFolder(request, folder);
      const config: WebDavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      };
      const join = async (): Promise<Client> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const client = { page, sync: new SyncPage(page), work: new WorkViewPage(page) };
        await client.work.waitForTaskList();
        await client.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(page, client.sync)).toBe('success');
        // From here on every sync is an explicit click, also after a reload.
        await page.addInitScript(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        await page.evaluate(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        return client;
      };
      const sync = async (client: Client): Promise<void> => {
        await client.sync.triggerSync();
        expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
      };
      try {
        const ids = ['first', 'second', 'third', 'fourth'].map(
          (id) => `${id}-${testInfo.testId}`,
        );
        const a = await join();
        await dispatch(a.page, seeds(list, ids));
        await sync(a);
        const b = await join();
        await sync(a);
        const before = await snapshot(a.page, list, ids);
        expect(before.order).toEqual(ids);
        expect(await snapshot(b.page, list, ids)).toEqual(before);
        const fullStateBefore = new Set([
          ...fullStateOps(await rows(a.page)),
          ...fullStateOps(await rows(b.page)),
        ]);

        // A holds the pending side of the crossing; B uploads first.
        const orderClient = pendingOrder ? a : b;
        const deleted = ids[1];
        const act = async (client: Client): Promise<Row['op']> => {
          let code = list === 'habits' ? 'SM' : 'NO';
          if (client === orderClient) await reorder(client.page, list, 0);
          else if (other === 'order') await reorder(client.page, list, 1);
          else if (other === 'Today order') await reorder(client.page, 'Today notes', 1);
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
        if (addsNote)
          ids.push(await addNoteInUi(a.page, `Added on A ${testInfo.testId}`));
        const local = await act(a);
        await act(b);
        const reordered = await snapshot(orderClient.page, list, ids);
        const otherSide = await snapshot((pendingOrder ? b : a).page, list, ids);

        await sync(b);
        // A downloads B's op while its own crossing op is pending.
        await sync(a);
        if (local.o === 'MOV') {
          // The stale original never uploads: it is reissued at download time.
          const entry = (await rows(a.page)).find((r) => r.op.id === local.id)!;
          expect(entry.rejectedAt).toBeDefined();
        }
        await sync(b);
        await sync(a);

        const final = await snapshot(a.page, list, ids);
        expect(await snapshot(b.page, list, ids)).toEqual(final);
        if (addsNote) {
          expect(final.order).toContain(ids[ids.length - 1]);
          expect([...final.order].sort()).toEqual([...ids].sort());
        } else if (other === 'order') {
          expect([reordered.order, otherSide.order]).toContainEqual(final.order);
          expect(final.entities).toEqual(before.entities);
        } else if (other === 'Today order') {
          expect(final.order).toEqual(reordered.order);
          expect(final.second).toEqual(otherSide.second);
        } else {
          const kept = (all: string[]): string[] => all.filter((id) => id !== deleted);
          expect(final.order).toEqual(kept(reordered.order));
          expect(final.second).toEqual(kept(before.second));
          expect(Object.keys(final.entities).sort()).toEqual(kept(ids).sort());
        }
        for (const client of [a, b]) {
          const entries = await rows(client.page);
          expect(pending(entries)).toEqual([]);
          expect(fullStateOps(entries).every((id) => fullStateBefore.has(id))).toBe(true);
          await client.page.reload();
          await waitForAppReady(client.page, { ensureRoute: false });
          expect(await snapshot(client.page, list, ids)).toEqual(final);
        }
        const fresh = await join();
        expect(await snapshot(fresh.page, list, ids)).toEqual(final);
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});
