import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BannerService } from '../banner.service';
import { Banner, BannerAction, BannerId } from '../banner.model';
import { concatMap, mapTo } from 'rxjs/operators';
import { merge, Observable, of, timer } from 'rxjs';
import { T } from '../../../t.const';
import { bannerAnimation } from './banner.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';

@Component({
  selector: 'banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [bannerAnimation, fadeAnimation],
  imports: [
    MatProgressBar,
    MatIcon,
    MatButton,
    MatIconButton,
    AsyncPipe,
    TranslatePipe,
    MsToMinuteClockStringPipe,
  ],
})
export class BannerComponent {
  bannerService = inject(BannerService);

  T: typeof T = T;
  private _dirtyReference?: string | null;
  // TODO maybe improve if initial delay is annoying
  activeBanner$: Observable<Banner | null> = this.bannerService.activeBanner$.pipe(
    concatMap((activeBanner) => {
      if (activeBanner) {
        if (!this._dirtyReference || this._dirtyReference === activeBanner.id) {
          this._dirtyReference = activeBanner.id;
          return of(activeBanner);
        }

        this._dirtyReference = activeBanner.id;
        return merge(of(null), timer(500).pipe(mapTo(activeBanner)));
      } else {
        this._dirtyReference = null;
        return of(null);
      }
    }),
  );

  dismiss(bannerId: string): void {
    this.bannerService.dismiss(bannerId as BannerId);
  }

  action(bannerId: string, bannerAction: BannerAction): void {
    this.dismiss(bannerId);
    bannerAction.fn();
  }

  protected readonly timer = timer;
}
