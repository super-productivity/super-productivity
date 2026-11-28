import { Injector } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { handleStorageQuotaError, isStorageQuotaError } from './sync-error-utils';

describe('sync-error-utils', () => {
  describe('isStorageQuotaError', () => {
    it('should return true for storage quota errors', () => {
      expect(isStorageQuotaError('STORAGE_QUOTA_EXCEEDED')).toBe(true);
      expect(isStorageQuotaError('Storage quota exceeded for this account')).toBe(true);
      expect(
        isStorageQuotaError({
          errorCode: 'STORAGE_QUOTA_EXCEEDED',
        }),
      ).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isStorageQuotaError(undefined)).toBe(false);
      expect(isStorageQuotaError('Random error')).toBe(false);
      expect(isStorageQuotaError('Network error')).toBe(false);
    });
  });

  describe('handleStorageQuotaError', () => {
    let alertSpy: jasmine.Spy;
    let instant: jasmine.Spy;
    let injector: Injector;

    beforeEach(() => {
      // window.alert is already a spy in the global test setup.
      alertSpy = window.alert as jasmine.Spy;
      alertSpy.calls.reset();
      instant = jasmine
        .createSpy('instant')
        .and.callFake((key: string) => `translated:${key}`);
      injector = Injector.create({
        providers: [{ provide: TranslateService, useValue: { instant } }],
      });
    });

    it('alerts with the translated server-storage text for a quota error', () => {
      const wasHandled = handleStorageQuotaError('STORAGE_QUOTA_EXCEEDED', injector);

      expect(wasHandled).toBe(true);
      expect(alertSpy).toHaveBeenCalledOnceWith(
        'translated:F.SYNC.A.SERVER_STORAGE_FULL',
      );
    });

    it('neither alerts nor translates for other errors', () => {
      const wasHandled = handleStorageQuotaError(new Error('Network error'), injector);

      expect(wasHandled).toBe(false);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(instant).not.toHaveBeenCalled();
    });
  });
});
