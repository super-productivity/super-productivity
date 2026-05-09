import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, take } from 'rxjs';
import { filter, map, switchMap, tap } from 'rxjs/operators';
import { playSound } from '../../../util/play-sound';
import {
  toggleSimpleCounterCounter,
  setSimpleCounterCounterOff,
} from './simple-counter.actions';
import { selectSoundConfig } from '../../config/store/global-config.reducer';
import { selectSimpleCounterById } from './simple-counter.reducer';
import { SimpleCounterType } from '../simple-counter.model';

/**
 * Audio Effects for Simple Counter start/stop events.
 * Triggers audio feedback when:
 * - A countdown-based timer starts or stops
 * - A stopwatch starts or is manually stopped/disabled
 *
 * Audio is queued internally to prevent clipping when multiple counters complete simultaneously.
 */
@Injectable()
export class SimpleCounterAudioEffects {
  private actions$ = inject(Actions);
  private store$ = inject(Store);

  /**
   * Plays audio feedback when a SimpleCounter is toggled on or off.
   * Detects start/stop by checking the post-action isOn state.
   *
   * Listens to toggleSimpleCounterCounter and setSimpleCounterCounterOff actions
   * which are dispatched when the user clicks to stop a habit.
   *
   * Uses the global sound configuration to determine:
   * - Whether audio is enabled
   * - Which sound file to play
   * - Volume level
   */
  playHabitAudio$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(toggleSimpleCounterCounter, setSimpleCounterCounterOff),
        // Get counter and sound config at the time of toggle
        // Use take(1) to prevent re-emissions from store updates
        switchMap((action) =>
          combineLatest([
            this.store$.select(selectSoundConfig),
            this.store$.select(selectSimpleCounterById, {
              id: action.id,
            }),
          ]).pipe(
            take(1),
            map(([soundConfig, counter]) => ({
              action,
              soundConfig,
              counter,
            })),
          ),
        ),
        // Filter: only process if audio config and counter exist
        filter(({ soundConfig, counter }) => !!soundConfig && !!counter),
        // Filter: only if audio is enabled in global config
        filter(
          ({ soundConfig }) =>
            soundConfig && soundConfig.volume > 0 && !!soundConfig.doneSound,
        ),
        // Filter: only if counter has audio enabled locally
        filter(({ counter }) => !!counter && counter.isAudioEnabled !== false),
        // Filter: only for StopWatch and RepeatedCountdownReminder types
        filter(
          ({ counter }) =>
            !!counter &&
            (counter.type === SimpleCounterType.StopWatch ||
              counter.type === SimpleCounterType.RepeatedCountdownReminder),
        ),
        tap(async ({ soundConfig, counter }) => {
          // Play completion sound
          if (counter && soundConfig.doneSound && soundConfig.volume > 0) {
            await playSound(soundConfig.doneSound, soundConfig.volume);
          }
        }),
      ),
    { dispatch: false },
  );
}
