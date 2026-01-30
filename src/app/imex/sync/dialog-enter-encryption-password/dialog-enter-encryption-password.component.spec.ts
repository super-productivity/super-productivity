import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
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
});
