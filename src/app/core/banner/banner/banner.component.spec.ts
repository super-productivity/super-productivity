import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BannerComponent } from './banner.component';
import { BannerService } from '../banner.service';
import { Banner, BannerId } from '../banner.model';

describe('BannerComponent', () => {
  let component: BannerComponent;
  let bannerService: BannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BannerComponent, NoopAnimationsModule, TranslateModule.forRoot()],
    });
    bannerService = TestBed.inject(BannerService);
    const fixture = TestBed.createComponent(BannerComponent);
    component = fixture.componentInstance;
  });

  describe('action()', () => {
    it('should dismiss the banner and call fn when isKeepVisibleAfterAction is not set', () => {
      let actionCalled = false;
      const banner: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
        action: {
          label: 'Action',
          icon: 'icon',
          fn: () => {
            actionCalled = true;
          },
        },
      };
      bannerService.open(banner);

      component.action(banner, banner.action!);

      expect(actionCalled).toBeTrue();
      expect(bannerService.activeBanner()).toBeNull();
    });

    it('should NOT dismiss the banner when isKeepVisibleAfterAction is true', () => {
      let actionCalled = false;
      const banner: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
        action: {
          label: 'Action',
          icon: 'icon',
          fn: () => {
            actionCalled = true;
          },
        },
        isKeepVisibleAfterAction: true,
      };
      bannerService.open(banner);

      component.action(banner, banner.action!);

      expect(actionCalled).toBeTrue();
      expect(bannerService.activeBanner()).not.toBeNull();
    });
  });
});
