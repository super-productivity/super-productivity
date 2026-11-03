import type { Page } from '@playwright/test';

/**
 * Helpers for pinning the single correct conflict winner in sync E2E specs
 * (sync E2E audit 2026-11-03, "Verify 2 (winner / reorder)").
 *
 * They read the NgRx store directly, so a check sees what the app holds, not
 * what one view happens to render. Callers must not log the returned titles
 * beyond the synthetic fixture names their own test created.
 */

interface TaskLike {
  id: string;
  title: string;
}
interface StoreState {
  tasks: { ids: string[]; entities: Record<string, TaskLike | undefined> };
}

/** All task titles in the live store (archived tasks excluded), sorted. */
export const getStoreTaskTitles = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    let state: StoreState | undefined;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (s: StoreState) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    if (!state) throw new Error('Store state unavailable');
    return Object.values(state.tasks.entities)
      .filter((t): t is TaskLike => !!t)
      .map((t) => t.title)
      .sort();
  });

/** Store titles that contain `fragment`, sorted. */
export const getStoreTaskTitlesContaining = async (
  page: Page,
  fragment: string,
): Promise<string[]> =>
  (await getStoreTaskTitles(page)).filter((title) => title.includes(fragment));

interface OpLogRow {
  source: 'local' | 'remote';
  syncedAt?: number;
  rejectedAt?: number;
  op: { a: string; e: string; d?: string; ds?: string[]; p: unknown };
}

/**
 * Synced, non-rejected local op-log rows of one entity, reduced to the action
 * code and the top-level-or-nested payload keys they write. Values are never
 * returned, so nothing user-written can reach a log.
 */
export const getSyncedLocalRowsOf = (
  page: Page,
  entityId: string,
): Promise<{ a: string; keys: string[] }[]> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const rows = await new Promise<OpLogRow[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result as OpLogRow[]);
        r.onerror = () => reject(r.error);
      });
      const keysOf = (value: unknown, out: Set<string>): Set<string> => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out.add(k);
            keysOf(v, out);
          }
        }
        return out;
      };
      return rows
        .filter(
          (row) =>
            row.source === 'local' &&
            !!row.syncedAt &&
            !row.rejectedAt &&
            (row.op.d === id || !!row.op.ds?.includes(id)),
        )
        .map((row) => ({ a: row.op.a, keys: [...keysOf(row.op.p, new Set())].sort() }));
    } finally {
      db.close();
    }
  }, entityId);
