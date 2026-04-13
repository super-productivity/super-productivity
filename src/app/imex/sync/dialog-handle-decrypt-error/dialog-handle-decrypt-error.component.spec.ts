import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogHandleDecryptErrorComponent } from './dialog-handle-decrypt-error.component';
import { SyncConfigService } from '../sync-config.service';
import { SnackService } from '../../../core/snack/snack.service';

describe('DialogHandleDecryptErrorComponent', () => {
  let component: DialogHandleDecryptErrorComponent;
  let fixture: ComponentFixture<DialogHandleDecryptErrorComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogHandleDecryptErrorComponent>>;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockSyncConfigService = jasmine.createSpyObj('SyncConfigService', [
      'updateEncryptionPassword',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogHandleDecryptErrorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('updatePwAndResync()', () => {
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
    it('should update password, clear field, and close with isForceUpload', async () => {
      component.passwordVal = 'new-password';
      mockSyncConfigService.updateEncryptionPassword.and.resolveTo();

      await component.updatePWAndForceUpload();

      expect(mockSyncConfigService.updateEncryptionPassword).toHaveBeenCalledWith(
        'new-password',
      );
      expect(component.passwordVal).toBe('');
      expect(mockDialogRef.close).toHaveBeenCalledWith({ isForceUpload: true });
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
});
