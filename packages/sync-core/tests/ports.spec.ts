import { describe, expect, it, vi } from 'vitest';
import type { ConflictUiPort, SyncConfigPort, SyncConfigSnapshot } from '../src';

describe('sync-core ports', () => {
  it('keeps sync config provider IDs as host-owned strings', async () => {
    type ProviderId = 'super-sync' | 'file-sync';
    const config: SyncConfigSnapshot<ProviderId> = {
      isEnabled: true,
      syncProvider: 'super-sync',
      isEncryptionEnabled: true,
      isCompressionEnabled: false,
      isManualSyncOnly: false,
      syncInterval: 5,
    };
    const port: SyncConfigPort<ProviderId> = {
      getSyncConfig: vi.fn().mockResolvedValue(config),
    };

    await expect(port.getSyncConfig()).resolves.toBe(config);
    expect(port.getSyncConfig).toHaveBeenCalledOnce();
  });

  it('keeps conflict UI reasons and resolutions host-owned strings', async () => {
    type Resolution = 'USE_LOCAL' | 'USE_REMOTE' | 'CANCEL';
    const notify = vi.fn();
    const port: ConflictUiPort<Resolution> = {
      showConflictDialog: vi.fn().mockResolvedValue('USE_LOCAL'),
      notify,
    };

    await expect(
      port.showConflictDialog({
        conflictType: 'sync-import',
        scenario: 'LOCAL_IMPORT_FILTERS_REMOTE',
        reason: 'BACKUP_RESTORE',
        counts: { filteredOpCount: 3 },
        timestamps: { localImportTimestamp: 123 },
        meta: { providerId: 'super-sync' },
      }),
    ).resolves.toBe('USE_LOCAL');

    port.notify?.({
      severity: 'warning',
      message: 'sync-conflict',
      reason: 'BACKUP_RESTORE',
      meta: { filteredOps: 3 },
    });

    expect(port.showConflictDialog).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      severity: 'warning',
      message: 'sync-conflict',
      reason: 'BACKUP_RESTORE',
      meta: { filteredOps: 3 },
    });
  });
});
