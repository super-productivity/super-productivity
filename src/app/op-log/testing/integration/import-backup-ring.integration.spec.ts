import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { IMPORT_BACKUP_RING_SIZE } from '../../persistence/import-backup-ring.util';

/**
 * The recovery-point ring against REAL IndexedDB, not the in-memory `OpLogTx`
 * fake the unit spec uses. The rotation deletes rows inside the same
 * transaction that writes the new one, so "the protected entry survives" is a
 * claim about committed storage — the unit spec can only show the policy picks
 * the right ids, never that the row is still readable afterwards.
 *
 * Guards the restore path: `BackupService.restoreImportBackupById` writes a
 * pre-restore capture into an already-full ring, and without `protectBackupId`
 * that capture evicts and physically deletes the snapshot being restored, so a
 * failure later in the import leaves the user nothing to retry.
 */
describe('import backup ring — integration (real IndexedDB)', () => {
  let store: OperationLogStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        {
          provide: StateSnapshotService,
          useValue: jasmine.createSpyObj('StateSnapshotService', [
            'getStateSnapshot',
            'getStateSnapshotForOperationLog',
          ]),
        },
      ],
    });
    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
  });

  it('keeps the snapshot being restored readable after the pre-restore capture rotates the ring', async () => {
    // The oldest entry is the one holding the user's pre-loss data.
    const oldest = await store.saveImportBackup(
      { marker: 'pre-loss' },
      { reason: 'REMOTE_IMPORT', taskCount: 1 },
    );
    for (let i = 0; i < IMPORT_BACKUP_RING_SIZE - 1; i++) {
      await store.saveImportBackup(
        { marker: `filler-${i}` },
        { reason: 'REMOTE_IMPORT', taskCount: 1 },
      );
    }

    // Restoring `oldest` captures the current state first, into a full ring.
    await store.saveImportBackup(
      { marker: 'pre-restore' },
      {
        reason: 'LOCAL_IMPORT',
        taskCount: 1,
        protectBackupId: oldest.backupId,
      },
    );

    const kept = await store.listImportBackups();
    expect(kept.length).toBe(IMPORT_BACKUP_RING_SIZE);
    expect(kept.map((e) => e.backupId)).toContain(oldest.backupId);

    // The row itself survived the delete, not just the metadata listing.
    const reloaded = await store.loadImportBackupById(oldest.backupId);
    expect(reloaded).not.toBeNull();
    expect((reloaded?.state as { marker: string }).marker).toBe('pre-loss');
  });

  it('still rotates the oldest entry out when nothing is protected', async () => {
    const oldest = await store.saveImportBackup(
      { marker: 'oldest' },
      { reason: 'LOCAL_IMPORT', taskCount: 1 },
    );
    for (let i = 0; i < IMPORT_BACKUP_RING_SIZE; i++) {
      await store.saveImportBackup(
        { marker: `later-${i}` },
        { reason: 'LOCAL_IMPORT', taskCount: 1 },
      );
    }

    expect((await store.listImportBackups()).length).toBe(IMPORT_BACKUP_RING_SIZE);
    expect(await store.loadImportBackupById(oldest.backupId)).toBeNull();
  });
});
