import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  DialogEnableEncryptionComponent,
  EnableEncryptionDialogData,
  EnableEncryptionResult,
} from './dialog-enable-encryption.component';
import { SuperSyncEncryptionToggleService } from '../supersync-encryption-toggle.service';
import { FileBasedEncryptionService } from '../file-based-encryption.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';

describe('DialogEnableEncryptionComponent', () => {
  let component: DialogEnableEncryptionComponent;
  let fixture: ComponentFixture<DialogEnableEncryptionComponent>;
  let mockDialogRef: jasmine.SpyObj<
    MatDialogRef<DialogEnableEncryptionComponent, EnableEncryptionResult>
  >;
  let mockEncryptionToggleService: jasmine.SpyObj<SuperSyncEncryptionToggleService>;
  let mockFileBasedEncryptionService: jasmine.SpyObj<FileBasedEncryptionService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;

  const createComponent = (
    dialogData: EnableEncryptionDialogData | null = null,
  ): void => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: dialogData });
    TestBed.compileComponents();
    fixture = TestBed.createComponent(DialogEnableEncryptionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockEncryptionToggleService = jasmine.createSpyObj(
      'SuperSyncEncryptionToggleService',
      ['enableEncryption'],
    );
    mockFileBasedEncryptionService = jasmine.createSpyObj('FileBasedEncryptionService', [
      'enableEncryption',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue({
      id: SyncProviderId.SuperSync,
    } as any);
    mockSyncWrapperService = jasmine.createSpyObj('SyncWrapperService', [
      'runWithSyncBlocked',
    ]);
    mockSyncWrapperService.runWithSyncBlocked.and.callFake(
      async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    );
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [
      'updateSection',
    ]);

    await TestBed.configureTestingModule({
      imports: [
        DialogEnableEncryptionComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: SuperSyncEncryptionToggleService,
          useValue: mockEncryptionToggleService,
        },
        {
          provide: FileBasedEncryptionService,
          useValue: mockFileBasedEncryptionService,
        },
        { provide: SnackService, useValue: mockSnackService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MAT_DIALOG_DATA, useValue: null },
      ],
    });
  });

  describe('password validation', () => {
    beforeEach(() => {
      createComponent({ initialSetup: true, providerType: 'supersync' });
    });

    it('should be invalid when password is empty', () => {
      component.password = '';
      component.confirmPassword = '';
      expect(component.isPasswordValid).toBe(false);
    });

    it('should be invalid when password is less than 8 characters', () => {
      component.password = '1234567';
      component.confirmPassword = '1234567';
      expect(component.isPasswordValid).toBe(false);
    });

    it('should show passwordError for short password', () => {
      component.password = 'short';
      component.confirmPassword = '';
      expect(component.passwordError).toBeTruthy();
    });

    it('should be invalid when passwords do not match', () => {
      component.password = 'password123';
      component.confirmPassword = 'password456';
      expect(component.isPasswordValid).toBe(false);
    });

    it('should show passwordError for mismatching passwords', () => {
      component.password = 'password123';
      component.confirmPassword = 'password456';
      expect(component.passwordError).toBeTruthy();
    });

    it('should be valid when password is 8+ characters and passwords match', () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      expect(component.isPasswordValid).toBe(true);
    });

    it('should return no passwordError when valid', () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      expect(component.passwordError).toBeNull();
    });

    it('should be valid with exactly 8 characters', () => {
      component.password = '12345678';
      component.confirmPassword = '12345678';
      expect(component.isPasswordValid).toBe(true);
    });
  });

  describe('preconditions (initialSetup=true)', () => {
    it('should skip precondition check when initialSetup is true', () => {
      createComponent({ initialSetup: true, providerType: 'supersync' });

      expect(component.canProceed()).toBe(true);
      expect(component.errorReason()).toBeNull();
    });
  });

  describe('preconditions (initialSetup=false, supersync)', () => {
    it('should set canProceed=false when no active provider', () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);
      createComponent({ initialSetup: false, providerType: 'supersync' });

      expect(component.canProceed()).toBe(false);
      expect(component.errorReason()).toBeTruthy();
    });

    it('should set canProceed=false when provider is not SuperSync', () => {
      mockProviderManager.getActiveProvider.and.returnValue({
        id: SyncProviderId.WebDAV,
      } as any);
      createComponent({ initialSetup: false, providerType: 'supersync' });

      expect(component.canProceed()).toBe(false);
    });

    it('should set canProceed=true when provider is SuperSync', () => {
      mockProviderManager.getActiveProvider.and.returnValue({
        id: SyncProviderId.SuperSync,
      } as any);
      createComponent({ initialSetup: false, providerType: 'supersync' });

      expect(component.canProceed()).toBe(true);
    });
  });

  describe('preconditions (initialSetup=false, file-based)', () => {
    it('should set canProceed=false when provider is not file-based', () => {
      mockProviderManager.getActiveProvider.and.returnValue({
        id: SyncProviderId.SuperSync,
      } as any);
      createComponent({ initialSetup: false, providerType: 'file-based' });

      expect(component.canProceed()).toBe(false);
    });

    it('should set canProceed=true when provider is WebDAV', () => {
      mockProviderManager.getActiveProvider.and.returnValue({
        id: SyncProviderId.WebDAV,
      } as any);
      createComponent({ initialSetup: false, providerType: 'file-based' });

      expect(component.canProceed()).toBe(true);
    });
  });

  describe('confirm()', () => {
    beforeEach(() => {
      createComponent({ initialSetup: true, providerType: 'supersync' });
    });

    it('should return early when loading', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      component.isLoading.set(true);

      await component.confirm();

      expect(mockEncryptionToggleService.enableEncryption).not.toHaveBeenCalled();
    });

    it('should return early when canProceed is false', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      component.canProceed.set(false);

      await component.confirm();

      expect(mockEncryptionToggleService.enableEncryption).not.toHaveBeenCalled();
    });

    it('should return early when password is invalid', async () => {
      component.password = 'short';
      component.confirmPassword = 'short';

      await component.confirm();

      expect(mockEncryptionToggleService.enableEncryption).not.toHaveBeenCalled();
    });

    it('should call SuperSync encryption for supersync providerType', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionToggleService.enableEncryption.and.resolveTo();

      await component.confirm();

      expect(mockEncryptionToggleService.enableEncryption).toHaveBeenCalledWith(
        'password123',
      );
      expect(mockFileBasedEncryptionService.enableEncryption).not.toHaveBeenCalled();
    });

    it('should wrap operation in runWithSyncBlocked', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionToggleService.enableEncryption.and.resolveTo();

      await component.confirm();

      expect(mockSyncWrapperService.runWithSyncBlocked).toHaveBeenCalled();
    });

    it('should show success snack and close with success on success', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionToggleService.enableEncryption.and.resolveTo();

      await component.confirm();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'SUCCESS' }),
      );
      expect(mockDialogRef.close).toHaveBeenCalledWith({ success: true });
    });

    it('should show error snack and stay open on failure', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionToggleService.enableEncryption.and.rejectWith(
        new Error('Network error'),
      );

      await component.confirm();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          translateParams: { message: 'Network error' },
        }),
      );
      expect(component.isLoading()).toBe(false);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockEncryptionToggleService.enableEncryption.and.rejectWith('String error');

      await component.confirm();

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          translateParams: { message: 'Unknown error' },
        }),
      );
    });
  });

  describe('confirm() with file-based provider', () => {
    beforeEach(() => {
      mockProviderManager.getActiveProvider.and.returnValue({
        id: SyncProviderId.WebDAV,
      } as any);
      createComponent({ initialSetup: true, providerType: 'file-based' });
    });

    it('should call file-based encryption for file-based providerType', async () => {
      component.password = 'password123';
      component.confirmPassword = 'password123';
      mockFileBasedEncryptionService.enableEncryption.and.resolveTo();

      await component.confirm();

      expect(mockFileBasedEncryptionService.enableEncryption).toHaveBeenCalledWith(
        'password123',
      );
      expect(mockEncryptionToggleService.enableEncryption).not.toHaveBeenCalled();
    });
  });

  describe('disableSuperSync()', () => {
    beforeEach(() => {
      createComponent({ initialSetup: true, providerType: 'supersync' });
    });

    it('should update config to disable sync and close with success: false', () => {
      component.disableSuperSync();

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEnabled: false,
      });
      expect(mockDialogRef.close).toHaveBeenCalledWith({ success: false });
    });
  });

  describe('cancel()', () => {
    beforeEach(() => {
      createComponent({ initialSetup: true, providerType: 'supersync' });
    });

    it('should close dialog with success: false', () => {
      component.cancel();

      expect(mockDialogRef.close).toHaveBeenCalledWith({ success: false });
    });
  });
});
