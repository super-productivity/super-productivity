import type { Page } from '@playwright/test';
import { rows } from './reorder-crossing';

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

/**
 * Synced, non-rejected local op-log rows of one entity, reduced to the action
 * code and the top-level-or-nested payload keys they write. Values are never
 * returned, so nothing user-written can reach a log.
 */
export const getSyncedLocalRowsOf = async (
  page: Page,
  entityId: string,
): Promise<{ a: string; keys: string[] }[]> => {
  const keysOf = (value: unknown, out: Set<string>): Set<string> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out.add(k);
        keysOf(v, out);
      }
    }
    return out;
  };
  return (await rows(page))
    .filter(
      (row) =>
        row.source === 'local' &&
        !!row.syncedAt &&
        !row.rejectedAt &&
        (row.op.d === entityId || !!row.op.ds?.includes(entityId)),
    )
    .map((row) => ({ a: row.op.a, keys: [...keysOf(row.op.p, new Set())].sort() }));
};
