import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  dispatch,
  editListed,
  fullStateOps,
  type ListName,
  pending,
  reorder,
  rows,
  seeds,
  snapshot,
  type Snapshot,
  withoutModified,
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
 * #10420 on a file-based provider, which never rejects an upload: a pending
 * note or habit order beside an edit conflict on a listed entity, or against
 * the other device's resolution row (habits). The order must stay out of the
 * conflict, survive either winner and converge on both devices, also after a
 * restart. Same cases and expectations as supersync-reorder-beside-conflict.
 */
interface Client {
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

type Direction = 'reorderer resolves' | 'reorderer receives the resolution';
const cases: { list: ListName; direction: Direction }[] = [
  { list: 'habits', direction: 'reorderer resolves' },
  { list: 'habits', direction: 'reorderer receives the resolution' },
  { list: 'project notes', direction: 'reorderer resolves' },
];

test.describe('@webdav reorder beside a conflict (#10420)', () => {
  for (const { list, direction } of cases) {
    for (const bNewer of [true, false]) {
      test(`${list} / ${direction} / ${bNewer ? 'B' : 'A'} edits last`, async ({
        browser,
        baseURL,
        request,
        webdavServerUp,
      }, testInfo) => {
        void webdavServerUp;
        test.setTimeout(240000);
        const contexts: BrowserContext[] = [];
        const folder = generateSyncFolderName('e2e-reorder-beside-conflict');
        await createSyncFolder(request, folder);
        const config: WebDavConfig = {
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
        };
        const join = async (): Promise<Client> => {
          const { context, page } = await setupSyncClient(browser, baseURL);
          contexts.push(context);
          const client = {
            page,
            sync: new SyncPage(page),
            work: new WorkViewPage(page),
          };
          await client.work.waitForTaskList();
          await client.sync.setupWebdavSync(config);
          expect(await waitForSyncComplete(page, client.sync)).toBe('success');
          // From here on every sync is an explicit click, also after a reload.
          await page.addInitScript(() => {
            (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC =
              true;
          });
          await page.evaluate(() => {
            (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC =
              true;
          });
          return client;
        };
        const sync = async (client: Client): Promise<void> => {
          await client.sync.triggerSync();
          expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
        };
        const shot = async (client: Client, ids: string[]): Promise<Snapshot> =>
          withoutModified(await snapshot(client.page, list, ids));
        const valueOf = (state: Snapshot, id: string): unknown =>
          state.entities[id]?.[list === 'habits' ? 'title' : 'content'];
        try {
          const ids = ['first', 'second', 'third', 'fourth'].map(
            (id) => `${id}-${testInfo.testId}`,
          );
          const target = ids[0];
          const a = await join();
          await dispatch(a.page, seeds(list, ids));
          await sync(a);
          const b = await join();
          await sync(a);
          const before = await shot(a, ids);
          expect(await shot(b, ids)).toEqual(before);
          const fullStateBefore = new Set([
            ...fullStateOps(await rows(a.page)),
            ...fullStateOps(await rows(b.page)),
          ]);

          const valueA = `Edited on A ${testInfo.testId}`;
          const valueB = `Edited on B ${testInfo.testId}`;
          const editA = (): Promise<void> => editListed(a.page, list, target, valueA);
          const editB = (): Promise<void> => editListed(b.page, list, target, valueB);
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
          const reordered = (await shot(a, ids)).order;
          expect(reordered).not.toEqual(before.order);

          await sync(b);
          await sync(a);
          await sync(b);
          await sync(a);

          const final = await shot(a, ids);
          expect(await shot(b, ids)).toEqual(final);
          expect(final.order).toEqual(reordered);
          expect(valueOf(final, target)).toBe(bNewer ? valueB : valueA);
          for (const client of [a, b]) {
            const entries = await rows(client.page);
            expect(pending(entries)).toEqual([]);
            expect(fullStateOps(entries).every((id) => fullStateBefore.has(id))).toBe(
              true,
            );
            await client.page.reload();
            await waitForAppReady(client.page, { ensureRoute: false });
            expect(await shot(client, ids)).toEqual(final);
          }
          const fresh = await join();
          expect(await shot(fresh, ids)).toEqual(final);
        } finally {
          await closeContextsSafely(...contexts);
        }
      });
    }
  }
});
