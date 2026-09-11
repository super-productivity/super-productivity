import {
  IMPORT_BACKUP_RING_SIZE,
  ImportBackupReason,
  listImportBackupsTx,
  loadImportBackupByIdTx,
  saveImportBackupTx,
} from './import-backup-ring.util';
import { OpLogTx } from './op-log-db-adapter';

/** In-memory stand-in for the `import_backup` object store. */
const createTx = (): OpLogTx & { rows: Map<string, unknown> } => {
  const rows = new Map<string, unknown>();
  const key = (store: string, id: string): string => `${store}::${id}`;
  return {
    rows,
    get: async <T>(store: string, id: string): Promise<T | undefined> =>
      rows.get(key(store, id)) as T | undefined,
    put: async (store: string, value: { id: string }): Promise<void> => {
      rows.set(key(store, value.id), value);
    },
    delete: async (store: string, id: string): Promise<void> => {
      rows.delete(key(store, id));
    },
  } as unknown as OpLogTx & { rows: Map<string, unknown> };
};

describe('import backup ring', () => {
  const save = (
    tx: OpLogTx,
    state: unknown,
    reason: ImportBackupReason,
    protectBackupId?: string,
  ): Promise<{ backupId: string }> =>
    saveImportBackupTx(tx, state, {
      reason,
      taskCount: 1,
      ...(protectBackupId ? { protectBackupId } : {}),
    });

  it('keeps at most IMPORT_BACKUP_RING_SIZE snapshots', async () => {
    const tx = createTx();
    for (let i = 0; i < IMPORT_BACKUP_RING_SIZE + 2; i++) {
      await save(tx, { i }, 'LOCAL_IMPORT');
    }
    expect((await listImportBackupsTx(tx)).length).toBe(IMPORT_BACKUP_RING_SIZE);
  });

  it('does not rotate out the entry currently being restored', async () => {
    const tx = createTx();
    // The oldest entry is the one holding the user's pre-loss data.
    const oldest = await save(tx, { pre: 'loss' }, 'REMOTE_IMPORT');
    for (let i = 0; i < IMPORT_BACKUP_RING_SIZE - 1; i++) {
      await save(tx, { i }, 'REMOTE_IMPORT');
    }
    expect(await loadImportBackupByIdTx(tx, oldest.backupId)).not.toBeNull();

    // Restoring it writes a pre-restore LOCAL_IMPORT capture into the same
    // full ring. Without the protection that capture evicts — and physically
    // deletes — the snapshot being restored, so a failure later in the import
    // leaves nothing to retry.
    await save(tx, { current: true }, 'LOCAL_IMPORT', oldest.backupId);

    const kept = await listImportBackupsTx(tx);
    expect(kept.map((e) => e.backupId)).toContain(oldest.backupId);
    expect(await loadImportBackupByIdTx(tx, oldest.backupId)).not.toBeNull();
    expect(kept.length).toBe(IMPORT_BACKUP_RING_SIZE);
  });

  it('still guards the newest pre-replacement capture from a plain restore', async () => {
    const tx = createTx();
    const remote = await save(tx, { remote: true }, 'REMOTE_IMPORT');
    for (let i = 0; i < IMPORT_BACKUP_RING_SIZE; i++) {
      await save(tx, { i }, 'LOCAL_IMPORT');
    }
    const kept = await listImportBackupsTx(tx);
    expect(kept.map((e) => e.backupId)).toContain(remote.backupId);
  });
});
