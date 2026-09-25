import { TestBed } from '@angular/core/testing';
import { BackupSourcesService } from './backup-sources.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { LocalBackupService } from './local-backup.service';
import { LocalDraftService } from '../../core/draft/local-draft.service';
import { T } from '../../t.const';

describe('BackupSourcesService', () => {
  let service: BackupSourcesService;
  let backupService: jasmine.SpyObj<BackupService>;
  let localBackupService: jasmine.SpyObj<LocalBackupService>;
  let localDraftService: jasmine.SpyObj<LocalDraftService>;

  const blobWithTasks = (n: number): string =>
    JSON.stringify({
      task: { ids: Array.from({ length: n }, (_, i) => `t${i}`), entities: {} },
    });

  beforeEach(() => {
    backupService = jasmine.createSpyObj('BackupService', [
      'listImportBackups',
      'restoreImportBackupById',
    ]);
    backupService.listImportBackups.and.resolveTo([]);
    localBackupService = jasmine.createSpyObj('LocalBackupService', [
      'listMobileBackupSlots',
      'restoreBackupStr',
      'loadBackupElectron',
      'getLastBackupTime',
    ]);
    localBackupService.listMobileBackupSlots.and.resolveTo([]);
    localBackupService.getLastBackupTime.and.returnValue(500);
    localDraftService = jasmine.createSpyObj('LocalDraftService', ['deleteAllDrafts']);

    TestBed.configureTestingModule({
      providers: [
        BackupSourcesService,
        { provide: BackupService, useValue: backupService },
        { provide: LocalBackupService, useValue: localBackupService },
        { provide: LocalDraftService, useValue: localDraftService },
      ],
    });
    service = TestBed.inject(BackupSourcesService);
  });

  it('lists recovery points with reason label and known task count, newest first', async () => {
    backupService.listImportBackups.and.resolveTo([
      { backupId: 'b2', savedAt: 200, reason: 'REMOTE_IMPORT', taskCount: 7 },
      { backupId: 'b1', savedAt: 100, reason: 'LOCAL_IMPORT', taskCount: 3 },
    ]);

    const { entries: list } = await service.listBackups();

    expect(list.map((e) => e.ref)).toEqual(['b2', 'b1']);
    expect(list[0]).toEqual(
      jasmine.objectContaining({
        kind: 'RECOVERY_POINT',
        label: T.GCF.AUTO_BACKUPS.D_LIST.REASON_REMOTE_IMPORT,
        createdAt: 200,
        taskCount: 7,
      }),
    );
  });

  it('sorts mobile slots between recovery points by date and puts undated last', async () => {
    backupService.listImportBackups.and.resolveTo([
      { backupId: 'b1', savedAt: 100, reason: 'LOCAL_IMPORT', taskCount: 3 },
      { backupId: 'b9', savedAt: 900, reason: 'LOCAL_IMPORT', taskCount: 3 },
    ]);
    localBackupService.listMobileBackupSlots.and.resolveTo([
      { slot: 'latest', data: blobWithTasks(2) },
      { slot: 'previous', data: blobWithTasks(1) },
    ]);

    const { entries: list } = await service.listBackups();

    expect(list.map((e) => e.id)).toEqual([
      'RECOVERY_POINT:b9',
      'MOBILE_SLOT:latest',
      'RECOVERY_POINT:b1',
      'MOBILE_SLOT:previous',
    ]);
    // slot counts are resolved lazily, not while listing
    expect(list[1].taskCount).toBeNull();
    expect(list[3].createdAt).toBeNull();
  });

  it('resolves a mobile slot task count lazily from the blob read at list time', async () => {
    localBackupService.listMobileBackupSlots.and.resolveTo([
      { slot: 'latest', data: blobWithTasks(4) },
    ]);
    const {
      entries: [entry],
    } = await service.listBackups();

    expect(await service.loadTaskCount(entry)).toBe(4);
  });

  it('returns the known count without loading anything', async () => {
    const count = await service.loadTaskCount({
      id: 'RECOVERY_POINT:b1',
      kind: 'RECOVERY_POINT',
      ref: 'b1',
      label: '',
      createdAt: 1,
      taskCount: 12,
    });

    expect(count).toBe(12);
    expect(localBackupService.loadBackupElectron).not.toHaveBeenCalled();
  });

  it('restores a recovery point through the backup service', async () => {
    backupService.restoreImportBackupById.and.resolveTo(true);

    const ok = await service.restore({
      id: 'RECOVERY_POINT:b1',
      kind: 'RECOVERY_POINT',
      ref: 'b1',
      label: '',
      createdAt: 1,
      taskCount: 1,
    });

    expect(ok).toBeTrue();
    expect(backupService.restoreImportBackupById).toHaveBeenCalledOnceWith('b1');
    expect(localBackupService.restoreBackupStr).not.toHaveBeenCalled();
    expect(localDraftService.deleteAllDrafts).toHaveBeenCalledTimes(1);
  });

  it('keeps drafts when the recovery point has rotated out', async () => {
    backupService.restoreImportBackupById.and.resolveTo(false);

    const ok = await service.restore({
      id: 'RECOVERY_POINT:gone',
      kind: 'RECOVERY_POINT',
      ref: 'gone',
      label: '',
      createdAt: 1,
      taskCount: 1,
    });

    expect(ok).toBeFalse();
    expect(localDraftService.deleteAllDrafts).not.toHaveBeenCalled();
  });

  it('still lists the recovery ring when another source fails', async () => {
    backupService.listImportBackups.and.resolveTo([
      { backupId: 'b1', savedAt: 100, reason: 'REMOTE_IMPORT', taskCount: 3 },
    ]);
    localBackupService.listMobileBackupSlots.and.rejectWith(new Error('db closed'));

    const { entries: list } = await service.listBackups();

    expect(list.map((e) => e.id)).toEqual(['RECOVERY_POINT:b1']);
  });

  it('restores a mobile slot from its blob', async () => {
    localBackupService.listMobileBackupSlots.and.resolveTo([
      { slot: 'previous', data: blobWithTasks(1) },
    ]);
    localBackupService.restoreBackupStr.and.resolveTo(true);
    const {
      entries: [entry],
    } = await service.listBackups();

    expect(await service.restore(entry)).toBeTrue();
    expect(localBackupService.restoreBackupStr).toHaveBeenCalledOnceWith(
      blobWithTasks(1),
    );
  });

  it('fails a restore whose blob is gone instead of importing nothing', async () => {
    const ok = await service.restore({
      id: 'MOBILE_SLOT:latest',
      kind: 'MOBILE_SLOT',
      ref: 'latest',
      label: '',
      createdAt: null,
      taskCount: null,
    });

    expect(ok).toBeFalse();
    expect(localBackupService.restoreBackupStr).not.toHaveBeenCalled();
  });
});
