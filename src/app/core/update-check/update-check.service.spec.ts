import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { of } from 'rxjs';
import { UpdateCheckService } from './update-check.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { BannerService } from '../banner/banner.service';
import { BannerId, Banner } from '../banner/banner.model';
import { SnackService } from '../snack/snack.service';
import { LS } from '../persistence/storage-keys.const';
import { environment } from '../../../environments/environment';

const RELEASES_API_URL =
  'https://api.github.com/repos/super-productivity/super-productivity/releases/latest';

describe('UpdateCheckService', () => {
  let service: UpdateCheckService;
  let httpMock: HttpTestingController;
  let bannerService: jasmine.SpyObj<BannerService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let windowEaBefore: unknown;

  const checkAndRespond = (
    body: Record<string, unknown>,
    opts: { isUserTriggered?: boolean } = {},
  ): Promise<void> => {
    const p = service.checkForUpdate(opts);
    httpMock.expectOne(RELEASES_API_URL).flush(body);
    return p;
  };

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    snackService = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        UpdateCheckService,
        { provide: BannerService, useValue: bannerService },
        { provide: SnackService, useValue: snackService },
        { provide: GlobalConfigService, useValue: { misc$: of(undefined) } },
      ],
    });
    service = TestBed.inject(UpdateCheckService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
    windowEaBefore = (window as unknown as { ea?: unknown }).ea;
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
    (window as unknown as { ea?: unknown }).ea = windowEaBefore;
  });

  describe('checkForUpdate()', () => {
    it('should open a banner when a newer version is available', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.0' });
      expect(bannerService.open).toHaveBeenCalledTimes(1);
      const banner: Banner = bannerService.open.calls.mostRecent().args[0];
      expect(banner.id).toBe(BannerId.UpdateAvailable);
      expect(banner.translateParams).toEqual({ version: 'v99.0.0' });
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should do nothing when already on the latest version', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: `v${environment.version}` });
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should do nothing when the latest release is older (dev build)', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v0.0.1' });
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should show an up-to-date snack for a user-triggered check', async () => {
      await checkAndRespond(
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { tag_name: `v${environment.version}` },
        { isUserTriggered: true },
      );
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'SUCCESS' }),
      );
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should not re-show the banner for a dismissed version', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.0' });
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('should show the banner for a dismissed version when user-triggered', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.0' }, { isUserTriggered: true });
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });

    it('should show the banner again for a newer version than the dismissed one', async () => {
      localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, 'v99.0.0');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.1' });
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });

    it('should fail silently on network errors for automatic checks', async () => {
      const p = service.checkForUpdate();
      httpMock
        .expectOne(RELEASES_API_URL)
        .error(new ProgressEvent('error'), { status: 0 });
      await p;
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should show an error snack on network errors for user-triggered checks', async () => {
      const p = service.checkForUpdate({ isUserTriggered: true });
      httpMock
        .expectOne(RELEASES_API_URL)
        .error(new ProgressEvent('error'), { status: 0 });
      await p;
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should treat a non-ok response as an error', async () => {
      const p = service.checkForUpdate({ isUserTriggered: true });
      httpMock
        .expectOne(RELEASES_API_URL)
        .flush('rate limited', { status: 403, statusText: 'Forbidden' });
      await p;
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should treat missing release data as an error', async () => {
      await checkAndRespond({ foo: 'bar' }, { isUserTriggered: true });
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should reject a tag that is not strictly a version tag', async () => {
      // lenient parsing is fine for the LOCAL version, but remote tags are
      // untrusted input and must match exactly
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: '99.0.0<img src=x>' }, { isUserTriggered: true });
      expect(bannerService.open).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should not fire a second request while one is in flight', async () => {
      const p1 = service.checkForUpdate();
      const p2 = service.checkForUpdate();
      // expectOne throws if the guard failed and two requests were made
      httpMock.expectOne(RELEASES_API_URL).flush({ tag_name: 'v99.0.0' }); // eslint-disable-line @typescript-eslint/naming-convention
      await Promise.all([p1, p2]);
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('banner actions', () => {
    let banner: Banner;

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.0' });
      banner = bannerService.open.calls.mostRecent().args[0];
    });

    it('should persist the version and open the locally-built release page on download', () => {
      const openExternalUrl = jasmine.createSpy('openExternalUrl');
      (window as unknown as { ea: unknown }).ea = { openExternalUrl };
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await checkAndRespond({ tag_name: 'v99.0.0' });
      expect(bannerService.open).not.toHaveBeenCalled();
    });
  });
});
