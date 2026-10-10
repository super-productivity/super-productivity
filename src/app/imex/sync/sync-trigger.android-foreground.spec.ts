import { fakeAsync, tick } from '@angular/core/testing';
import { EMPTY, merge, Observable, ReplaySubject, Subject, timer } from 'rxjs';
import { mapTo, switchMap, throttleTime } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';

/**
 * Documents CURRENT behavior for #10685 — not a fix, and not a regression guard
 * for desired behavior.
 *
 * `IS_ANDROID_WEB_VIEW` is a module-level const read once at import time
 * (`!!window.SUPAndroid`), so Karma can't run the real Android branch of
 * `SyncTriggerService.getSyncTrigger$`. This spec copies that branch verbatim
 * (sync-trigger.service.ts, `IS_ANDROID_WEB_VIEW ? merge(...)`) and runs it
 * on the same Subject shapes `android-interface.ts` creates. If the service
 * branch changes, update this copy or delete this spec.
 *
 * Note that `useIntervalTimer` is not referenced by the Android branch at all;
 * the copy below takes it only to show that it has no effect.
 */
describe('SyncTriggerService Android immediate triggers (#10685, current behavior)', () => {
  const SYNC_INTERVAL = 60_000;

  let onResume$: ReplaySubject<void>;
  let onPause$: Subject<void>;
  let isInBackground$: Observable<boolean>;
  let isOnlineTrigger$: Subject<string>;

  // Verbatim copy of the Android branch of getSyncTrigger$'s _immediateSyncTrigger$.
  const androidImmediateSyncTrigger$ = (
    syncInterval: number,
    _useIntervalTimer: boolean,
  ): Observable<string> =>
    merge(
      isInBackground$.pipe(
        switchMap((isInBackground) =>
          isInBackground
            ? timer(syncInterval, syncInterval).pipe(
                mapTo('I_MOBILE_ONLY_BACKGROUND_TIMER'),
              )
            : EMPTY,
        ),
      ),
      onResume$.pipe(throttleTime(10000), mapTo('I_RESUME_APP')),
      onPause$.pipe(throttleTime(10000), mapTo('I_PAUSE_APP')),
      isOnlineTrigger$,
    );

  beforeEach(() => {
    // Same shapes as android-interface.ts
    onResume$ = new ReplaySubject(1);
    onPause$ = new Subject();
    isInBackground$ = merge(onResume$.pipe(mapTo(false)), onPause$.pipe(mapTo(true)));
    isOnlineTrigger$ = new Subject();
  });

  it('runs in a non-Android Karma context (why the branch is copied)', () => {
    expect(IS_ANDROID_WEB_VIEW).toBe(false);
  });

  it('fires once on resume, then never while the app stays in the foreground, even with useIntervalTimer=true', fakeAsync(() => {
    const emissions: string[] = [];
    const sub = androidImmediateSyncTrigger$(SYNC_INTERVAL, true).subscribe((v) =>
      emissions.push(v),
    );

    onResume$.next();
    expect(emissions).toEqual(['I_RESUME_APP']);

    // 30 minutes in the foreground: no timer, no visibility/activity trigger.
    tick(30 * SYNC_INTERVAL);
    expect(emissions).toEqual(['I_RESUME_APP']);

    sub.unsubscribe();
  }));

  it('only runs the interval timer while in the background', fakeAsync(() => {
    const emissions: string[] = [];
    const sub = androidImmediateSyncTrigger$(SYNC_INTERVAL, true).subscribe((v) =>
      emissions.push(v),
    );

    onResume$.next();
    onPause$.next();
    tick(2 * SYNC_INTERVAL);
    expect(emissions).toEqual([
      'I_RESUME_APP',
      'I_PAUSE_APP',
      'I_MOBILE_ONLY_BACKGROUND_TIMER',
      'I_MOBILE_ONLY_BACKGROUND_TIMER',
    ]);

    sub.unsubscribe();
  }));

  it('drops a second pause within 10s (leading-edge throttle): edits made between the two pauses get no pause-triggered sync', fakeAsync(() => {
    const emissions: string[] = [];
    const sub = androidImmediateSyncTrigger$(SYNC_INTERVAL, true).subscribe((v) =>
      emissions.push(v),
    );

    onResume$.next();
    tick(11_000); // leave the resume throttle window
    onPause$.next(); // background
    tick(2_000);
    onResume$.next(); // back to the foreground: resume throttle window passed, fires
    tick(3_000); // user makes an edit
    onPause$.next(); // background again, 5s after the first pause: dropped
    tick(10_000);

    expect(emissions).toEqual(['I_RESUME_APP', 'I_PAUSE_APP', 'I_RESUME_APP']);

    sub.unsubscribe();
  }));
});
