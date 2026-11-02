import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  confirmSyncConflictOverwriteIfShown,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';

interface TaskData {
  id: string;
  title: string;
  projectId: string;
}

interface TaskOperation {
  id: string;
  c: string;
  d: string;
  v: Record<string, number>;
  t: number;
  sv: number;
  p: { actionPayload: { task: TaskData } };
}
interface SyncFile {
  version: number;
  syncVersion: number;
  vectorClock: Record<string, number>;
  snapshotBaseClock?: Record<string, number>;
  recentOps: TaskOperation[];
  oldestOpSyncVersion: number;
  clientId: string;
  lastModified: number;
  state: {
    task: { ids: string[]; entities: Record<string, TaskData> };
    project: { entities: Record<string, { taskIds: string[] }> };
    tag: { entities: Record<string, { taskIds: string[] }> };
  };
}

const localState = (
  page: Page,
): Promise<{ ids: string[]; clock: Record<string, number>; cursor: string | null }> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('SUP_OPS');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    try {
      const ids = await new Promise<string[]>((resolve, reject) => {
        const read = db.transaction('ops').objectStore('ops').getAll();
        read.onsuccess = (): void =>
          resolve((read.result as Array<{ op: { id: string } }>).map(({ op }) => op.id));
        read.onerror = (): void => reject(read.error);
      });
      const clock = await new Promise<Record<string, number>>((resolve, reject) => {
        const read = db.transaction('vector_clock').objectStore('vector_clock').getAll();
        read.onsuccess = (): void =>
          resolve((read.result as Array<{ clock: Record<string, number> }>)[0].clock);
        read.onerror = (): void => reject(read.error);
      });
      return { ids, clock, cursor: localStorage.getItem('FILE_SYNC_VERSION_state') };
    } finally {
      db.close();
    }
  });

test.describe('@webdav Upload must not acknowledge unseen operations (#10239)', () => {
  test.describe.configure({ mode: 'serial' });
  for (const sameVersionReset of [false, true]) {
    test(`delivers a reused-counter task after ${sameVersionReset ? 'same-version snapshot replacement' : 'cold-cache upload'}`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }) => {
      void webdavServerUp;
      const folder = generateSyncFolderName('e2e-unseen-10239');
      await createSyncFolder(request, folder);
      const config = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        // This regression seeds a v2 counter/snapshot, regardless of suite mode.
        isUseSplitSyncFiles: false,
      };
      const fileUrl = `${config.baseUrl}${folder}/DEV/sync-data.json`;
      const headers = {
        Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
      };
      const readFile = async (): Promise<{ prefix: string; data: SyncFile }> => {
        const response = await request.get(fileUrl, { headers });
        expect(response.ok()).toBe(true);
        const body = await response.text();
        const start = body.indexOf('__') + 2;
        expect(start).toBeGreaterThan(1);
        return {
          prefix: body.slice(0, start),
          data: JSON.parse(body.slice(start)) as SyncFile,
        };
      };
      const author = await setupSyncClient(browser, baseURL);
      const observer = await setupSyncClient(browser, baseURL);
      // Install the clock before Angular timers exist; installing it mid-session
      // strands RxJS interval handles. Date changes do not advance browser timers.
      await observer.page.route('**/clock-setup-10239', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
      );
      await observer.page.goto('/clock-setup-10239');
      await observer.page.clock.setFixedTime(Date.now());
      await observer.page.goto('/');
      try {
        const authorWork = new WorkViewPage(author.page);
        const observerWork = new WorkViewPage(observer.page);
        const authorSync = new SyncPage(author.page);
        const observerSync = new SyncPage(observer.page);
        await authorWork.waitForTaskList();
        await observerWork.waitForTaskList();
        await authorSync.setupWebdavSync(config);
        await waitForSyncComplete(author.page, authorSync);
        await authorWork.addTask('Original author task');
        await authorSync.triggerSync();
        await waitForSyncComplete(author.page, authorSync);
        const initialFile = (await readFile()).data;
        expect(initialFile.version).toBe(2);
        const original = initialFile.recentOps.find(
          (op) => op.p?.actionPayload?.task?.title === 'Original author task',
        );
        expect(original).toBeDefined();
        const template = original!;
        await observerSync.setupWebdavSync(config);
        await waitForSyncComplete(observer.page, observerSync);
        await expect(
          observer.page.locator('task', { hasText: 'Original author task' }),
        ).toBeVisible();
        expect((await localState(observer.page)).ids).toContain(template.id);
        await observerWork.addTask('Observer local task');

        // A real browser lock models an upload in another tab. The normal download
        // completes first, but upload cannot start until the lock is released.
        await observer.page.evaluate(
          () =>
            new Promise<void>((acquired) => {
              void navigator.locks.request('sp_op_log_upload', async () => {
                acquired();
                await new Promise<void>((release) =>
                  window.addEventListener('release-upload-10239', () => release(), {
                    once: true,
                  }),
                );
              });
            }),
        );
        const methods: string[] = [];
        observer.page.on('request', (req) => {
          if (req.url() === fileUrl) methods.push(req.method());
        });
        await observerSync.triggerSync();
        await expect
          .poll(() =>
            observer.page.evaluate(async () =>
              (await navigator.locks.query()).pending?.some(
                (lock) => lock.name === 'sp_op_log_upload',
              ),
            ),
          )
          .toBe(true);
        expect(methods).toEqual(['GET']);
        const processedCursor = (await localState(observer.page)).cursor;
        await observer.page.clock.setFixedTime(Date.now() + 60_000);

        // Seed the exact post-USE_REMOTE counter-reuse shape from a real browser
        // addTask operation: a new operation/task ID with an already covered author
        // counter. The reset history itself is covered by the integration regression.
        const appendTask = async (
          title: string,
          counter: number,
          reset = false,
        ): Promise<TaskOperation> => {
          const remote = await readFile();
          const taskId = randomUUID();
          const op = JSON.parse(
            JSON.stringify(template).replaceAll(template.d, taskId),
          ) as TaskOperation;
          op.id = randomUUID();
          op.p.actionPayload.task.title = title;
          op.v = { ...template.v, [template.c]: counter };
          op.t = Date.now();
          if (reset) {
            // A stale desktop chose USE_LOCAL (version 1), then the author chose
            // USE_REMOTE and created its next task (version 2, author counter reused).
            // Preserve a valid full snapshot because reset recovery hydrates it.
            op.v['desktop-reset-10239'] = 1;
            expect(remote.data.syncVersion).toBe(2);
            remote.data.vectorClock = { ...op.v };
            remote.data.snapshotBaseClock = { ...op.v, [template.c]: counter - 1 };
            remote.data.recentOps = [];
            remote.data.state.task.ids = [];
            remote.data.state.task.entities = {};
            for (const project of Object.values(remote.data.state.project.entities))
              project.taskIds = [];
            for (const tag of Object.values(remote.data.state.tag.entities))
              tag.taskIds = [];
          } else {
            remote.data.syncVersion++;
          }
          op.sv = remote.data.syncVersion;
          remote.data.vectorClock[template.c] = counter;
          remote.data.clientId = op.c;
          remote.data.lastModified = op.t;
          remote.data.recentOps.push(op);
          remote.data.oldestOpSyncVersion = remote.data.recentOps[0].sv;
          remote.data.state.task.ids.push(taskId);
          remote.data.state.task.entities[taskId] = op.p.actionPayload.task;
          remote.data.state.project.entities[
            op.p.actionPayload.task.projectId
          ].taskIds.push(taskId);
          remote.data.state.tag.entities['TODAY'].taskIds.push(taskId);
          const written = await request.put(fileUrl, {
            headers,
            data: remote.prefix + JSON.stringify(remote.data),
          });
          expect(written.ok()).toBe(true);
          return op;
        };
        const coveredCounter = (await localState(observer.page)).clock[template.c];
        const unseen = await appendTask(
          'New task after counter reset',
          template.v[template.c],
          sameVersionReset,
        );
        expect(unseen.id).not.toBe(template.id);
        expect((await localState(observer.page)).clock[unseen.c]).toBeGreaterThanOrEqual(
          unseen.v[unseen.c],
        );
        expect((await localState(observer.page)).ids).not.toContain(unseen.id);
        await observer.page.evaluate(() =>
          window.dispatchEvent(new Event('release-upload-10239')),
        );
        // A stale-baseline rejection is a retryable idle state; on buggy code this
        // instead succeeds and advances the persisted cursor past the unseen op.
        await waitForSyncComplete(observer.page, observerSync, 30000, {
          allowResponseOnlyCompletion: true,
        });
        expect(methods).toEqual(['GET', 'GET']);
        expect((await localState(observer.page)).cursor).toBe(processedCursor);
        expect((await readFile()).data.syncVersion).toBe(unseen.sv);

        if (sameVersionReset) {
          // Recognize the replacement even though its version equals our cursor;
          // the unseen snapshot base identifies it without a version decrease.
          await observerSync.triggerSync();
          expect(await waitForSyncComplete(observer.page, observerSync)).toBe('conflict');
          const conflict = observer.page.locator('dialog-sync-conflict');
          observerSync.prepareForNextSyncCycle('read');
          await conflict.getByRole('button', { name: /Keep remote/i }).click();
          await confirmSyncConflictOverwriteIfShown(observer.page, conflict);
          await waitForSyncComplete(observer.page, observerSync, 30000, {
            allowResponseOnlyCompletion: true,
          });
        }

        const later = await appendTask('Later task positive control', coveredCounter + 1);
        await observerSync.triggerSync();
        await waitForSyncComplete(observer.page, observerSync);
        await expect(
          observer.page.locator('task', { hasText: 'Later task positive control' }),
        ).toBeVisible();
        expect((await localState(observer.page)).ids).toContain(later.id);
        await expect(
          observer.page.locator('task', { hasText: 'New task after counter reset' }),
        ).toBeVisible();
        expect((await localState(observer.page)).ids).toContain(unseen.id);
        const converged = (await readFile()).data.recentOps;
        expect(converged.map((op) => op.id)).toEqual(
          expect.arrayContaining([unseen.id, later.id]),
        );
        if (!sameVersionReset) {
          expect(
            converged.some(
              (op) => op.p?.actionPayload?.task?.title === 'Observer local task',
            ),
          ).toBe(true);
        }
        await observer.page.reload();
        await observerWork.waitForTaskList();
        await expect(
          observer.page.locator('task', { hasText: 'New task after counter reset' }),
        ).toBeVisible();
        const persisted = await localState(observer.page);
        expect(JSON.parse(persisted.cursor!)).toMatchObject({
          seqCounters: { WebDAV: (await readFile()).data.syncVersion },
        });
        if (sameVersionReset) {
          await expect(
            observer.page.locator('task', { hasText: 'Original author task' }),
          ).toHaveCount(0);
          expect(persisted.clock['desktop-reset-10239']).toBe(1);
        }
      } finally {
        await closeContextsSafely(author.context, observer.context);
      }
    });
  }
});
