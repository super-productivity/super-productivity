import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { ConflictUiPort } from '@sp/sync-core';
import { of } from 'rxjs';
import { UserInputWaitStateService } from '../../imex/sync/user-input-wait-state.service';
import {
  DialogSyncImportConflictComponent,
  SyncImportConflictData,
  SyncImportConflictResolution,
} from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';

describe('SyncImportConflictDialogService', () => {
  let service: SyncImportConflictDialogService;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let userInputWaitStateSpy: jasmine.SpyObj<UserInputWaitStateService>;
  let stopWaitingSpy: jasmine.Spy;

  beforeEach(() => {
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    matDialogSpy.open.and.returnValue(createDialogRef('USE_LOCAL'));

    stopWaitingSpy = jasmine.createSpy('stopWaiting');
    userInputWaitStateSpy = jasmine.createSpyObj('UserInputWaitStateService', [
      'startWaiting',
    ]);
    userInputWaitStateSpy.startWaiting.and.returnValue(stopWaitingSpy);

    TestBed.configureTestingModule({
      providers: [
        SyncImportConflictDialogService,
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: UserInputWaitStateService, useValue: userInputWaitStateSpy },
      ],
    });

    service = TestBed.inject(SyncImportConflictDialogService);
  });

  it('keeps the existing sync-import dialog data API', async () => {
    const data: SyncImportConflictData = {
      filteredOpCount: 2,
      localImportTimestamp: 123,
      syncImportReason: 'BACKUP_RESTORE',
      scenario: 'LOCAL_IMPORT_FILTERS_REMOTE',
    };

    await expectAsync(service.showConflictDialog(data)).toBeResolvedTo('USE_LOCAL');

    expect(matDialogSpy.open).toHaveBeenCalledWith(DialogSyncImportConflictComponent, {
      data,
      disableClose: true,
      restoreFocus: true,
    });
    expect(userInputWaitStateSpy.startWaiting).toHaveBeenCalledWith(
      'sync-import-conflict',
    );
    expect(stopWaitingSpy).toHaveBeenCalledOnceWith();
  });

  it('adapts the generic ConflictUiPort request shape', async () => {
    const port: ConflictUiPort<SyncImportConflictResolution> = service;

    await expectAsync(
      port.showConflictDialog({
        conflictType: 'sync-import',
        scenario: 'INCOMING_IMPORT',
        reason: 'SERVER_MIGRATION',
        counts: { filteredOpCount: 3 },
        timestamps: { localImportTimestamp: 456 },
      }),
    ).toBeResolvedTo('USE_LOCAL');

    expect(matDialogSpy.open).toHaveBeenCalledWith(DialogSyncImportConflictComponent, {
      data: {
        filteredOpCount: 3,
        localImportTimestamp: 456,
        syncImportReason: 'SERVER_MIGRATION',
        scenario: 'INCOMING_IMPORT',
      },
      disableClose: true,
      restoreFocus: true,
    });
  });

  it('stops waiting when the dialog closes without a selected resolution', async () => {
    matDialogSpy.open.and.returnValue(createDialogRef(undefined));

    await expectAsync(
      service.showConflictDialog({
        filteredOpCount: 1,
        localImportTimestamp: 789,
        scenario: 'INCOMING_IMPORT',
      }),
    ).toBeResolvedTo('CANCEL');

    expect(stopWaitingSpy).toHaveBeenCalledOnceWith();
  });
});

const createDialogRef = (
  result: SyncImportConflictResolution | undefined,
): MatDialogRef<DialogSyncImportConflictComponent> =>
  ({
    afterClosed: () => of(result),
  }) as unknown as MatDialogRef<DialogSyncImportConflictComponent>;
