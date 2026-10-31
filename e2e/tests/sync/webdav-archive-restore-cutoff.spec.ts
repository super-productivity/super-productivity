import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  readPrefixedFile,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { flushPendingWrites } from '../../utils/waits';

interface ArchivedTask extends Record<string, unknown> {
  id: string;
  title: string;
}

interface RemoteSnapshot {
  taskArchiveSnapshotVersion?: number;
  version: number;
  syncVersion: number;
  state: {
    task: { entities: Record<string, unknown> };
    pluginUserData: { id: string; data: string }[];
  };
  archiveYoung?: { task: { entities: Record<string, unknown> } };
  archiveOld?: { task: { entities: Record<string, unknown> } };
}

interface CutoffGate {
  captured: boolean;
  activeTaskPresent?: boolean;
  pendingCount?: number;
  release: () => void;
  restoreRequest: () => void;
}

interface TestWindow {
  __e2eTestHelpers: {
    store: {
      dispatch: (action: unknown) => void;
      subscribe: (listener: (state: Record<string, unknown>) => void) => {
        unsubscribe: () => void;
      };
    };
  };
  __archiveRestoreCutoff?: CutoffGate;
  __archiveFlushCommit?: {
    reached: boolean;
    release: () => void;
    restorePut: () => void;
  };
}

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

/** Read the real archive stores without normalizing or replacing their contents. */
const readArchives = (
  page: Page,
  taskTitle: string,
): Promise<{ young?: ArchivedTask; old?: ArchivedTask }> =>
  page.evaluate(async (title) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('SUP_OPS');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const transaction = db.transaction(['archive_young', 'archive_old'], 'readonly');
      const entries = await Promise.all(
        ['archive_young', 'archive_old'].map(
          (store) =>
            new Promise<{
              data?: { task?: { entities?: Record<string, ArchivedTask> } };
            }>((resolve, reject) => {
              const request = transaction.objectStore(store).get('current');
              request.onsuccess = () => resolve(request.result ?? {});
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      const young = Object.values(entries[0].data?.task?.entities ?? {});
      const old = Object.values(entries[1].data?.task?.entities ?? {});
      return {
        young: young.find((task) => task.title === title),
        old: old.find((task) => task.title === title),
      };
    } finally {
      db.close();
    }
  }, taskTitle);

const archiveDoneTasks = async (page: Page): Promise<void> => {
  await page.locator('.e2e-finish-day').click();
  await page.waitForURL(/daily-summary/);
  await page
    .locator('daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))')
    .click();
  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/**
 * Delay only the return of the real upload capture callback. The browser still
 * owns sp_op_log, and its callback has already read pending ops and active state.
 * Reducers and archive effects remain real; a restore op's persistence waits.
 */
const installCaptureGate = (page: Page, taskId: string): Promise<void> =>
  page.evaluate((id) => {
    const target = window as unknown as TestWindow;
    const original = navigator.locks.request.bind(navigator.locks);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const gate: CutoffGate = {
      captured: false,
      release,
      restoreRequest: () => {
        navigator.locks.request = original;
      },
    };
    target.__archiveRestoreCutoff = gate;
    navigator.locks.request = (async (
      name: string,
      optionsOrCallback: LockOptions | LockGrantedCallback<unknown>,
      maybeCallback?: LockGrantedCallback<unknown>,
    ) => {
      const callback =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      if (!callback) throw new Error('Expected a native Web Locks callback');
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      return original(name, options, async (lock) => {
        const result: unknown = await callback(lock);
        if (
          name === 'sp_op_log' &&
          !gate.captured &&
          result !== null &&
          typeof result === 'object' &&
          'pendingOps' in result &&
          'localStateSnapshot' in result
        ) {
          const capture = result as {
            pendingOps: unknown[];
            localStateSnapshot:
              | { task: { entities: Record<string, unknown> } }
              | {
                  kind: 'capturedFileState';
                  state: { task: { entities: Record<string, unknown> } };
                };
          };
          gate.pendingCount = capture.pendingOps.length;
          const snapshot =
            'kind' in capture.localStateSnapshot
              ? capture.localStateSnapshot.state
              : capture.localStateSnapshot;
          gate.activeTaskPresent = !!snapshot.task.entities[id];
          gate.captured = true;
          await released;
        }
        return result;
      });
    }) as typeof navigator.locks.request;
  }, taskId);

test.describe('@webdav archive restore at the upload snapshot cutoff', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  test('keeps an archived attachment owner in the published v2 snapshot during restore', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const folder = generateSyncFolderName('archive-restore-cutoff');
    const remoteUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/sync-data.json`;
    await createSyncFolder(request, folder);
    const client = await setupSyncClient(browser, baseURL);
    try {
      const { page } = client;
      const work = new WorkViewPage(page);
      const sync = new SyncPage(page);
      const tasks = new TaskPage(page);
      await work.waitForTaskList();
      await page.evaluate(() => {
        (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey: 'sync',
          sectionCfg: { isManualSyncOnly: true },
        });
      });
      const title = `Attachment owner ${folder}`;
      await work.addTask(title);
      await flushPendingWrites(page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles: false,
      });
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      await tasks.markTaskAsDone(tasks.getTaskByText(title).first());
      await archiveDoneTasks(page);
      await expect
        .poll(async () => (await readArchives(page, title)).young?.id)
        .toBeTruthy();
      const archived = (await readArchives(page, title)).young!;
      expect((await readArchives(page, title)).old).toBeUndefined();
      await expect(tasks.getTaskByText(title)).toHaveCount(0);

      const attachmentId = '12345678-1234-4234-8234-123456789012';
      const attachmentKey = `sp-webdav-attachments:attachment-v2/${archived.id}/${attachmentId}`;
      const attachmentData = JSON.stringify({
        v: 2,
        id: attachmentId,
        taskId: archived.id,
        name: 'cutoff.pdf',
        objectName: `${attachmentId}.pdf`,
        size: 3,
        mime: 'application/pdf',
        sha256: 'a'.repeat(64),
        storeId: 'b'.repeat(64),
      });
      await page.evaluate(
        ({ id, data }) => {
          (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
            type: '[Plugin] Upsert User Data',
            pluginUserData: { id, data },
            meta: {
              isPersistent: true,
              entityType: 'PLUGIN_USER_DATA',
              entityId: id,
              opType: 'UPD',
            },
          });
        },
        { id: attachmentKey, data: attachmentData },
      );
      await flushPendingWrites(page);
      await sync.triggerSync();
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const before = await readPrefixedFile<RemoteSnapshot>(
        request,
        remoteUrl,
        authorization,
      );
      expect(before.version).toBe(2);
      expect(before.state.task.entities[archived.id]).toBeUndefined();
      expect(before.archiveYoung?.task.entities[archived.id]).toBeDefined();
      expect(before.archiveOld?.task.entities[archived.id]).toBeUndefined();
      expect(before.state.pluginUserData).toContainEqual({
        id: attachmentKey,
        data: attachmentData,
      });

      // A separate real operation starts this upload; restore belongs after its cutoff.
      await work.addTask(`Pending upload ${folder}`);
      await flushPendingWrites(page);
      await installCaptureGate(page, archived.id);
      await sync.triggerSync();
      await page.waitForFunction(
        () => (window as unknown as TestWindow).__archiveRestoreCutoff?.captured,
      );
      const capture = await page.evaluate(() => {
        const gate = (window as unknown as TestWindow).__archiveRestoreCutoff!;
        return {
          activeTaskPresent: gate.activeTaskPresent,
          pendingCount: gate.pendingCount,
        };
      });
      expect(capture.activeTaskPresent).toBe(false);
      expect(capture.pendingCount).toBeGreaterThan(0);
      await page.evaluate((task) => {
        (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
          type: '[Task Shared] restoreTask',
          task,
          subTasks: [],
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: task.id,
            opType: 'UPD',
          },
        });
      }, archived);
      expect(
        await page.evaluate((id) => {
          let present = false;
          const subscription = (
            window as unknown as TestWindow
          ).__e2eTestHelpers.store.subscribe((state) => {
            const taskState = (state.tasks ?? state.task) as {
              entities: Record<string, unknown>;
            };
            present = !!taskState.entities[id];
          });
          subscription.unsubscribe();
          return present;
        }, archived.id),
        'The genuine restore reducer must add the owner to active state',
      ).toBe(true);
      // Prove that the real archive effect removed T before the upload continues.
      await expect
        .poll(async () => {
          const archives = await readArchives(page, title);
          return !archives.young && !archives.old;
        })
        .toBe(true);
      await page.evaluate(() => {
        (window as unknown as TestWindow).__archiveRestoreCutoff!.release();
      });
      // Restore находится после cutoff и остаётся unsynced: зелёная общая
      // отметка ещё не ожидается. Проверяем завершённый запрос и сам wire ниже.
      expect(
        await waitForSyncComplete(page, sync, 30000, {
          allowResponseOnlyCompletion: true,
        }),
      ).toBe('success');

      // Read the actual primary, not a mocked projection or the newer local store.
      const published = await readPrefixedFile<RemoteSnapshot>(
        request,
        remoteUrl,
        authorization,
      );
      expect(published.version).toBe(2);
      expect(published.state.pluginUserData).toContainEqual({
        id: attachmentKey,
        data: attachmentData,
      });
      expect(published.syncVersion).toBeGreaterThan(before.syncVersion);
      expect(
        published.state.task.entities[archived.id],
        'The restore belongs after the captured active-state cutoff',
      ).toBeUndefined();
      expect(
        published.archiveYoung?.task.entities[archived.id],
        'The snapshot must retain the archive captured before the restore',
      ).toEqual(archived);
      expect(published.archiveOld?.task.entities[archived.id]).toBeUndefined();
    } finally {
      await client.page.evaluate(() => {
        const gate = (window as unknown as TestWindow).__archiveRestoreCutoff;
        gate?.release();
        gate?.restoreRequest();
      });
      await closeContextsSafely(client.context);
    }
  });
});

test('@webdav keeps an archived owner in the primary while young moves to old', async ({
  browser,
  baseURL,
  request,
  webdavServerUp,
}) => {
  void webdavServerUp;
  test.slow();
  const folder = generateSyncFolderName('archive-flush-cutoff');
  const remoteUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/sync-data.json`;
  await createSyncFolder(request, folder);
  const client = await setupSyncClient(browser, baseURL);
  try {
    const { page } = client;
    const work = new WorkViewPage(page);
    const sync = new SyncPage(page);
    const tasks = new TaskPage(page);
    await work.waitForTaskList();
    await page.evaluate(() => {
      (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'sync',
        sectionCfg: { isManualSyncOnly: true },
      });
    });
    const title = `Young archive owner ${folder}`;
    await work.addTask(title);
    await flushPendingWrites(page);
    await sync.setupWebdavSync({
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folder}`,
      isUseSplitSyncFiles: false,
    });
    expect(await waitForSyncComplete(page, sync)).toBe('success');
    await tasks.markTaskAsDone(tasks.getTaskByText(title).first());
    await archiveDoneTasks(page);
    await expect
      .poll(async () => (await readArchives(page, title)).young?.id)
      .toBeTruthy();
    const archived = (await readArchives(page, title)).young!;
    await flushPendingWrites(page);
    await sync.triggerSync();
    expect(await waitForSyncComplete(page, sync)).toBe('success');
    const before = await readPrefixedFile<RemoteSnapshot>(
      request,
      remoteUrl,
      authorization,
    );
    expect(before.archiveYoung?.task.entities[archived.id]).toBeDefined();

    // Меняем только часы тестового браузера. Старая задача проходит настоящий
    // порог 21 день; следующий Finish Day запускает штатный local flush.
    const future = await page.evaluate(() => {
      const ageMs = 22 * 24 * 60 * 60 * 1000;
      return Date.now() + ageMs;
    });
    await page.clock.setSystemTime(new Date(future));
    const nextTitle = `Next archive batch ${folder}`;
    await work.addTask(nextTitle);
    await tasks.markTaskAsDone(tasks.getTaskByText(nextTitle).first());
    await flushPendingWrites(page);
    await page.evaluate((id) => {
      const target = window as unknown as TestWindow;
      const originalPut = IDBObjectStore.prototype.put;
      const gate = {
        reached: false,
        release: () => {},
        restorePut: () => {
          IDBObjectStore.prototype.put = originalPut;
        },
      };
      target.__archiveFlushCommit = gate;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        const result =
          key === undefined
            ? originalPut.call(this, value)
            : originalPut.call(this, value, key);
        const row = value as { data?: { task?: { ids?: string[] } } };
        if (
          this.transaction.db.name === 'SUP_OPS' &&
          this.name === 'archive_young' &&
          Array.isArray(row.data?.task?.ids) &&
          !row.data.task.ids.includes(id)
        ) {
          IDBObjectStore.prototype.put = originalPut;
          const transaction = this.transaction;
          // Настоящий commit завершён. Задерживается только доставка события
          // библиотеке idb, чтобы второй save ещё не начался на исходном коде.
          transaction.addEventListener(
            'complete',
            (event) => {
              event.stopImmediatePropagation();
              gate.reached = true;
              gate.release = () => {
                transaction.dispatchEvent(new Event('complete'));
              };
            },
            { once: true },
          );
        }
        return result;
      };
    }, archived.id);
    await page.locator('.e2e-finish-day').click();
    await page.waitForURL(/daily-summary/);
    await page
      .locator('daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))')
      .click();
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__archiveFlushCommit?.reached,
    );
    await sync.triggerSync();
    let published: RemoteSnapshot | undefined;
    // Исправленный capture может ждать TASK_ARCHIVE. Исходный код публикует
    // файл сразу. Ожидаем один из этих наблюдаемых исходов без фиксированной паузы.
    await expect
      .poll(async () => {
        const data = await readPrefixedFile<RemoteSnapshot>(
          request,
          remoteUrl,
          authorization,
        );
        if (data.syncVersion > before.syncVersion) {
          published = data;
          return 'published';
        }
        const pending = await page.evaluate(async () =>
          (await navigator.locks.query()).pending?.some(
            (lock) => lock.name === 'sp_task_archive',
          ),
        );
        return pending ? 'waiting-for-archive' : null;
      })
      .not.toBeNull();
    await page.evaluate(() =>
      (window as unknown as TestWindow).__archiveFlushCommit!.release(),
    );
    expect(await waitForSyncComplete(page, sync)).toBe('success');
    published ??= await readPrefixedFile<RemoteSnapshot>(
      request,
      remoteUrl,
      authorization,
    );
    expect(
      !!published.state.task.entities[archived.id] ||
        !!published.archiveYoung?.task.entities[archived.id] ||
        !!published.archiveOld?.task.entities[archived.id],
      'Опубликованный primary не должен терять задачу между young и old',
    ).toBe(true);
  } finally {
    await client.page.evaluate(() => {
      const gate = (window as unknown as TestWindow).__archiveFlushCommit;
      gate?.release();
      gate?.restorePut();
    });
    await closeContextsSafely(client.context);
  }
});
