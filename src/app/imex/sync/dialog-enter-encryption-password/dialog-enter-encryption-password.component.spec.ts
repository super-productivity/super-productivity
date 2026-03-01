import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogEnterEncryptionPasswordComponent } from './dialog-enter-encryption-password.component';
import { SyncConfigService } from '../sync-config.service';
import { EncryptionPasswordChangeService } from '../encryption-password-change.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';

describe('DialogEnterEncryptionPasswordComponent', () => {
  let component: DialogEnterEncryptionPasswordComponent;
  let fixture: ComponentFixture<DialogEnterEncryptionPasswordComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogEnterEncryptionPasswordComponent>>;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;
  let mockEncryptionPasswordChangeService: jasmine.SpyObj<EncryptionPasswordChangeService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockSyncConfigService = jasmine.createSpyObj('SyncConfigService', [
      'updateEncryptionPassword',
    ]);
    mockEncryptionPasswordChangeService = jasmine.createSpyObj(
      'EncryptionPasswordChangeService',
      ['changePassword'],
    );
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue({
      id: SyncProviderId.SuperSync,
    } as any);

    await TestBed.configureTestingModule({
      imports: [
        DialogEnterEncryptionPasswordComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: SyncConfigService, useValue: mockSyncConfigService },
        {
          provide: EncryptionPasswordChangeService,
          useValue: mockEncryptionPasswordChangeService,
        },
        { provide: SnackService, useValue: mockSnackService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: SyncProviderManager, useValue: mockProviderManager },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogEnterEncryptionPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should reset loading and show error when saveAndSync fails', async () => {
    component.passwordVal = 'password123';
    mockSyncConfigService.updateEncryptionPassword.and.returnValue(
      Promise.reject(new Error('fail')),
    );

    await component.saveAndSync();

    expect(component.isLoading()).toBe(false);
    expect(mockSnackService.open).toHaveBeenCalled();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  describe('forceOverwrite', () => {
    it('should return early when passwordVal is empty', async () => {
      component.passwordVal = '';

      await component.forceOverwrite();

      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });

    it('should return early when isLoading is true', async () => {
      component.passwordVal = 'password123';
      component.isLoading.set(true);

      await component.forceOverwrite();

      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });

    it('should return early when user cancels the confirm dialog', async () => {
      component.passwordVal = 'password123';
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(false),
      } as any);

      await component.forceOverwrite();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockEncryptionPasswordChangeService.changePassword).not.toHaveBeenCalled();
    });

    it('should call changePassword and close with forceOverwrite on confirm', async () => {
      component.passwordVal = 'password123';
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(true),
      } as any);
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        Promise.resolve(),
      );

      await component.forceOverwrite();

      expect(mockEncryptionPasswordChangeService.changePassword).toHaveBeenCalledWith(
        'password123',
        { allowUnsyncedOps: true },
      );
      expect(mockDialogRef.close).toHaveBeenCalledWith({ forceOverwrite: true });
      expect(component.isLoading()).toBe(false);
    });

    it('should show error snackbar and reset loading on changePassword failure', async () => {
      component.passwordVal = 'password123';
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(true),
      } as any);
      mockEncryptionPasswordChangeService.changePassword.and.returnValue(
        Promise.reject(new Error('server error')),
      );

      await component.forceOverwrite();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          translateParams: { message: 'server error' },
        }),
      );
      expect(component.isLoading()).toBe(false);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should close with empty object', () => {
      component.cancel();

      expect(mockDialogRef.close).toHaveBeenCalledWith({});
    });

    it('should not close when loading', () => {
      component.isLoading.set(true);

      component.cancel();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });
});
