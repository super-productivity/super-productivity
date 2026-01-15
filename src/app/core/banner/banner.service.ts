import { Injectable, computed, effect, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Banner, BANNER_SORT_PRIO_MAP, BannerId } from './banner.model';
import { tap } from 'rxjs/operators';
import { Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BannerService {
  private _banners = signal<Banner[]>([]);
  private _hideWhenSub: Subscription | null = null;

  activeBanner = computed(() => {
    const banners = this._banners();
    const sorted = [...banners].sort((a, b) => {
      return BANNER_SORT_PRIO_MAP[b.id] - BANNER_SORT_PRIO_MAP[a.id];
    });
    return (sorted.length && sorted[0]) || null;
  });

  // Backward compatibility - expose as Observable for components not yet converted
  activeBanner$ = toObservable(this.activeBanner);

  constructor() {
    // Set up auto-dismiss effect
    effect(() => {
      const activeBanner = this.activeBanner();
      // Clean up previous subscription when banner changes
      this._hideWhenSub?.unsubscribe();
      this._hideWhenSub = null;

      if (activeBanner?.hideWhen$) {
        this._hideWhenSub = activeBanner.hideWhen$
          .pipe(
            tap(() => {
              this.dismiss(activeBanner.id);
            }),
          )
          .subscribe();
      }
    });

    // FOR DEBUGGING
    // this.open({
    //   id: BannerId.JiraUnblock,
    //   msg: 'Jira: To prevent shut out from api, access has been blocked by Super Productivity. You probably should check your jira settings!',
    //   svgIco: 'jira',
    //   action: {
    //     label: 'Unblock',
    //     fn: () => {},
    //   },
    // });
    //
    // setTimeout(() => {
    //   this.open({
    //     id: BannerId.TakeABreak,
    //     ico: 'free_breakfast',
    //     msg: 'You should take a break',
    //     action: {
    //       label: 'I already did',
    //       fn: () => {},
    //     },
    //     action2: {
    //       label: 'Snooze 15m',
    //       fn: () => {},
    //     },
    //   });
    //
    //   this.open({
    //     id: BannerId.TakeABreak,
    //     msg: 'Take a break',
    //     ico: 'cloud_off',
    //     action: {
    //       label: 'Login',
    //       fn: () => {},
    //     },
    //   });
    // }, 7000);
    //
    // setTimeout(() => {
    //   this.open({
    //     id: BannerId.FocusMode,
    //     type: 'ERROR',
    //     ico: 'error',
    //     msg: 'ERROR: ' + 'Something broke',
    //     action: {
    //       label: 'Report',
    //       fn: () =>
    //         window.open('https://github.com/super-productivity/super-productivity/issues/new'),
    //     },
    //     action2: {
    //       label: 'Reload App',
    //       fn: () => window.location.reload(),
    //     },
    //     action3: {
    //       label: 'Dismiss',
    //       fn: () => {},
    //     },
    //   });
    // }, 2000);
    //
    // this.open({
    //   id: BannerId.Offline,
    //   msg: 'Offline',
    //   ico: 'cloud_off',
    //   action: {
    //     label: 'Oh no',
    //     fn: () => {},
    //   },
    // });
    //
    // setTimeout(() => {
    //   this.open({
    //     id: BannerId.ReminderCountdown,
    //     msg: 'Reminder Countdown',
    //     ico: 'reminder',
    //     action: {
    //       label: 'Yeah',
    //       fn: () => {},
    //     },
    //   });
    // }, 4000);
  }

  open(banner: Banner): void {
    this._banners.update((banners) => {
      const bannerIndex = banners.findIndex((bannerIN) => bannerIN.id === banner.id);
      if (bannerIndex > -1) {
        // Create new banner object to ensure change detection triggers for nested properties
        // Bug #5974 fix: Object.assign mutation didn't trigger change detection for action.icon
        const updatedBanner = { ...banners[bannerIndex], ...banner };
        return banners.map((b, i) => (i === bannerIndex ? updatedBanner : b));
      } else {
        return [...banners, banner];
      }
    });
  }

  dismiss(bannerId: BannerId): void {
    // Log.log('BannerService -> dismissing Banner', bannerId);
    this._banners.update((banners) => {
      const bannerIndex = banners.findIndex((bannerIN) => bannerIN.id === bannerId);
      if (bannerIndex > -1) {
        return banners.filter((_, index) => index !== bannerIndex);
      }
      return banners;
    });
  }

  // usually not required, but when we want to be sure
  dismissAll(bannerId: BannerId): void {
    this._banners.update((banners) => {
      const hasBanner = banners.find((bannerIN) => bannerIN.id === bannerId);
      if (hasBanner) {
        return banners.filter((banner) => banner.id !== bannerId);
      }
      return banners;
    });
  }
}
