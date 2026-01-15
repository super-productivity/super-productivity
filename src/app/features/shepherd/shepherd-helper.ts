import { Observable, Subject, timer } from 'rxjs';
import { filter, first, map, take, takeUntil, tap } from 'rxjs/operators';
import { ShepherdService } from './shepherd.service';
import Step from 'shepherd.js/src/types/step';
import StepOptionsWhen = Step.StepOptionsWhen;
import { TourId } from './shepherd-steps.const';
import { Log } from '../../core/log';

const MAX_WAIT_TIME = 10000; // 10 seconds max wait

export const waitForEl = (selector: string, cb: () => void): number => {
  const startTime = Date.now();
  const int = window.setInterval(() => {
    Log.log('INT');

    if (document.querySelector(selector)) {
      window.clearInterval(int);
      cb();
    } else if (Date.now() - startTime > MAX_WAIT_TIME) {
      window.clearInterval(int);
      Log.warn(`waitForEl: Timeout waiting for selector "${selector}"`);
    }
  }, 50);
  return int;
};

export const waitForElObs$ = (selector: string): Observable<any> => {
  return timer(50, 50).pipe(
    map(() => document.querySelector(selector)),
    filter((el) => !!el),
    take(1),
  );
};

export const nextOnObs = (
  obs: Observable<any>,
  shepherdService: ShepherdService,
  additionalOnShow?: () => void,
  debugTitle?: string,
): StepOptionsWhen => {
  let _onDestroy$;
  return {
    show: () => {
      if (additionalOnShow) {
        additionalOnShow();
      }
      _onDestroy$ = new Subject<void>();
      obs
        .pipe(
          tap((v) => {
            if (debugTitle) {
              Log.log('nextOnObs', v, debugTitle);
            }
          }),
          first(),
          takeUntil(_onDestroy$),
        )
        .subscribe(() => shepherdService.next());
    },
    hide: () => {
      _onDestroy$.next();
      _onDestroy$.complete();
    },
  };
};

export const twoWayObs = (
  fwd: {
    obs: Observable<any>;
    cbAfter?: () => void;
  },
  back: {
    obs: Observable<any>;
    cbAfter?: () => void;
    backToId?: TourId;
  },
  shepherdService: ShepherdService,
  debugTitle?: string,
): StepOptionsWhen => {
  let onDestroy$;
  return {
    show: () => {
      onDestroy$ = new Subject();
      fwd.obs.pipe(first(), takeUntil(onDestroy$)).subscribe((v) => {
        if (debugTitle) {
          Log.log(debugTitle, 'fwd', v);
        }
        fwd.cbAfter?.();
        shepherdService.next();
      });
      if (back) {
        back.obs.pipe(first(), takeUntil(onDestroy$)).subscribe((v) => {
          if (debugTitle) {
            Log.log(debugTitle, 'back', v);
          }
          back.cbAfter?.();
          if (back.backToId) {
            shepherdService.show(back.backToId);
          } else {
            shepherdService.back();
          }
        });
      }
    },
    hide: () => {
      onDestroy$.next();
      onDestroy$.complete();
    },
  };
};
