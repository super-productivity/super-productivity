import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7067
 *
 * An invalid `startTime` on a TaskRepeatCfg (e.g. from sync/import/migration)
 * causes `getDateTimeFromClockString()` to throw "Invalid clock string" at
 * runtime whenever a task list renders the repeat info chip.
 *
 * Reproduction steps (from the issue's first stack trace):
 *   1. A TaskRepeatCfg has startTime = "INVALID_CLOCK_STRING" in the store
 *      (arriving via sync or a legacy corrupt save).
 *   2. The tag-list component computes indicator chips for every task.
 *   3. `getTaskRepeatInfoText()` calls `getDateTimeFromClockString(startTime)`
 *      which throws: "Invalid clock string".
 *
 * Expected: The app should handle an invalid startTime gracefully (skip it or
 *           fall back to no-time display) without crashing.
 * Actual:   Error is thrown inside the computed signal, crashing the view.
 */
test('should not crash when a repeat config has an invalid startTime in the store (bug #7067)', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  // ── Phase 1: Create a task with a timed repeat config ─────────────────────

  await workViewPage.waitForTaskList();
  await workViewPage.addTask('RepeatBug7067');
  const task = taskPage.getTaskByText('RepeatBug7067').first();
  await expect(task).toBeVisible({ timeout: 10000 });

  await taskPage.openTaskDetail(task);
  await page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') })
    .click();

  const repeatDialog = page.locator('mat-dialog-container');
  await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

  // Set a valid startTime so the config has startTime + remindAt in the store
  await repeatDialog.locator('collapsible .collapsible-header').last().click();
  const startTimeField = repeatDialog.getByLabel(/Scheduled start time/i);
  await expect(startTimeField).toBeVisible({ timeout: 5000 });
  await startTimeField.fill('10:30');
  await startTimeField.blur();
  await page.waitForTimeout(300);

  const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  await page.keyboard.press('Escape');
  // Wait for the op to be flushed to IndexedDB before we try to read it
  await page.waitForTimeout(1500);

  // ── Phase 2: Corrupt the startTime ────────────────────────────────────────
  // Strategy A (dev mode): use ng.getComponent to dispatch directly to the
  //   in-memory NgRx store — no page reload needed.
  // Strategy B (production mode): ng.getComponent is stripped; instead we
  //   inject a corrupt op directly into IndexedDB and reload the page so the
  //   hydrator replays it.  The ops store accepts unencoded full-format ops
  //   alongside compact-encoded ones (isCompactOperation guard in store service).

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const devModeCorrupted = await page.evaluate((): boolean => {
    const ng = (window as any).ng;
    if (!ng?.getComponent) return false;

    for (const el of Array.from(document.querySelectorAll('*'))) {
      try {
        const comp = ng.getComponent(el) as any;
        if (!comp) continue;
        const store = comp._store ?? comp.store ?? comp.__store;
        if (!store?.dispatch) continue;

        let state: any = null;
        store
          .subscribe((s: any) => {
            state = s;
          })
          .unsubscribe();

        if (!state?.taskRepeatCfg?.ids?.length) continue;

        // Find the config we just created (startTime === '10:30')
        const cfgId = state.taskRepeatCfg.ids.find(
          (id: string) => state.taskRepeatCfg.entities[id]?.startTime === '10:30',
        );
        if (!cfgId) continue;

        store.dispatch({
          type: '[TaskRepeatCfg] Update TaskRepeatCfg',
          taskRepeatCfg: { id: cfgId, changes: { startTime: 'INVALID_CLOCK_STRING' } },
        });
        return true;
      } catch {
        // ignore
      }
    }
    return false;
  });

  if (devModeCorrupted) {
    // Dev mode: store already has the corrupt value; just navigate within the SPA.
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForTimeout(2000);
  } else {
    // Production mode: write a corrupt op to IndexedDB and reload so the
    // hydrator replays it.
    const idbCorrupted = await page.evaluate(async (): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('SUP_OPS', 5);
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;

          // Read all ops to find the TASK_REPEAT_CFG entry with startTime '10:30'
          const readTx = db.transaction(['ops'], 'readonly');
          const opsStore = readTx.objectStore('ops');
          const allOpsReq = opsStore.getAll();

          allOpsReq.onerror = () => resolve(false);
          allOpsReq.onsuccess = () => {
            const entries: any[] = allOpsReq.result;

            // Find the most recent TASK_REPEAT_CFG op
            let cfgId: string | null = null;
            let clientId: string | null = null;
            let vectorClock: Record<string, number> = {};
            let schemaVersion = 2;

            for (let i = entries.length - 1; i >= 0; i--) {
              const entry = entries[i];
              const op = entry.op;
              if (!op) continue;

              // Handle both compact format (short keys) and full format
              const entityType = op.e ?? op.entityType;
              if (entityType !== 'TASK_REPEAT_CFG') continue;

              // Compact: op.d = entityId; full: op.entityId
              cfgId = op.d ?? op.entityId ?? null;
              clientId = op.c ?? op.clientId ?? null;
              vectorClock = op.v ?? op.vectorClock ?? {};
              schemaVersion = op.s ?? op.schemaVersion ?? 2;
              break;
            }

            if (!cfgId) {
              resolve(false);
              return;
            }

            // Write a new full-format op (the store decodes compact ops but
            // passes full ops straight through — see isCompactOperation guard).
            const writeTx = db.transaction(['ops'], 'readwrite');
            const writeStore = writeTx.objectStore('ops');

            const corruptEntry = {
              // seq omitted → IndexedDB auto-increments to max+1
              op: {
                id: crypto.randomUUID(),
                actionType: '[TaskRepeatCfg] Update TaskRepeatCfg',
                opType: 'UPD',
                entityType: 'TASK_REPEAT_CFG',
                entityId: cfgId,
                payload: {
                  actionPayload: {
                    taskRepeatCfg: {
                      id: cfgId,
                      changes: { startTime: 'INVALID_CLOCK_STRING' },
                    },
                  },
                  entityChanges: [],
                },
                clientId: clientId ?? 'e2e-test-client',
                vectorClock,
                timestamp: Date.now(),
                schemaVersion,
              },
              appliedAt: Date.now(),
              source: 'local' as const,
            };

            const addReq = writeStore.add(corruptEntry);
            addReq.onerror = () => resolve(false);
            addReq.onsuccess = () => resolve(true);
          };
        };
      });
    });

    expect(idbCorrupted).toBe(true); // guard: verify IDB injection worked

    // Reload so the hydrator replays the corrupt op, then navigate to TODAY tag
    await page.reload({ waitUntil: 'networkidle' });
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForTimeout(2000);
  }

  // ── Phase 3: Verify no "Invalid clock string" crash ───────────────────────
  const clockErrors = pageErrors.filter((e) => e.includes('Invalid clock string'));
  expect(clockErrors).toHaveLength(0);
});
