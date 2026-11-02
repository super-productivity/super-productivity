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

  describe('cancel()', () => {
    it('should clear password and close with empty object', () => {
      component.passwordVal = 'something';

      component.cancel();

      expect(component.passwordVal).toBe('');
      expect(mockDialogRef.close).toHaveBeenCalledWith({});
    });
  });

  // #9256: the dialog cannot tell a wrong password from a corrupt or
  // foreign-key op, so it must not offer to replace the server.
  it('offers only retry and cancel, no server overwrite', () => {
    component.passwordVal = 'some-password';
    fixture.detectChanges();

    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    );
    expect(buttons.map((btn) => btn.textContent?.trim())).toEqual([
      jasmine.stringContaining('F.SYNC.D_DECRYPT_ERROR.CHANGE_PW_AND_DECRYPT'),
      'G.CANCEL',
    ]);
  });
});
