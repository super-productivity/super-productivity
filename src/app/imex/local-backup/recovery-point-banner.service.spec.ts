import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import {
  isSuspiciousShrink,
  RecoveryPointBannerService,
} from './recovery-point-banner.service';

describe('RecoveryPointBannerService', () => {
  let service: RecoveryPointBannerService;
  let bannerService: jasmine.SpyObj<BannerService>;

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    TestBed.configureTestingModule({
      providers: [
        RecoveryPointBannerService,
        { provide: BannerService, useValue: bannerService },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
      ],
    });
    service = TestBed.inject(RecoveryPointBannerService);
  });

  describe('isSuspiciousShrink', () => {
    it('fires when the incoming state holds fewer than half the tasks', () => {
      expect(isSuspiciousShrink(10, 4)).toBeTrue();
      expect(isSuspiciousShrink(10, 0)).toBeTrue();
      expect(isSuspiciousShrink(2, 0)).toBeTrue();
    });

    it('stays quiet for ordinary syncs and tiny datasets', () => {
      expect(isSuspiciousShrink(10, 5)).toBeFalse();
      expect(isSuspiciousShrink(10, 12)).toBeFalse();
      expect(isSuspiciousShrink(1, 0)).toBeFalse();
      expect(isSuspiciousShrink(0, 0)).toBeFalse();
    });
  });

  it('opens the banner with the counts on a suspicious shrink', () => {
    service.showIfShrunk(30, 2);

    expect(bannerService.open).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        id: BannerId.LocalRecoveryPoint,
        translateParams: { before: 30, after: 2 },
      }),
    );
  });

  it('does nothing otherwise', () => {
    service.showIfShrunk(30, 29);

    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('dismisses the banner from either action', () => {
    service.showIfShrunk(30, 2);
    const banner = bannerService.open.calls.mostRecent().args[0];

    banner.action2!.fn();
    expect(bannerService.dismiss).toHaveBeenCalledWith(BannerId.LocalRecoveryPoint);
  });
});
