import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogBackupsListComponent } from './dialog-backups-list.component';
import { BackupListEntry, BackupSourcesService } from '../backup-sources.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';

describe('DialogBackupsListComponent', () => {
  let fixture: ComponentFixture<DialogBackupsListComponent>;
  let component: DialogBackupsListComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogBackupsListComponent>>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let sources: jasmine.SpyObj<BackupSourcesService>;
  let snack: jasmine.SpyObj<SnackService>;

  const ringEntry: BackupListEntry = {
    id: 'RECOVERY_POINT:b1',
    kind: 'RECOVERY_POINT',
    ref: 'b1',
    label: T.GCF.AUTO_BACKUPS.D_LIST.REASON_REMOTE_IMPORT,
    createdAt: 1000,
    taskCount: 5,
  };
  const fileEntry: BackupListEntry = {
    id: 'BACKUP_FILE:/x.json',
    kind: 'BACKUP_FILE',
    ref: '/x.json',
    label: T.GCF.AUTO_BACKUPS.D_LIST.KIND_FILE,
    name: 'x.json',
    createdAt: 500,
    taskCount: null,
  };

  const flush = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    sources = jasmine.createSpyObj('BackupSourcesService', [
      'listBackups',
      'loadTaskCount',
      'restore',
    ]);
    sources.listBackups.and.resolveTo({
      entries: [ringEntry, fileEntry],
      failedSources: [],
    });
    sources.loadTaskCount.and.resolveTo(2);
    sources.restore.and.resolveTo(true);
    snack = jasmine.createSpyObj('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [DialogBackupsListComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: matDialog },
        { provide: SnackService, useValue: snack },
      ],
    })
      .overrideComponent(DialogBackupsListComponent, {
        set: { providers: [{ provide: BackupSourcesService, useValue: sources }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DialogBackupsListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();
  });

  it('lists every backup as a button row and keeps restore disabled until one is selected', () => {
    expect(component.entries().length).toBe(2);
    expect(component.isLoading()).toBeFalse();
    expect(component.isPartial()).toBeFalse();
    const rows: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button.backup');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('aria-pressed')).toBe('false');
    const restoreBtn: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[mat-dialog-actions] button[mat-flat-button]',
    );
    expect(restoreBtn.disabled).toBeTrue();
  });

  it('marks the selected row pressed', async () => {
    await component.select(ringEntry);
    await flush();
    const row: HTMLButtonElement = fixture.nativeElement.querySelector('button.backup');
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the available backups with a warning when one source failed', async () => {
    sources.listBackups.and.resolveTo({
      entries: [fileEntry],
      failedSources: ['RECOVERY_POINT'],
    });
    fixture = TestBed.createComponent(DialogBackupsListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();

    expect(component.entries().length).toBe(1);
    expect(component.isPartial()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.querySelector('.callout--warning')).not.toBeNull();
  });

  it('shows the loading error when every source failed', async () => {
    sources.listBackups.and.resolveTo({
      entries: [],
      failedSources: ['RECOVERY_POINT', 'MOBILE_SLOT'],
    });
    fixture = TestBed.createComponent(DialogBackupsListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();

    expect(component.error()).toBe(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_LOADING);
  });

  it('resolves the task count lazily on select and tolerates a failed count', async () => {
    await component.select(fileEntry);
    expect(sources.loadTaskCount).toHaveBeenCalledOnceWith(fileEntry);
    expect(component.selected()?.taskCount).toBe(2);

    sources.loadTaskCount.and.rejectWith(new Error('gone'));
    await component.select(ringEntry);
    await component.select({ ...fileEntry, taskCount: null });
    expect(component.selected()?.taskCount).toBeNull();
  });

  it('restores the selected backup after confirmation and closes', async () => {
    await component.select(ringEntry);
    await component.restore();

    expect(matDialog.open).toHaveBeenCalled();
    expect(sources.restore).toHaveBeenCalledOnceWith(ringEntry);
    expect(snack.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.GCF.AUTO_BACKUPS.S_RESTORE_SUCCESS }),
    );
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('does nothing when the confirmation is declined', async () => {
    matDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    await component.select(ringEntry);
    await component.restore();

    expect(sources.restore).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('keeps the list selectable and shows the error when the restore fails', async () => {
    sources.restore.and.resolveTo(false);
    await component.select(ringEntry);
    await component.restore();
    await flush();

    expect(component.restoreError()).toBe(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_RESTORE);
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button.backup').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.callout--danger')).not.toBeNull();
    expect(dialogRef.close).not.toHaveBeenCalled();

    // picking another backup and retrying clears the stale error
    sources.restore.and.resolveTo(true);
    await component.select(fileEntry);
    await component.restore();
    expect(component.restoreError()).toBeNull();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });
});
