import { expect, test } from '../../fixtures/test.fixture';

// Regression test for issue #7487 — "Cannot read properties of undefined (reading
// 'entities')" thrown from task-archive.service.ts:129 on the daily-summary route
// (the page reached by clicking "Finish Day").
//
// Before the fix, SyncHydrationService persisted downloaded archive blobs after
// only an `as ArchiveModel` cast. A malformed remote snapshot — e.g. one missing
// the `task` field — sat on disk and crashed every later reader of
// `archive.task.entities`. After the fix, ArchiveDbAdapter normalizes malformed
// shapes at the read boundary so consumers always see a well-formed `task`.
//
// This test seeds IndexedDB with the exact malformed shape from the bug, then
// exercises the user's reported flow (load app → daily summary) and asserts the
// crash signature never appears.

const ISSUE_PATTERN =
  /Cannot read properties of (undefined|null) \(reading '(entities|ids)'\)/;

test.describe('issue #7487 — corrupt archive blob does not crash daily summary', () => {
  test('survives missing task field in archive_young', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Write a malformed archive_young entry directly to SUP_OPS. The schema is
    // already in place because the app booted in the line above.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('SUP_OPS');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('archive_young')) {
            db.close();
            reject(new Error('archive_young store not present'));
            return;
          }
          const tx = db.transaction('archive_young', 'readwrite');
          tx.objectStore('archive_young').put({
            id: 'current',
            data: {
              // task field intentionally missing — the variant the user reported
              timeTracking: { project: {}, tag: {} },
              lastTimeTrackingFlush: 0,
            },
            lastModified: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    });

    // Listen for the bug's signature on both uncaught throws and console errors.
    // task-archive.service.ts surfaces this via both: the underlying TypeError is
    // caught by WorklogService and re-logged through Log.err (console.error),
    // and there's also an "Uncaught (in promise)" path for the same exception.
    const captured: string[] = [];
    page.on('pageerror', (err) => captured.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') captured.push(msg.text());
    });

    // Reload so the next archive read sees the corrupt blob, then walk the
    // user-reported path: app boot → daily summary.
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.goto('/#/tag/TODAY/daily-summary');

    // .done-headline is rendered on every daily-summary path, including the
    // empty-archive case. Its visibility proves the page actually rendered
    // rather than crashed mid-init.
    await expect(page.locator('.done-headline')).toBeVisible({ timeout: 10000 });

    const matches = captured.filter((msg) => ISSUE_PATTERN.test(msg));
    expect(
      matches,
      `Found issue #7487 crash signature in ${matches.length} message(s):\n${matches.join('\n---\n')}`,
    ).toEqual([]);
  });
});
