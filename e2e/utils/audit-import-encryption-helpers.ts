import { gunzipSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  parseSuperSyncRequestBody,
  routeSuperSyncOps,
  SUPERSYNC_BASE_URL,
  SUPERSYNC_SNAPSHOT_ROUTE,
} from './supersync-helpers';

/**
 * Helpers for the import / encryption sync E2E specs (audit 2026-11-03,
 * "Verify 5").
 *
 * `syncAndWait()` and `setupSuperSync()` silently answer the sync-import,
 * enter-password, enable-encryption and decrypt-error dialogs, so a test that
 * only checks the end state cannot tell whether one of them appeared. The
 * watcher below records every dialog that was ever rendered, so a test can
 * assert that a dialog NEVER appeared (or did appear) across such a helper call.
 */

/** Component selectors of the dialogs the import/encryption contract is about. */
export const DIALOG = {
  syncImportConflict: 'dialog-sync-import-conflict',
  enterPassword: 'dialog-enter-encryption-password',
  enableEncryption: 'dialog-enable-encryption',
  decryptError: 'dialog-handle-decrypt-error',
  importEncryptionWarning: 'dialog-import-encryption-warning',
} as const;

export type WatchedDialog = (typeof DIALOG)[keyof typeof DIALOG];

export interface DialogWatcher {
  /** Selectors that matched at least once since the watcher was installed. */
  seen: () => Promise<WatchedDialog[]>;
  /** Fails if any of the given dialogs was ever rendered. */
  expectNeverSeen: (dialogs: WatchedDialog[], context: string) => Promise<void>;
  /** Fails unless every given dialog was rendered at least once. */
  expectSeen: (dialogs: WatchedDialog[], context: string) => Promise<void>;
}

let watcherCounter = 0;

/**
 * Installs a MutationObserver that records whether each selector ever matched.
 * Install it BEFORE the action that might open the dialog. It is installed on
 * the current document and (via an init script) on every later navigation of
 * this page, so a reload inside the watched window does not lose it.
 */
export const watchDialogs = async (
  page: Page,
  dialogs: WatchedDialog[] = Object.values(DIALOG),
): Promise<DialogWatcher> => {
  watcherCounter += 1;
  const bindingName = `__e2eAuditDialogSeen${watcherCounter}_${Date.now()}`;
  const seen = new Set<WatchedDialog>();
  await page.exposeFunction(bindingName, (selector: WatchedDialog) => {
    seen.add(selector);
  });

  const install = ({ name, selectors }: { name: string; selectors: string[] }): void => {
    const win = window as unknown as Record<string, unknown>;
    const report = win[name] as (s: string) => void;
    // Also kept in the page, so a read does not depend on the binding call
    // having reached Node before the dialog closed again.
    const seenKey = `${name}_seen`;
    const seenInPage = (win[seenKey] as string[] | undefined) ?? [];
    win[seenKey] = seenInPage;
    const reported = new Set<string>();
    const check = (): void => {
      for (const selector of selectors) {
        if (!reported.has(selector) && document.querySelector(selector)) {
          reported.add(selector);
          seenInPage.push(selector);
          void report(selector);
        }
      }
    };
    const start = (): void => {
      check();
      new MutationObserver(check).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  };

  const args = { name: bindingName, selectors: dialogs };
  await page.addInitScript(install, args);
  await page.evaluate(install, args);

  const readSeen = async (): Promise<WatchedDialog[]> => {
    // A dialog still open now, or recorded in the page, counts even if its
    // binding call is still in flight.
    const inPage = await page
      .evaluate(
        ({ selectors, seenKey }) => [
          ...selectors.filter((s) => !!document.querySelector(s)),
          ...(((window as unknown as Record<string, unknown>)[seenKey] as
            | string[]
            | undefined) ?? []),
        ],
        { selectors: dialogs, seenKey: `${bindingName}_seen` },
      )
      .catch(() => [] as string[]);
    for (const selector of inPage) seen.add(selector as WatchedDialog);
    return [...seen];
  };

  return {
    seen: readSeen,
    expectNeverSeen: async (never, context) => {
      const all = await readSeen();
      expect(
        all.filter((d) => never.includes(d)),
        `${context}: these dialogs must never appear`,
      ).toEqual([]);
    },
    expectSeen: async (always, context) => {
      const all = await readSeen();
      expect(
        always.filter((d) => !all.includes(d)),
        `${context}: these dialogs must appear`,
      ).toEqual([]);
    },
  };
};

export interface ServerOperationSummary {
  id: string;
  clientId: string;
  opType: string;
  serverSeq: number;
}

/** Server-side op summaries for a user, newest first (test route, TEST_MODE). */
export const getServerOperations = async (
  userId: number,
  options: { opType?: string; limit?: number } = {},
): Promise<ServerOperationSummary[]> => {
  const params = new URLSearchParams({ limit: String(options.limit ?? 500) });
  if (options.opType) params.set('opType', options.opType);
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read server operations: ${response.status}`);
  }
  const body = (await response.json()) as { ops: ServerOperationSummary[] };
  return body.ops;
};

export interface RecordedUploadOp {
  id: string;
  opType: string;
  entityType: string;
  isPayloadEncrypted?: boolean;
}

/** Parses a (possibly gzipped) JSON request body from its raw buffer, or null. */
const readJsonBody = <T>(request: Request): T | null => {
  const buffer = request.postDataBuffer();
  if (!buffer || buffer.length === 0) return null;
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buffer) : buffer).toString('utf-8');
  return JSON.parse(text) as T;
};

export interface RecordedUploads {
  ops: RecordedUploadOp[];
  snapshots: { isPayloadEncrypted?: boolean }[];
  /** Uploads whose body could not be read; a test must require 0. */
  unreadableBodies: number;
}

/**
 * Records the envelopes of every POST /api/sync/ops and /api/sync/snapshot
 * this page sends. Bodies are parsed when the request is issued, whether or
 * not the server accepts it, so a plaintext upload the server rejects is still
 * recorded. Payloads are not kept (they may hold user content).
 *
 * Snapshots are read in a route handler: the `request` event does not carry
 * the (large, gzipped) snapshot body, a route sees the full buffer.
 */
export const recordOpsUploads = async (page: Page): Promise<RecordedUploads> => {
  const recorded: RecordedUploads = { ops: [], snapshots: [], unreadableBodies: 0 };
  await page.route(SUPERSYNC_SNAPSHOT_ROUTE, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      try {
        const body = readJsonBody<{ isPayloadEncrypted?: boolean }>(request);
        if (body) {
          recorded.snapshots.push({ isPayloadEncrypted: body.isPayloadEncrypted });
        } else {
          recorded.unreadableBodies += 1;
        }
      } catch {
        recorded.unreadableBodies += 1;
      }
    }
    await route.continue();
  });
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST') return;
    if (!new URL(request.url()).pathname.endsWith('/api/sync/ops')) return;
    let body: { ops?: RecordedUploadOp[] } | null = null;
    try {
      body = readJsonBody<{ ops?: RecordedUploadOp[] }>(request);
    } catch {
      body = null;
    }
    if (!body) {
      recorded.unreadableBodies += 1;
      return;
    }
    for (const op of body.ops ?? []) {
      recorded.ops.push({
        id: op.id,
        opType: op.opType,
        entityType: op.entityType,
        isPayloadEncrypted: op.isPayloadEncrypted,
      });
    }
  });
  return recorded;
};

/** Ids of every op in this page's local op log (`SUP_OPS`/`ops`). */
export const getLocalOpIds = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('ops')) return [];
      const entries = await new Promise<{ op: { id: string } }[]>((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const request = tx.objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries.map((entry) => entry.op.id);
    } finally {
      db.close();
    }
  });

export interface StoreTaskSummary {
  id: string;
  title: string;
  tagIds: string[];
}

/** Tasks whose title contains `titleSubstring`, read from the live NgRx store. */
export const getTasksFromStore = async (
  page: Page,
  titleSubstring: string,
): Promise<StoreTaskSummary[]> =>
  page.evaluate((name) => {
    type StoreLike = {
      subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
    };
    type TaskLike = { id: string; title: string; tagIds?: string[] };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: { tasks?: { entities?: Record<string, TaskLike | undefined> } } = {};
    store.subscribe((s) => (state = s as typeof state)).unsubscribe();
    return Object.values(state.tasks?.entities ?? {})
      .filter((t): t is TaskLike => !!t && t.title.includes(name))
      .map((t) => ({ id: t.id, title: t.title, tagIds: [...(t.tagIds ?? [])] }));
  }, titleSubstring);

/** Id of the tag with exactly this title in the live NgRx store, or null. */
export const getTagIdFromStore = async (
  page: Page,
  tagTitle: string,
): Promise<string | null> =>
  page.evaluate((title) => {
    type StoreLike = {
      subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
    };
    type TagLike = { id: string; title: string };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: { tag?: { entities?: Record<string, TagLike | undefined> } } = {};
    store.subscribe((s) => (state = s as typeof state)).unsubscribe();
    const tag = Object.values(state.tag?.entities ?? {}).find((t) => t?.title === title);
    return tag?.id ?? null;
  }, tagTitle);

export interface CapturedOpsUpload {
  url: string;
  authorization: string;
  body: { ops: RecordedUploadOp[]; clientId: string; lastKnownServerSeq?: number };
}

/**
 * Blocks every POST /api/sync/ops of this page with a 503 (the provider keeps
 * its ops pending) and resolves with the first blocked upload that carried ops.
 * The route stays installed; close the client or unroute it when done.
 */
export const captureAndBlockOpsUploads = async (
  page: Page,
): Promise<{ firstUpload: Promise<CapturedOpsUpload> }> => {
  let resolveFirst: (upload: CapturedOpsUpload) => void = () => undefined;
  const firstUpload = new Promise<CapturedOpsUpload>((resolve) => {
    resolveFirst = resolve;
  });
  await routeSuperSyncOps(page, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = parseSuperSyncRequestBody<CapturedOpsUpload['body']>(request);
    if (body.ops?.length) {
      resolveFirst({
        url: request.url(),
        authorization: (await request.allHeaders())['authorization'] ?? '',
        body,
      });
    }
    await route.fulfill({ status: 503, json: { error: 'held by test' } });
  });
  // Fail with a clear message instead of hanging until the test timeout.
  const timedFirstUpload = Promise.race([
    firstUpload,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('No ops upload was captured within 30s')), 30000),
    ),
  ]);
  timedFirstUpload.catch(() => undefined);
  return { firstUpload: timedFirstUpload };
};

/**
 * Sends a captured upload to the server from the test runner, WITHOUT its
 * `lastKnownServerSeq` (optional in SuperSyncUploadOpsRequestSchema). With the
 * cursor, the server's state-replacement fence rejects an upload whose cursor
 * is below a newer SYNC_IMPORT; without it the op is stored after the import,
 * which is the only way the server holds an op concurrent with an import that
 * other clients already accepted.
 */
export const replayOpsUploadWithoutCursor = async (
  upload: CapturedOpsUpload,
): Promise<{ results: { opId: string; accepted: boolean; error?: string }[] }> => {
  const body: Partial<CapturedOpsUpload['body']> = { ...upload.body };
  delete body.lastKnownServerSeq;
  delete (body as { requestId?: string }).requestId;
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', upload.authorization);
  const response = await fetch(upload.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Replayed upload failed: ${response.status}`);
  }
  return (await response.json()) as {
    results: { opId: string; accepted: boolean; error?: string }[];
  };
};

/**
 * Highest SuperSync `lastServerSeq` this page has persisted (localStorage keys
 * `super_sync_last_server_seq_*`), or null when none is stored.
 */
export const getLocalLastServerSeq = async (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    let max: number | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('super_sync_last_server_seq_')) continue;
      const value = Number.parseInt(localStorage.getItem(key) ?? '', 10);
      if (Number.isFinite(value)) max = max === null ? value : Math.max(max, value);
    }
    return max;
  });
