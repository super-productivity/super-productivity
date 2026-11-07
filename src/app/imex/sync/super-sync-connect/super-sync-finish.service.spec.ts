import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { selectAllTasks } from '../../../features/tasks/store/task.selectors';
import {
  SyncProviderManager,
  SyncStatusChangePayload,
} from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { DialogSyncFinishedComponent } from '../dialog-sync-finished/dialog-sync-finished.component';
import { SyncWrapperService } from '../sync-wrapper.service';
import { SuperSyncFinishService } from './super-sync-finish.service';

describe('SuperSyncFinishService', () => {
  let service: SuperSyncFinishService;
  let syncState$: BehaviorSubject<SyncStatusChangePayload>;
  let isConfirmed$: BehaviorSubject<boolean>;
  let matDialog: { open: jasmine.Spy; openDialogs: unknown[] };
  let providerId: SyncProviderId;
  let privateCfg: { isEncryptionEnabled?: boolean; encryptKey?: string } | null;

  const syncEnds = (): void => {
    syncState$.next('SYNCING');
    syncState$.next('IN_SYNC');
    flushMicrotasks();
  };

  beforeEach(() => {
    syncState$ = new BehaviorSubject<SyncStatusChangePayload>('UNKNOWN_OR_CHANGED');
    isConfirmed$ = new BehaviorSubject(true);
    matDialog = { open: jasmine.createSpy('open'), openDialogs: [] };
    providerId = SyncProviderId.SuperSync;
    privateCfg = { isEncryptionEnabled: true, encryptKey: 'pw' };
    const providerManager = {
      getActiveProvider: () => ({
        id: providerId,
        privateCfg: { load: () => Promise.resolve(privateCfg) },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SyncWrapperService,
          useValue: { syncState$, superSyncIsConfirmedInSync$: isConfirmed$ },
        },
        { provide: SyncProviderManager, useValue: providerManager },
        { provide: MatDialog, useValue: matDialog },
        provideMockStore({
          selectors: [{ selector: selectAllTasks, value: [{ id: 'a' }, { id: 'b' }] }],
        }),
      ],
    });
    service = TestBed.inject(SuperSyncFinishService);
  });

  it('shows the screen once with the task count after a clean sync', fakeAsync(() => {
    service.arm();
    syncEnds();
    expect(matDialog.open).toHaveBeenCalledOnceWith(DialogSyncFinishedComponent, {
      data: { taskCount: 2 },
    });

    syncEnds();
    expect(matDialog.open).toHaveBeenCalledTimes(1);
  }));

  it('ignores an "in sync" from before signing in', fakeAsync(() => {
    syncState$.next('IN_SYNC');
    service.arm();
    flushMicrotasks();
    expect(matDialog.open).not.toHaveBeenCalled();

    syncEnds();
    expect(matDialog.open).toHaveBeenCalledTimes(1);
  }));

  it('waits until the device is confirmed in sync', fakeAsync(() => {
    isConfirmed$.next(false);
    service.arm();
    syncEnds();
    expect(matDialog.open).not.toHaveBeenCalled();

    isConfirmed$.next(true);
    flushMicrotasks();
    expect(matDialog.open).toHaveBeenCalledTimes(1);
  }));

  it('waits while another dialog is open, then shows after the next sync', fakeAsync(() => {
    matDialog.openDialogs = [{}];
    service.arm();
    syncEnds();
    expect(matDialog.open).not.toHaveBeenCalled();

    matDialog.openDialogs = [];
    syncEnds();
    expect(matDialog.open).toHaveBeenCalledTimes(1);
  }));

  it('waits for the encryption password to be set', fakeAsync(() => {
    privateCfg = { isEncryptionEnabled: false };
    service.arm();
    syncEnds();
    expect(matDialog.open).not.toHaveBeenCalled();

    privateCfg = { isEncryptionEnabled: true, encryptKey: 'pw' };
    syncEnds();
    expect(matDialog.open).toHaveBeenCalledTimes(1);
  }));

  it('stays hidden for another provider and when not armed', fakeAsync(() => {
    syncEnds();
    expect(matDialog.open).not.toHaveBeenCalled();

    providerId = SyncProviderId.WebDAV;
    service.arm();
    syncEnds();
    expect(matDialog.open).not.toHaveBeenCalled();
  }));
});
