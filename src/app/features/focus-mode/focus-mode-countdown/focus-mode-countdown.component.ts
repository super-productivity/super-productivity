import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { timer } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs/operators';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import {
  FocusModePreparationRocketComponent,
  type RocketState,
} from './rocket/focus-mode-preparation-rocket.component';

const COUNTDOWN_DURATION = 5 as const;

@Component({
  selector: 'focus-mode-countdown',
  templateUrl: './focus-mode-countdown.component.html',
  styleUrls: ['./focus-mode-countdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation],
  imports: [TranslatePipe, FocusModePreparationRocketComponent],
})
export class FocusModeCountdownComponent implements OnInit {
  readonly countdownComplete = output<void>();
  readonly isShowCountdown = input<boolean>(false);

  readonly T = T;
  countdownValue = signal<number>(COUNTDOWN_DURATION);
  rocketState = signal<RocketState>('pulse-5');

  private readonly COUNTDOWN_DURATION = COUNTDOWN_DURATION;
  private readonly _destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    if (this.isShowCountdown()) {
      this.startCountdown();
    } else {
      this.startQuickLaunch();
    }
  }

  private startQuickLaunch(): void {
    this.countdownValue.set(0);
    this.rocketState.set('launch');
    window.setTimeout(() => {
      this.countdownComplete.emit();
    }, 900);
  }

  private startCountdown(): void {
    this.countdownValue.set(this.COUNTDOWN_DURATION);
    this.rocketState.set('pulse-5');

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this._destroyRef), take(this.COUNTDOWN_DURATION + 1))
      .subscribe((tick) => {
        const remaining = this.COUNTDOWN_DURATION - tick;
        this.countdownValue.set(remaining);

        if (remaining > 0) {
          this.rocketState.set(`pulse-${remaining}` as RocketState);
        } else {
          this.rocketState.set('launch');
          window.setTimeout(() => {
            this.countdownComplete.emit();
          }, 900);
        }
      });
  }
}
