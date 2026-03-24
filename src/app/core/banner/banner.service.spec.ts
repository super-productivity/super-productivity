import { TestBed } from '@angular/core/testing';
import { BannerService } from './banner.service';
import { Banner, BannerId } from './banner.model';

describe('BannerService', () => {
  let service: BannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BannerService],
    });
    service = TestBed.inject(BannerService);
  });

  describe('open()', () => {
    it('should add a new banner when none exists with that id', () => {
      const banner: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
        ico: 'test_icon',
      };

      service.open(banner);

      expect(service.activeBanner()).toEqual(banner);
    });

    it('should update an existing banner with the same id', () => {
      const banner1: Banner = {
        id: BannerId.FocusMode,
        msg: 'Initial message',
        ico: 'initial_icon',
      };
      const banner2: Banner = {
        id: BannerId.FocusMode,
        msg: 'Updated message',
        ico: 'updated_icon',
      };

      service.open(banner1);
      service.open(banner2);

      const active = service.activeBanner();
      expect(active?.msg).toBe('Updated message');
      expect(active?.ico).toBe('updated_icon');
    });

    // Bug #5974 fix: Ensure nested action properties are updated
    it('should update action properties when reopening same banner', () => {
      const banner1: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
        action: {
          label: 'Pause',
          icon: 'pause',
          fn: () => {},
        },
      };
      const banner2: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
        action: {
          label: 'Play',
          icon: 'play_arrow',
          fn: () => {},
        },
      };

      service.open(banner1);
      expect(service.activeBanner()?.action?.icon).toBe('pause');

      service.open(banner2);
      expect(service.activeBanner()?.action?.icon).toBe('play_arrow');
    });

    it('should create a new object reference when updating banner', () => {
      const banner1: Banner = {
        id: BannerId.FocusMode,
        msg: 'Initial message',
      };

      service.open(banner1);
      const firstRef = service.activeBanner();

      const banner2: Banner = {
        id: BannerId.FocusMode,
        msg: 'Updated message',
      };
      service.open(banner2);
      const secondRef = service.activeBanner();

      // The object reference should be different to ensure change detection works
      expect(firstRef).not.toBe(secondRef);
    });
  });

  describe('dismiss()', () => {
    it('should remove a banner by id', () => {
      const banner: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
      };

      service.open(banner);
      expect(service.activeBanner()).toBeTruthy();

      service.dismiss(BannerId.FocusMode);
      expect(service.activeBanner()).toBeNull();
    });

    it('should not throw when dismissing non-existent banner', () => {
      expect(() => service.dismiss(BannerId.FocusMode)).not.toThrow();
    });
  });

  describe('dismissAll()', () => {
    it('should remove all banners with the specified id', () => {
      const banner: Banner = {
        id: BannerId.FocusMode,
        msg: 'Test message',
      };

      service.open(banner);
      service.dismissAll(BannerId.FocusMode);

      expect(service.activeBanner()).toBeNull();
    });
  });
});
