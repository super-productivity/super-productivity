/**
 * Effect test for GitHub issue #7856
 * https://github.com/super-productivity/super-productivity/issues/7856
 *
 * The in-app Focus/Pomodoro countdown is driven by an RxJS `interval(1000)`
 * (FocusModeService) that Android/Chromium freezes for a backgrounded WebView,
 * so no `tick` fires while away and the display drifts from the still-accurate
 * native notification. Time tracking avoids this by re-syncing from native on
 * `androidInterface.onResume$` (see android-foreground-tracking.effects
 * `syncOnResume$`); focus mode had no equivalent.
 *
 * Fix: on app resume, dispatch a `tick()` so the wall-clock-based reducer
 * (`elapsed = Date.now() - startedAt`) snaps the countdown back to the truth.
 * The reducer no-ops `tick` for idle/paused timers, so the effect dispatches
 * unconditionally (see focus-mode.bug-7856.spec for that guarantee).
 *
 * The gated effect wiring (`IS_ANDROID_WEB_VIEW && createEffect(...)`) cannot be
 * instantiated under Karma, so the stream logic lives in the exported
 * `createFocusResumeTick$` factory and is exercised directly here.
 */

import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { createFocusResumeTick$ } from './android-focus-mode.effects';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';

describe('AndroidFocusModeEffects: focus timer resume re-sync (#7856)', () => {
  let onResume$: Subject<void>;
  let emitted: Action[];

  beforeEach(() => {
    onResume$ = new Subject<void>();
    emitted = [];
    createFocusResumeTick$(onResume$).subscribe((a) => emitted.push(a));
  });

  it('does not emit before the app resumes', () => {
    expect(emitted).toEqual([]);
  });

  it('dispatches tick() when the app resumes', () => {
    onResume$.next();

    expect(emitted).toEqual([focusModeActions.tick()]);
  });

  it('dispatches one tick() for every resume event', () => {
    onResume$.next();
    onResume$.next();
    onResume$.next();

    expect(emitted.length).toBe(3);
    emitted.forEach((a) => expect(a).toEqual(focusModeActions.tick()));
  });
});
