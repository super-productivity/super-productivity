import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { NotifyService } from './notify.service';
import { CapacitorNotificationService } from '../platform/capacitor-notification.service';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';

describe('NotifyService', () => {
  let notificationServiceSpy: jasmine.SpyObj<CapacitorNotificationService>;
  let showToastSpy: jasmine.Spy;

  const setupPlatform = (props: {
    isLegacyAndroidWebView: boolean;
    isNative: boolean;
  }): NotifyService => {
    // Only the fields NotifyService actually branches on are mocked, to keep
    // the mock honest about what's exercised.
    const platformSpy = jasmine.createSpyObj('CapacitorPlatformService', ['isAndroid'], {
      platform: 'android',
      ...props,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        NotifyService,
        { provide: CapacitorPlatformService, useValue: platformSpy },
        { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
        {
          provide: UiHelperService,
          useValue: jasmine.createSpyObj('UiHelperService', ['focusApp']),
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
      ],
    });
    return TestBed.inject(NotifyService);
  };

  beforeEach(() => {
    notificationServiceSpy = jasmine.createSpyObj('CapacitorNotificationService', [
      'schedule',
    ]);
    notificationServiceSpy.schedule.and.returnValue(Promise.resolve(true));
    // `androidInterface` wraps `window.SUPAndroid`, undefined off-device, so
    // spy the service's seam instead — same approach as LocalBackupService's
    // `_nativeDb*` tests.
    showToastSpy = spyOn(
      NotifyService.prototype as unknown as { _showLegacyAndroidToast: () => void },
      '_showLegacyAndroidToast',
    );
  });

  describe('on the legacy Android WebView shell (#5376)', () => {
    // `isNative` is true here too — the legacy shell must be handled before the
    // Capacitor branch, which would silently no-op without a Capacitor bridge.
    const setupLegacy = (): NotifyService =>
      setupPlatform({ isLegacyAndroidWebView: true, isNative: true });

    it('shows the notification in-app instead of silently dropping it', async () => {
      await setupLegacy().notify({ title: 'A title', body: 'A body' });

      expect(showToastSpy).toHaveBeenCalledWith('A title - A body');
    });

    it('does not reach the Capacitor notification plugin', async () => {
      await setupLegacy().notify({ title: 'A title', body: 'A body' });

      expect(notificationServiceSpy.schedule).not.toHaveBeenCalled();
    });

    it('shows a title-only notification', async () => {
      await setupLegacy().notify({ title: 'A title' });

      expect(showToastSpy).toHaveBeenCalledWith('A title');
    });

    it('shows a body-only notification', async () => {
      await setupLegacy().notify({ body: 'A body' });

      expect(showToastSpy).toHaveBeenCalledWith('A body');
    });

    it('shows nothing when there is no content at all', async () => {
      await setupLegacy().notify({});

      expect(showToastSpy).not.toHaveBeenCalled();
    });
  });

  describe('on the Capacitor Android shell', () => {
    it('schedules via the Capacitor notification plugin', async () => {
      await setupPlatform({
        isLegacyAndroidWebView: false,
        isNative: true,
      }).notify({ title: 'A title', body: 'A body' });

      expect(showToastSpy).not.toHaveBeenCalled();
      expect(notificationServiceSpy.schedule).toHaveBeenCalledWith(
        jasmine.objectContaining({ title: 'A title', body: 'A body' }),
      );
    });
  });
});
