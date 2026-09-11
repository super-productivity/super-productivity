import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogHandleDecryptErrorComponent } from './dialog-handle-decrypt-error.component';
import { SyncConfigService } from '../sync-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncLocalStateService } from '../../../op-log/sync/sync-local-state.service';

describe('DialogHandleDecryptErrorComponent', () => {
  let component: DialogHandleDecryptErrorComponent;
  let fixture: ComponentFixture<DialogHandleDecryptErrorComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogHandleDecryptErrorComponent>>;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockSyncLocalStateService: jasmine.SpyObj<SyncLocalStateService>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockSyncConfigService = jasmine.createSpyObj('SyncConfigService', [
      'updateEncryptionPassword',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockSyncLocalStateService = jasmine.createSpyObj('SyncLocalStateService', [
      'hasNothingWorthUploading',
      'warnNothingWorthUploading',
    ]);
    mockSyncLocalStateService.hasNothingWorthUploading.and.resolveTo(false);

    await TestBed.configureTestingModule({
      imports: [
        DialogHandleDecryptErrorComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: SyncConfigService, useValue: mockSyncConfigService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: SyncLocalStateService, useValue: mockSyncLocalStateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogHandleDecryptErrorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('updatePwAndResync()', () => {
    it('should do nothing when submitted with an empty password', async () => {
      // The input has no validators, so the template's formEl.valid gate cannot
      // stop an empty submit; the code guard must. Without it, an empty submit
      // persists encryptKey '' with isEncryptionEnabled true.
      component.passwordVal = '';

      await component.updatePwAndResync();

      expect(mockSyncConfigService.updateEncryptionPassword).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should update password, clear field, and close with isReSync', async () => {
      component.passwordVal = 'new-password';
      mockSyncConfigService.updateEncryptionPassword.and.resolveTo();

      await component.updatePwAndResync();

      expect(mockSyncConfigService.updateEncryptionPassword).toHaveBeenCalledWith(
        'new-password',
      );
      expect(component.passwordVal).toBe('');
      expect(mockDialogRef.close).toHaveBeenCalledWith({ isReSync: true });
    });

    it('should show error snack and not close on failure', async () => {
      component.passwordVal = 'new-password';
      mockSyncConfigService.updateEncryptionPassword.and.rejectWith(
        new Error('Save failed'),
      );

      await component.updatePwAndResync();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('updatePWAndForceUpload()', () => {
    let originalConfirm: typeof window.confirm;
    let confirmReturn: boolean;

    beforeEach(() => {
      originalConfirm = window.confirm;
      confirmReturn = true;
      window.confirm = (() => confirmReturn) as typeof window.confirm;
    });

    afterEach(() => {
      window.confirm = originalConfirm;
    });

    it('should update password, clear field, and close with isForceUpload when confirmed', async () => {
      component.passwordVal = 'new-password';
      mockSyncConfigService.updateEncryptionPassword.and.resolveTo();

      await component.updatePWAndForceUpload();

      expect(mockSyncConfigService.updateEncryptionPassword).toHaveBeenCalledWith(
        'new-password',
      );
      expect(component.passwordVal).toBe('');
      expect(mockDialogRef.close).toHaveBeenCalledWith({ isForceUpload: true });
    });

    it('should abort without changes when user cancels confirmation', async () => {
      confirmReturn = false;
      component.passwordVal = 'new-password';

      await component.updatePWAndForceUpload();

      expect(mockSyncConfigService.updateEncryptionPassword).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(component.passwordVal).toBe('new-password');
    });

    it('should show error snack and not close on failure', async () => {
      component.passwordVal = 'new-password';
      mockSyncConfigService.updateEncryptionPassword.and.rejectWith(
        new Error('Save failed'),
      );

      await component.updatePWAndForceUpload();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('cancel()', () => {
    it('should clear password and close with empty object', () => {
      component.passwordVal = 'something';

      component.cancel();

      expect(component.passwordVal).toBe('');
      expect(mockDialogRef.close).toHaveBeenCalledWith({});
    });
  });

  describe('updatePWAndForceUpload() empty-device guard (#9256)', () => {
    it('refuses and explains when this device has nothing to upload', async () => {
      // The destructive path runs a clean-slate SYNC_IMPORT, which makes the
      // server DELETE its operations. From a device with nothing on it that
      // destroys the user's only copy.
      // src/test.ts installs a global confirm spy; reuse rather than re-spy.
      const confirmSpy = window.confirm as jasmine.Spy;
      confirmSpy.and.returnValue(true);
      mockSyncLocalStateService.hasNothingWorthUploading.and.resolveTo(true);
      component.passwordVal = 'some-password';

      await component.updatePWAndForceUpload();

      expect(mockSyncLocalStateService.warnNothingWorthUploading).toHaveBeenCalled();
      // Never reaches the confirm, never persists, never closes destructively.
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockSyncConfigService.updateEncryptionPassword).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('surfaces an error instead of failing silently when the guard cannot be read', async () => {
      // The guard reads the archive DB; that read can reject. Without a catch the
      // rejection dies in the click handler and the button just does nothing.
      mockSyncLocalStateService.hasNothingWorthUploading.and.rejectWith(
        new Error('archive db unavailable'),
      );
      component.passwordVal = 'some-password';

      await component.updatePWAndForceUpload();

      expect(mockSnackService.open).toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
      // The re-entrancy latch must clear, or the button stays dead forever.
      expect(component.isForceUploadPending()).toBe(false);
    });

    it('still allows the overwrite from a device that holds data', async () => {
      (window.confirm as jasmine.Spy).and.returnValue(true);
      mockSyncLocalStateService.hasNothingWorthUploading.and.resolveTo(false);
      mockSyncConfigService.updateEncryptionPassword.and.resolveTo();
      component.passwordVal = 'some-password';

      await component.updatePWAndForceUpload();

      expect(mockDialogRef.close).toHaveBeenCalledWith({ isForceUpload: true });
    });
  });
});
