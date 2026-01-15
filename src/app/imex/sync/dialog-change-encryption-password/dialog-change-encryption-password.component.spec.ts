import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  DialogChangeEncryptionPasswordComponent,
  ChangeEncryptionPasswordResult,
} from './dialog-change-encryption-password.component';
import { EncryptionPasswordChangeService } from '../encryption-password-change.service';
import { SnackService } from '../../../core/snack/snack.service';

describe('DialogChangeEncryptionPasswordComponent', () => {
  let component: DialogChangeEncryptionPasswordComponent;
  let fixture: ComponentFixture<DialogChangeEncryptionPasswordComponent>;
  let mockDialogRef: jasmine.SpyObj<
    MatDialogRef<DialogChangeEncryptionPasswordComponent, ChangeEncryptionPasswordResult>
  >;
  let mockEncryptionPasswordChangeService: jasmine.SpyObj<EncryptionPasswordChangeService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockEncryptionPasswordChangeService = jasmine.createSpyObj(
      'EncryptionPasswordChangeService',
      ['changePassword'],
    );
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        DialogChangeEncryptionPasswordComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: EncryptionPasswordChangeService,
          useValue: mockEncryptionPasswordChangeService,
        },
        { provide: SnackService, useValue: mockSnackService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogChangeEncryptionPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('validation', () => {
    it('should be invalid when password is empty', () => {
      component.newPassword = '';
      component.confirmPassword = '';
      expect(component.isValid).toBe(false);
    });

    it('should be invalid when password is less than 8 characters', () => {
      component.newPassword = '1234567';
      component.confirmPassword = '1234567';
      expect(component.isValid).toBe(false);
    });

    it('should be invalid when passwords do not match', () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password456';
      expect(component.passwordsMatch).toBe(false);
      expect(component.isValid).toBe(false);
    });

    it('should be valid when password is 8+ characters and passwords match', () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      expect(component.passwordsMatch).toBe(true);
      expect(component.isValid).toBe(true);
    });

    it('should be valid with exactly 8 characters', () => {
      component.newPassword = '12345678';
      component.confirmPassword = '12345678';
      expect(component.isValid).toBe(true);
    });

    it('should be valid with very long password', () => {
      const longPassword = 'a'.repeat(100);
      component.newPassword = longPassword;
      component.confirmPassword = longPassword;
      expect(component.isValid).toBe(true);
    });
  });

  describe('confirm', () => {
    it('should do nothing if form is invalid', async () => {
      component.newPassword = 'short';
      component.confirmPassword = 'short';

      await component.confirm();

      expect(mockEncryptionPasswordChangeService.changePassword).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should do nothing if already loading', async () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      component.isLoading.set(true);

      await component.confirm();

      expect(mockEncryptionPasswordChangeService.changePassword).not.toHaveBeenCalled();
    });

    it('should set loading state during operation', async () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        new Promise((resolve) => setTimeout(resolve, 100)),
      );

      const confirmPromise = component.confirm();
      expect(component.isLoading()).toBe(true);

      await confirmPromise;
      // After success, dialog closes, loading state may or may not be reset
    });

    it('should call changePassword and close dialog on success', async () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        Promise.resolve(),
      );

      await component.confirm();

      expect(mockEncryptionPasswordChangeService.changePassword).toHaveBeenCalledWith(
        'password123',
      );
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'SUCCESS' }),
      );
      expect(mockDialogRef.close).toHaveBeenCalledWith({ success: true });
    });

    it('should show error snack and reset loading on failure', async () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      await component.confirm();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: 'Failed to change password: Network error',
        }),
      );
      expect(component.isLoading()).toBe(false);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      component.newPassword = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        Promise.reject('String error'),
      );

      await component.confirm();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: 'Failed to change password: Unknown error',
        }),
      );
    });
  });

  describe('cancel', () => {
    it('should close dialog with success: false', () => {
      component.cancel();

      expect(mockDialogRef.close).toHaveBeenCalledWith({ success: false });
    });
  });
});
