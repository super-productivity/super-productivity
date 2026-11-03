import type { Page } from '@playwright/test';
import { SUPERSYNC_BASE_URL } from './supersync-helpers';

/**
 * Helpers for the sync E2E audit (2026-11-03), theme "error paths": tests that
 * must prove they reached the error/recovery path they claim.
 *
 * Nothing here logs task titles or other user content: callers pass a needle
 * and get booleans or counts back.
 */

interface DomRecord {
  matched: boolean;
  texts: string[];
}

type DomRecorderWindow = Window & {
  __e2eAuditDomRecords?: Record<string, DomRecord>;
};

/**
 * Records whether `selector` EVER matched in the page from now on, and the
 * distinct text contents of its matches. Use it for transient UI that a later
 * check could miss (auto-dismissed snacks, a short error state) and for "must
 * never appear" checks. Does not survive a reload; install it again after one.
 */
export const installDomRecorder = async (
  page: Page,
  key: string,
  selector: string,
): Promise<void> => {
  await page.evaluate(
    ({ recordKey, recordSelector }) => {
      const w = window as DomRecorderWindow;
      const records = (w.__e2eAuditDomRecords ??= {});
      const record: DomRecord = { matched: false, texts: [] };
      records[recordKey] = record;
      const check = (): void => {
        for (const el of Array.from(document.querySelectorAll(recordSelector))) {
          record.matched = true;
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (text && !record.texts.includes(text)) {
            record.texts.push(text);
          }
        }
      };
      check();
      new MutationObserver(check).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    },
    { recordKey: key, recordSelector: selector },
  );
};

/** What a recorder installed with `installDomRecorder` saw so far. */
export const readDomRecord = async (page: Page, key: string): Promise<DomRecord> =>
  page.evaluate((recordKey) => {
    const record = (window as DomRecorderWindow).__e2eAuditDomRecords?.[recordKey];
    if (!record) {
      throw new Error(`DOM recorder "${recordKey}" was not installed on this page`);
    }
    return { matched: record.matched, texts: [...record.texts] };
  }, key);

/**
 * Header sync button in its error state, as plain CSS for `installDomRecorder`
 * (current build only; SuperSyncPage's selector also matches released clients
 * through Playwright's non-CSS `:has-text`).
 */
export const SYNC_ERROR_ICON_SELECTOR =
  '.sync-btn mat-icon[data-mat-icon-name="sync_error"]';
/** Any custom snack (its text is the translated message). */
export const SNACK_SELECTOR = 'snack-custom';
/** An ERROR-type custom snack. */
export const ERROR_SNACK_SELECTOR = 'snack-custom .wrapper.error';

export interface LocalOpEntry {
  opType: string;
  entityType: string;
  entityId: string | undefined;
  source: string | undefined;
  isSynced: boolean;
  isRejected: boolean;
  /** True when the op's payload contains `payloadNeedle` (false without one). */
  payloadMatches: boolean;
}

/**
 * Every entry of this client's local op log (`SUP_OPS`/`ops`), stripped to
 * metadata. `payloadNeedle` (e.g. a unique task title) marks the entries whose
 * payload contains it, without returning the payload. Call it only after the
 * app has booted.
 */
export const readLocalOpEntries = async (
  page: Page,
  payloadNeedle?: string,
): Promise<LocalOpEntry[]> =>
  page.evaluate(async (needle) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('ops')) {
        return [];
      }
      type CompactEntry = {
        op: {
          o?: string;
          e?: string;
          d?: string;
          p?: unknown;
          opType?: string;
          entityType?: string;
          entityId?: string;
          payload?: unknown;
        };
        source?: string;
        syncedAt?: number;
        rejectedAt?: number;
      };
      const entries = await new Promise<CompactEntry[]>((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const request = tx.objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries.map((entry) => {
        const payload = entry.op.p ?? entry.op.payload;
        return {
          opType: entry.op.o ?? entry.op.opType ?? '',
          entityType: entry.op.e ?? entry.op.entityType ?? '',
          entityId: entry.op.d ?? entry.op.entityId,
          source: entry.source,
          isSynced: entry.syncedAt !== undefined,
          isRejected: entry.rejectedAt !== undefined,
          payloadMatches:
            !!needle && payload !== undefined && JSON.stringify(payload).includes(needle),
        };
      });
    } finally {
      db.close();
    }
  }, payloadNeedle);

export interface TaskSummary {
  id: string;
  title: string;
  isDone: boolean;
  parentId: string | undefined;
  subTaskIds: string[];
  tagIds: string[];
  projectId: string | undefined;
}

export interface StoreSummary {
  tasks: TaskSummary[];
  /** `tag.ids` */
  tagIds: string[];
  tags: { id: string; title: string }[];
  projects: { id: string; title: string }[];
}

/** Live NgRx task/tag/project state, reduced to ids, titles and references. */
export const getStoreSummary = async (page: Page): Promise<StoreSummary> =>
  page.evaluate(() => {
    type EntityState<T> = { ids?: string[]; entities?: Record<string, T | undefined> };
    type TaskLike = {
      id: string;
      title: string;
      isDone?: boolean;
      parentId?: string;
      subTaskIds?: string[];
      tagIds?: string[];
      projectId?: string;
    };
    type Root = {
      tasks?: EntityState<TaskLike>;
      tag?: EntityState<{ id: string; title: string }>;
      projects?: EntityState<{ id: string; title: string }>;
    };
    type StoreLike = {
      subscribe: (next: (state: Root) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let root: Root | undefined;
    // The NgRx store emits the current state synchronously on subscribe.
    store.subscribe((state) => (root = state)).unsubscribe();
    if (!root) {
      throw new Error('store did not emit synchronously');
    }
    const values = <T>(slice: EntityState<T> | undefined): T[] =>
      Object.values(slice?.entities ?? {}).filter((v): v is T => !!v);
    return {
      tasks: values(root.tasks).map((t) => ({
        id: t.id,
        title: t.title,
        isDone: !!t.isDone,
        parentId: t.parentId,
        subTaskIds: [...(t.subTaskIds ?? [])],
        tagIds: [...(t.tagIds ?? [])],
        projectId: t.projectId,
      })),
      tagIds: [...(root.tag?.ids ?? [])],
      tags: values(root.tag).map((t) => ({ id: t.id, title: t.title })),
      projects: values(root.projects).map((p) => ({ id: p.id, title: p.title })),
    };
  });

/** `HydrationStateService.isInSyncWindow()` of the page, right now. */
export const isPageInSyncWindow = async (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const hydrationState = (
      window as unknown as {
        __e2eTestHelpers?: { hydrationState?: { isInSyncWindow: () => boolean } };
      }
    ).__e2eTestHelpers?.hydrationState;
    if (!hydrationState) {
      throw new Error('__e2eTestHelpers.hydrationState missing');
    }
    return hydrationState.isInSyncWindow();
  });

/** Number of ops of `opType` the SuperSync server stores for the user (≤ 100). */
export const countServerOpsOfType = async (
  userId: number,
  opType: string,
): Promise<number> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?opType=${opType}&limit=100`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read server ops: ${response.status}`);
  }
  const body = (await response.json()) as { ops: unknown[] };
  return body.ops.length;
};
