import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogSimpleCounterEditComponent } from '../dialog-simple-counter-edit/dialog-simple-counter-edit.component';
import { T } from 'src/app/t.const';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { merge, of, Subject, Subscription } from 'rxjs';
import { DateService } from 'src/app/core/date/date.service';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter, map, scan, switchMap, tap } from 'rxjs/operators';
import { BannerService } from '../../../core/banner/banner.service';
import { BannerId } from '../../../core/banner/banner.model';
import { MatIconButton } from '@angular/material/button';
import { LongPressDirective } from '../../../ui/longpress/longpress.directive';
import { MatIcon } from '@angular/material/icon';
import { AsyncPipe } from '@angular/common';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { ProgressCircleComponent } from '../../../ui/progress-circle/progress-circle.component';

@Component({
  selector: 'simple-counter-button',
  templateUrl: './simple-counter-button.component.html',
  styleUrls: ['./simple-counter-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.isSuccess]': 'isSuccess()',
  },
  imports: [
    LongPressDirective,
    MatIcon,
    AsyncPipe,
    MsToMinuteClockStringPipe,
    MatIconButton,
    ProgressCircleComponent,
  ],
})
export class SimpleCounterButtonComponent implements OnDestroy, OnInit {
  private _simpleCounterService = inject(SimpleCounterService);
  private _matDialog = inject(MatDialog);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateService = inject(DateService);
  private _bannerService = inject(BannerService);
  private _todayStr$ = this._globalTrackingIntervalService.todayDateStr$;

  T: typeof T = T;
  SimpleCounterType: typeof SimpleCounterType = SimpleCounterType;

  todayStr = toSignal(this._todayStr$, { initialValue: this._dateService.todayStr() });
  simpleCounter = input.required<SimpleCounter>();
  isTimeUp = signal<boolean>(false);
  isSuccess = computed(() => {
    const sc = this.simpleCounter();
    return (
      sc?.isTrackStreaks &&
      sc?.countOnDay[this.todayStr()] &&
      sc?.countOnDay[this.todayStr()] >= (sc.streakMinValue || 0)
    );
  });

  private _subs = new Subscription();
  private _resetCountdown$ = new Subject();
  private _countdownDuration$ = toObservable(this.simpleCounter).pipe(
    map((c) => c?.countdownDuration),
    filter((v): v is number => typeof v === 'number' && v > 0),
    distinctUntilChanged(),
  );

  countdownTime$ = this._countdownDuration$.pipe(
    switchMap((countdownDuration) =>
      merge(of(false), this._resetCountdown$.pipe(map(() => true))).pipe(
        switchMap((isManualReset) => {
          const id = this.simpleCounter()?.id;
          const cached = id
            ? this._simpleCounterService.getCountdownRemaining(id)
            : undefined;
          // Use cached remaining time on component init (survives component recreation),
          // but only if it's valid (not exceeding configured duration)
          const initial =
            !isManualReset && cached !== undefined && cached <= countdownDuration
              ? cached
              : countdownDuration;

          return this._globalTrackingIntervalService.tick$.pipe(
            scan((acc, tick) => {
              if (!this.simpleCounter()?.isOn) {
                return acc;
              }
              const newVal = acc - tick.duration;
              return newVal < 0 ? 0 : newVal;
            }, initial),
            tap((remaining) => {
              if (id) {
                this._simpleCounterService.setCountdownRemaining(id, remaining);
              }
            }),
          );
        }),
        distinctUntilChanged(),
      ),
    ),
  );

  ngOnInit(): void {
    if (this.simpleCounter()?.type === SimpleCounterType.RepeatedCountdownReminder) {
      this._subs.add(
        this.countdownTime$.subscribe((countdownTime) => {
          if (countdownTime === 0) {
            this.isTimeUp.set(true);
            this._bannerService.open({
              id: BannerId.SimpleCounterCountdownComplete,
              isHideDismissBtn: true,
              msg: `<i>${this.simpleCounter()?.title || 'Simple Counter Countdown'}</i> is finished!`,
              action: {
                label: 'Count up and restart!',
                fn: () => {
                  this.countUpAndNextRepeatCountdownSession();
                },
              },
            });
          }
        }),
      );
    }
  }

  calcCountdownProgress(remaining: number, total?: number | null): number {
    if (!total || total <= 0) {
      return 0;
    }
    const elapsed = total - remaining;
    if (!Number.isFinite(elapsed)) {
      return 0;
    }
    const progress = (elapsed / total) * 100;
    return Math.min(100, Math.max(0, progress));
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  countUpAndNextRepeatCountdownSession(): void {
    this._bannerService.dismiss(BannerId.SimpleCounterCountdownComplete);
    this.toggleCounter();
    const id = this.simpleCounter()?.id;
    if (id) {
      this._simpleCounterService.clearCountdownRemaining(id);
    }
    this._resetCountdown$.next(undefined);
    this.isTimeUp.set(false);
  }

  toggleStopwatch(): void {
    const c = this.simpleCounter();
    if (!c) {
      throw new Error('No simple counter model');
    }
    this._simpleCounterService.toggleCounter(c.id);
  }

  toggleCounter(): void {
    const c = this.simpleCounter();
    if (!c) {
      throw new Error('No simple counter model');
    }
    this._simpleCounterService.increaseCounterToday(c.id, 1);
  }

  reset(): void {
    const c = this.simpleCounter();
    if (!c) {
      throw new Error('No simple counter model');
    }
    this._simpleCounterService.setCounterToday(c.id, 0);
  }

  edit(ev?: Event): void {
    if (ev) {
      ev.preventDefault();
    }
    const c = this.simpleCounter();
    if (!c) {
      throw new Error('No simple counter model');
    }

    this._matDialog.open(DialogSimpleCounterEditComponent, {
      restoreFocus: true,
      data: {
        simpleCounter: c,
      },
    });
  }
}
