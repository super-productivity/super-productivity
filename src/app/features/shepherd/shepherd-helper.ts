import { Observable, Subject } from 'rxjs';
import { first, takeUntil, tap } from 'rxjs/operators';
import { ShepherdService } from './shepherd.service';
import type Shepherd from 'shepherd.js';
type StepOptionsWhen = Shepherd.Step.StepOptionsWhen;
import { TourId } from './shepherd-steps.const';
import { Log } from '../../core/log';

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
    },
    hide: () => {
      onDestroy$.next();
      onDestroy$.complete();
    },
  };
};
