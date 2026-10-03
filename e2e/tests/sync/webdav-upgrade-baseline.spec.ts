import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../fixtures/webdav.fixture';
import { ImportPage } from '../../pages/import.page';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { translationRegex } from '../../utils/i18n-strings';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';

interface TaskData {
  id: string;
  title: string;
  projectId: string;
}
interface TaskOp {
  id: string;
  c: string;
  d: string;
  v: Record<string, number>;
  sv: number;
  p: { actionPayload: { task: TaskData } };
}
interface State {
  task: { ids: string[]; entities: Record<string, TaskData> };
  project: { entities: Record<string, { taskIds: string[] }> };
  tag: { entities: Record<string, { taskIds: string[] }> };
}
interface FileData {
  version: number;
  syncVersion: number;
  vectorClock: Record<string, number>;
  snapshotBaseClock?: Record<string, number>;
  recentOps: TaskOp[];
  oldestOpSyncVersion?: number;
  snapshotRef: {
    file?: string;
    syncVersion: number;
    vectorClock: Record<string, number>;
  };
  state: State;
}

const removeOnlyRecordedClocks = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const key = 'FILE_SYNC_VERSION_state';
    const original = JSON.parse(localStorage.getItem(key)!);
    if (!Object.keys(original.revs).length || !Object.keys(original.seqCounters).length)
      throw new Error('Expected committed revision and cursor');
    const upgraded = { ...original };
    delete upgraded.lastSeenClocks;
    localStorage.setItem(key, JSON.stringify(upgraded));
  });

// The clockless upgrade must inspect the snapshot base even when a replacement's
// tail masks its counter reset (#10469/#10478). Seed only the remote envelope,
// using actual captured addTask payloads; apply, persistence and restart are real.
test.describe('@webdav upgrade without lastSeenClocks', () => {
  for (const split of [false, true]) {
    for (const hydrated of [false, true]) {
      test(`preserves ${hydrated ? 'already hydrated' : 'unseen replacement'} baseline (v${split ? 3 : 2})`, async ({
        browser,
        baseURL,
        request,
        webdavServerUp,
      }) => {
        expect(webdavServerUp).toBe(true);
        const folder = generateSyncFolderName(`upgrade-${split}-${hydrated}`);
        const root = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
        const config = {
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
          isUseSplitSyncFiles: split,
        };
        const headers = {
          Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
        };
        const fileUrl = `${root}${split ? 'sync-ops.json' : 'sync-data.json'}`;
        const read = async (url: string): Promise<FileData> => {
          const response = await request.get(url, { headers });
          expect(response.ok()).toBe(true);
          const text = await response.text();
          return JSON.parse(text.slice(text.indexOf('__') + 2)) as FileData;
        };
        const write = async (url: string, data: FileData): Promise<void> => {
          expect(
            (
              await request.put(url, {
                headers,
                data: `pf_${data.version}__${JSON.stringify(data)}`,
              })
            ).ok(),
          ).toBe(true);
        };
        await createSyncFolder(request, folder);
        const a = await setupSyncClient(browser, baseURL);
        const b = await setupSyncClient(browser, baseURL);
        try {
          const workA = new WorkViewPage(a.page);
          const syncA = new SyncPage(a.page);
          const workB = new WorkViewPage(b.page);
          const syncB = new SyncPage(b.page);
          await workA.waitForTaskList();
          await workB.waitForTaskList();
          for (const page of [a.page, b.page]) {
            await page.addInitScript(() => {
              (
                window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
              ).__SP_E2E_BLOCK_AUTO_SYNC = true;
            });
            await page.evaluate(() => {
              (
                window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
              ).__SP_E2E_BLOCK_AUTO_SYNC = true;
            });
          }
          await workA.addTask('Original baseline');
          await syncA.setupWebdavSync(config);
          await waitForSyncComplete(a.page, syncA);
          await workA.addTask('Captured task template');
          await waitForStatePersistence(a.page);
          await syncA.triggerSync();
          await waitForSyncComplete(a.page, syncA);
          await syncB.setupWebdavSync(config);
          await waitForSyncComplete(b.page, syncB);
          await expect(
            b.page.locator('task', { hasText: 'Original baseline' }),
          ).toBeVisible();
          await waitForStatePersistence(b.page);
          const originalMetadata = await b.page.evaluate(() =>
            JSON.parse(localStorage.getItem('FILE_SYNC_VERSION_state')!),
          );
          const file = await read(fileUrl);
          const template = file.recentOps.find(
            (op) => op.p?.actionPayload?.task?.title === 'Captured task template',
          )!;
          expect(template).toBeDefined();
          const snapshotUrl = split
            ? `${root}${file.snapshotRef.file ?? 'sync-state.json'}`
            : fileUrl;
          const snapshot = split ? await read(snapshotUrl) : file;
          const addToSnapshot = (task: TaskData): void => {
            snapshot.state.task.ids.push(task.id);
            snapshot.state.task.entities[task.id] = task;
            snapshot.state.project.entities[task.projectId].taskIds.push(task.id);
            snapshot.state.tag.entities['TODAY'].taskIds.push(task.id);
          };
          // V3's original snapshot predates the captured template op. Materialize
          // that task too so the replacement state matches its declared base.
          if (!snapshot.state.task.ids.includes(template.d)) {
            addToSnapshot(template.p.actionPayload.task);
          }
          // A baseline-only task is the data that a tail-only download loses.
          const base = { ...file.vectorClock };
          if (!hydrated) {
            base[template.c]++;
            addToSnapshot({
              ...template.p.actionPayload.task,
              id: randomUUID(),
              title: 'Replacement baseline only',
            });
          }
          const tailId = randomUUID();
          const tail = JSON.parse(
            JSON.stringify(template).replaceAll(template.d, tailId),
          ) as TaskOp;
          tail.id = randomUUID();
          tail.p.actionPayload.task.title = 'Tail after replacement';
          tail.v = { ...base, [template.c]: base[template.c] + 1 };
          tail.sv = file.syncVersion;
          file.snapshotBaseClock = base;
          file.vectorClock = tail.v;
          file.recentOps = [tail];
          file.oldestOpSyncVersion = tail.sv;
          if (split) {
            snapshot.syncVersion = file.syncVersion - 1;
            snapshot.vectorClock = base;
            file.snapshotRef = {
              ...file.snapshotRef,
              syncVersion: snapshot.syncVersion,
              vectorClock: base,
            };
            await write(snapshotUrl, snapshot);
          } else {
            addToSnapshot(tail.p.actionPayload.task);
          }
          await write(fileUrl, file);
          if (hydrated) {
            // An already covered base must not force a whole-dataset decision
            // just because the old adapter never persisted lastSeenClocks.
            await workB.addTask('Pending local change');
            await waitForStatePersistence(b.page);
          }
          await removeOnlyRecordedClocks(b.page);
          const clockless = await b.page.evaluate(() =>
            JSON.parse(localStorage.getItem('FILE_SYNC_VERSION_state')!),
          );
          expect(clockless.revs).toEqual(originalMetadata.revs);
          expect(clockless.seqCounters).toEqual(originalMetadata.seqCounters);
          await b.page.reload();
          await waitForAppReady(b.page);
          await workB.waitForTaskList();
          await syncB.triggerSync();
          expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
          await expect(b.page.locator('dialog-sync-conflict')).toBeHidden();
          for (const title of [
            'Original baseline',
            'Captured task template',
            'Tail after replacement',
            hydrated ? 'Pending local change' : 'Replacement baseline only',
          ]) {
            await expect(b.page.locator('task', { hasText: title })).toBeVisible();
          }
          await waitForStatePersistence(b.page);
          await b.page.reload();
          await waitForAppReady(b.page);
          await workB.waitForTaskList();
          await expect(
            b.page.locator('task', {
              hasText: hydrated ? 'Pending local change' : 'Replacement baseline only',
            }),
          ).toBeVisible();
        } finally {
          await closeContextsSafely(a.context, b.context);
        }
      });
    }
  }
  for (const split of [false, true]) {
    test(`pending backup restore still replaces the remote after a clockless upgrade (v${split ? 3 : 2})`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      expect(webdavServerUp).toBe(true);
      const folder = generateSyncFolderName(`upgrade-restore-${split}`);
      const headers = {
        Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
      };
      const remote = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
      const primary = `${remote}${split ? 'sync-ops.json' : 'sync-data.json'}`;
      await createSyncFolder(request, folder);
      const client = await setupSyncClient(browser, baseURL, [
        translationRegex('F.SYNC.D_SYNC_IMPORT_CONFLICT.FIRST_SYNC_USE_LOCAL_CONFIRM'),
      ]);
      try {
        const { page } = client;
        await page.addInitScript(() => {
          (
            window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
          ).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        await page.evaluate(() => {
          (
            window as unknown as { __SP_E2E_BLOCK_AUTO_SYNC: boolean }
          ).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        const work = new WorkViewPage(page);
        const sync = new SyncPage(page);
        await work.waitForTaskList();
        await work.addTask('Backup restored task');
        await sync.setupWebdavSync({
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
          isUseSplitSyncFiles: split,
        });
        await waitForSyncComplete(page, sync);
        const imex = new ImportPage(page);
        await imex.navigateToImportPage();
        const download = page.waitForEvent('download');
        await imex.exportBackupBtn.click();
        const backup = testInfo.outputPath('before-extra-task.json');
        await (await download).saveAs(backup);
        await page.goto('/');
        await work.waitForTaskList();
        await work.addTask('Removed by explicit restore');
        await sync.triggerSync();
        await waitForSyncComplete(page, sync);
        const encoded = await (await request.get(primary, { headers })).text();
        const end = encoded.indexOf('__') + 2;
        const file = JSON.parse(encoded.slice(end)) as FileData;
        file.snapshotBaseClock = { ...file.vectorClock };
        expect(
          (
            await request.put(primary, {
              headers,
              data: encoded.slice(0, end) + JSON.stringify(file),
            })
          ).ok(),
        ).toBe(true);
        // Record that baseline as applied before restoring an older local backup.
        await sync.triggerSync();
        await waitForSyncComplete(page, sync);
        const before = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('FILE_SYNC_VERSION_state')!),
        );
        await imex.navigateToImportPage();
        await imex.importBackupFile(backup);
        await removeOnlyRecordedClocks(page);
        const after = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('FILE_SYNC_VERSION_state')!),
        );
        expect(after.seqCounters).toEqual(before.seqCounters);
        expect(after.revs).toEqual(before.revs);
        await page.reload();
        await page.goto('/');
        await work.waitForTaskList();
        await sync.triggerSync();
        const importDecision = page.locator('dialog-sync-import-conflict');
        await expect(importDecision).toBeVisible();
        await importDecision
          .locator('button', {
            has: page.locator('mat-icon', { hasText: 'cloud_upload' }),
          })
          .click();
        await expect(importDecision).toBeHidden();
        expect(await waitForSyncComplete(page, sync)).toBe('success');
        await expect(
          page.locator('task', { hasText: 'Backup restored task' }),
        ).toBeVisible();
        await expect(
          page.locator('task', { hasText: 'Removed by explicit restore' }),
        ).toHaveCount(0);
        const uploadedText = await (await request.get(primary, { headers })).text();
        const uploaded = JSON.parse(
          uploadedText.slice(uploadedText.indexOf('__') + 2),
        ) as FileData;
        const snapshotText = split
          ? await (
              await request.get(
                `${remote}${uploaded.snapshotRef.file ?? 'sync-state.json'}`,
                { headers },
              )
            ).text()
          : uploadedText;
        expect(snapshotText).toContain('Backup restored task');
        expect(snapshotText).not.toContain('Removed by explicit restore');
      } finally {
        await closeContextsSafely(client.context);
      }
    });
  }
});
