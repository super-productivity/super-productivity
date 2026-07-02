import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { UpdateCheckService } from './update-check.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { BannerService } from '../banner/banner.service';
import { BannerId, Banner } from '../banner/banner.model';
import { SnackService } from '../snack/snack.service';
import { LS } from '../persistence/storage-keys.const';
import { environment } from '../../../environments/environment';

const mockRelease = (tagName: string): Response =>
  ({
    ok: true,
    json: () =>
      Promise.resolve({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        tag_name: tagName,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        html_url: `https://github.com/super-productivity/super-productivity/releases/tag/${tagName}`,
      }),
  }) as Response;

describe('UpdateCheckService', () => {
  let service: UpdateCheckService;
  let bannerService: jasmine.SpyObj<BannerService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let fetchSpy: jasmine.Spy;
  let windowEaBefore: unknown;

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    snackService = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        UpdateCheckService,
        { provide: BannerService, useValue: bannerService },
        { provide: SnackService, useValue: snackService },
        { provide: GlobalConfigService, useValue: { misc$: of(undefined) } },
      ],
    });
    service = TestBed.inject(UpdateCheckService);
    fetchSpy = spyOn(window, 'fetch');
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
    windowEaBefore = (window as never as { ea?: unknown }).ea;
  });

  afterEach(() => {
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
    (window as never as { ea?: unknown }).ea = windowEaBefore;
  });

  describe('checkForUpdate()', () => {
    it('should open a banner when a newer version is available', async () => {
      fetchSpy.and.resolveTo(mockRelease('v99.0.0'));
      await service.checkForUpdate();
      expect(bannerService.open).toHaveBeenCalledTimes(1);
      const banner: Banner = bannerService.open.calls.mostRecent().args[0];
      expect(banner.id).toBe(BannerId.UpdateAvailable);
      expect(banner.translateParams).toEqual({ version: 'v99.0.0' });
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should do nothing when already on the latest version', async () => {
      fetchSpy.and.resolveTo(mockRelease(`v${environment.version}`));
      await service.checkForUpdate();
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should do nothing when the latest release is older (dev build)', async () => {
      fetchSpy.and.resolveTo(mockRelease('v0.0.1'));
      await service.checkForUpdate();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should show an up-to-date snack for a user-triggered check', async () => {
      fetchSpy.and.resolveTo(mockRelease(`v${environment.version}`));
      await service.checkForUpdate({ isUserTriggered: true });
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'SUCCESS' }),
      );
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should not re-show the banner for a dismissed version', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      fetchSpy.and.resolveTo(mockRelease('v99.0.0'));
      await service.checkForUpdate();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should show the banner for a dismissed version when user-triggered', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      fetchSpy.and.resolveTo(mockRelease('v99.0.0'));
      await service.checkForUpdate({ isUserTriggered: true });
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });

    it('should show the banner again for a newer version than the dismissed one', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      fetchSpy.and.resolveTo(mockRelease('v99.0.1'));
      await service.checkForUpdate();
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });

    it('should fail silently on network errors for automatic checks', async () => {
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      await service.checkForUpdate();
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should show an error snack on network errors for user-triggered checks', async () => {
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      await service.checkForUpdate({ isUserTriggered: true });
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should treat a non-ok response as an error', async () => {
      fetchSpy.and.resolveTo({ ok: false, status: 403 } as Response);
      await service.checkForUpdate({ isUserTriggered: true });
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should treat malformed release data as an error', async () => {
      fetchSpy.and.resolveTo({
        ok: true,
        json: () => Promise.resolve({ foo: 'bar' }),
      } as Response);
      await service.checkForUpdate({ isUserTriggered: true });
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });
  });

  describe('banner actions', () => {
    let banner: Banner;

    beforeEach(async () => {
      fetchSpy.and.resolveTo(mockRelease('v99.0.0'));
      await service.checkForUpdate();
      banner = bannerService.open.calls.mostRecent().args[0];
    });

    it('should persist the version and open the release page on download', () => {
      const openExternalUrl = jasmine.createSpy('openExternalUrl');
      (window as never as { ea: unknown }).ea = { openExternalUrl };
      banner.action?.fn();
      expect(localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION)).toBe('v99.0.0');
      expect(openExternalUrl).toHaveBeenCalledWith(
        'https://github.com/super-productivity/super-productivity/releases/tag/v99.0.0',
      );
    });

    it('should persist the version on dismiss so it is not shown again', async () => {
      banner.action2?.fn();
      expect(localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION)).toBe('v99.0.0');

      bannerService.open.calls.reset();
      await service.checkForUpdate();
      expect(bannerService.open).not.toHaveBeenCalled();
    });
  });
});
